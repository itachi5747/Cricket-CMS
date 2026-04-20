require('dotenv').config({ path: `${__dirname}/../.env` });
const request = require('supertest');
const jwt     = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_minimum_32_chars_long!!';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV   = 'test';

const makeToken = (overrides = {}) =>
  jwt.sign(
    { userId: 'user-uuid-1', username: 'coach', email: 'coach@c.com', role: 'Coach', ...overrides },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

// ── Mocks ────────────────────────────────
jest.mock('@cricket-cms/shared', () => {
  const actual = jest.requireActual('@cricket-cms/shared');
  return {
    ...actual,
    mongodb: {
      connectMongo:        jest.fn().mockResolvedValue(true),
      testMongoConnection: jest.fn().mockResolvedValue(true),
      closeMongo:          jest.fn(),
    },
    rabbitmq: {
      connectRabbitMQ:         jest.fn().mockResolvedValue(true),
      testRabbitMQConnection:  jest.fn().mockResolvedValue(true),
      closeRabbitMQ:           jest.fn(),
      consumeQueue:            jest.fn().mockResolvedValue(true),
      publishEvent:            jest.fn().mockResolvedValue('event-id'),
    },
  };
});

jest.mock('../src/models/performance.model');
jest.mock('../src/consumers/match.consumer', () => ({
  startMatchConsumer: jest.fn().mockResolvedValue(true),
}));

const PerformanceModel = require('../src/models/performance.model');
const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const { createApp, notFoundHandler, errorHandler } = require('@cricket-cms/shared');
const performanceRoutes = require('../src/routes/performance.routes');

const buildApp = () => {
  const app = createApp('performance-test');
  app.use('/api/v1/performance', performanceRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// Shared test data
const validPayload = {
  playerId:  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  matchId:   'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  matchDate: '2026-06-15',
  matchType: 'ODI',
  opponent:  'Australia',
  batting:   { runs: 85, ballsFaced: 95, fours: 8, sixes: 2, dismissalType: 'Caught', position: 1 },
  bowling:   { overs: 0, wickets: 0, runsConceded: 0 },
  fielding:  { catches: 1, runOuts: 0, stumpings: 0 },
  playerOfMatch: false,
  rating:    8,
  coachNotes: 'Excellent innings',
};

// ─────────────────────────────────────────
describe('Performance Service — All Endpoints', () => {
  let app;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => {
    jest.clearAllMocks();
    PerformanceModel.getCurrentSeason.mockReturnValue('2025-2026');
  });

  // ─── POST /record ────────────────────────
  describe('POST /api/v1/performance/record', () => {

    it('201 — Coach records performance and event is published', async () => {
      const token = makeToken({ role: 'Coach' });
      PerformanceModel.findExistingPerformance.mockResolvedValue(null);
      PerformanceModel.createPerformance.mockResolvedValue({
        _id: 'mongo-id-1',
        playerId: validPayload.playerId,
        matchId:  validPayload.matchId,
        opponent: 'Australia',
        batting:  { runs: 85, strikeRate: 89.47 },
        bowling:  { wickets: 0, economyRate: 0 },
        rating:   8,
      });
      PerformanceModel.recalculatePlayerStats.mockResolvedValue({});

      const res = await request(app)
        .post('/api/v1/performance/record')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.data.batting.runs).toBe(85);
      // performance.recorded event must be published
      expect(publishEvent).toHaveBeenCalledWith(
        'performance.recorded',
        expect.objectContaining({ playerId: validPayload.playerId }),
        expect.any(Object)
      );
    });

    it('409 — duplicate performance rejected', async () => {
      const token = makeToken({ role: 'Coach' });
      PerformanceModel.findExistingPerformance.mockResolvedValue({ _id: 'existing' });

      const res = await request(app)
        .post('/api/v1/performance/record')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already recorded');
    });

    it('403 — Selector cannot record performance', async () => {
      const token = makeToken({ role: 'Selector' });
      const res = await request(app)
        .post('/api/v1/performance/record')
        .set('Authorization', `Bearer ${token}`)
        .send(validPayload);
      expect(res.status).toBe(403);
    });

    it('422 — missing required fields', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/performance/record')
        .set('Authorization', `Bearer ${token}`)
        .send({ playerId: validPayload.playerId }); // missing matchId, matchDate etc.
      expect(res.status).toBe(422);
    });

    it('422 — invalid rating (above 10)', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/performance/record')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validPayload, rating: 15 });
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /player/:playerId ───────────────
  describe('GET /api/v1/performance/player/:playerId', () => {

    it('200 — Coach gets player performance history', async () => {
      const token = makeToken({ role: 'Coach' });
      PerformanceModel.getPlayerPerformances.mockResolvedValue({
        performances: [{
          _id: 'mongo-1', matchId: 'match-1', matchDate: new Date('2026-06-15'),
          matchType: 'ODI', opponent: 'Australia',
          batting: { runs: 85, ballsFaced: 95, strikeRate: 89.47, fours: 8, sixes: 2 },
          bowling: { overs: 0, wickets: 0, economyRate: 0, maidens: 0, runsConceded: 0 },
          fielding: { catches: 1, runOuts: 0, stumpings: 0 },
          playerOfMatch: false, rating: 8,
        }],
        total: 1,
      });

      const res = await request(app)
        .get(`/api/v1/performance/player/${validPayload.playerId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].batting.runs).toBe(85);
      expect(res.body.pagination.totalRecords).toBe(1);
    });

    it('200 — Player can view their own history', async () => {
      const token = makeToken({ role: 'Player' });
      PerformanceModel.getPlayerPerformances.mockResolvedValue({ performances: [], total: 0 });

      const res = await request(app)
        .get(`/api/v1/performance/player/${validPayload.playerId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('403 — Accountant cannot view performance history', async () => {
      const token = makeToken({ role: 'Accountant' });
      const res = await request(app)
        .get(`/api/v1/performance/player/${validPayload.playerId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ─── GET /player/:playerId/stats ─────────
  describe('GET /api/v1/performance/player/:playerId/stats', () => {

    it('200 — returns aggregated stats including averages and trend', async () => {
      const token = makeToken({ role: 'Coach' });
      PerformanceModel.getPlayerStats.mockResolvedValue({
        playerId: validPayload.playerId,
        season: '2025-2026',
        overall: {
          matchesPlayed: 20, totalRuns: 850, totalWickets: 5,
          battingAverage: 52.43, bowlingAverage: 0,
          strikeRate: 87.65, economyRate: 0,
          catches: 8, playerOfMatchCount: 3,
        },
        formatWise: {
          odi: { matchesPlayed: 15, totalRuns: 650, battingAverage: 54.16 },
        },
        recentForm: {
          last5Matches: [{ runs: 85, wickets: 0, rating: 8 }],
          trend: 'Improving',
        },
        milestones: [
          { type: 'Century', date: new Date('2026-03-10'), matchId: 'match-1', value: 105 },
        ],
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/v1/performance/player/${validPayload.playerId}/stats`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.overall.battingAverage).toBe(52.43);
      expect(res.body.data.recentForm.trend).toBe('Improving');
      expect(res.body.data.milestones[0].type).toBe('Century');
    });

    it('404 — no data for player with no matches', async () => {
      const token = makeToken({ role: 'Coach' });
      PerformanceModel.getPlayerStats.mockResolvedValue(null);
      PerformanceModel.getPlayerPerformances.mockResolvedValue({ total: 0, performances: [] });

      const res = await request(app)
        .get(`/api/v1/performance/player/${validPayload.playerId}/stats`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /match/:matchId ─────────────────
  describe('GET /api/v1/performance/match/:matchId', () => {

    it('200 — returns all performances for a match', async () => {
      const token = makeToken({ role: 'Coach' });
      PerformanceModel.getMatchPerformances.mockResolvedValue([
        {
          _id: 'm1', playerId: 'p1', opponent: 'Australia', matchDate: new Date(),
          batting: { runs: 85, ballsFaced: 95, strikeRate: 89.47, fours: 8, sixes: 2 },
          bowling: { overs: 0, wickets: 0, economyRate: 0 },
          fielding: { catches: 1 }, playerOfMatch: false, rating: 8,
        },
        {
          _id: 'm2', playerId: 'p2', opponent: 'Australia', matchDate: new Date(),
          batting: { runs: 42, ballsFaced: 55, strikeRate: 76.36, fours: 4, sixes: 0 },
          bowling: { overs: 10, wickets: 2, economyRate: 4.5 },
          fielding: { catches: 0 }, playerOfMatch: false, rating: 6,
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/performance/match/${validPayload.matchId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('200 — empty array when no performances recorded yet', async () => {
      const token = makeToken({ role: 'Player' });
      PerformanceModel.getMatchPerformances.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/v1/performance/match/${validPayload.matchId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ─── GET /compare ────────────────────────
  describe('GET /api/v1/performance/compare', () => {

    it('200 — Selector compares two players side by side', async () => {
      const token = makeToken({ role: 'Selector' });
      const id1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      const id2 = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

      PerformanceModel.comparePlayerStats.mockResolvedValue([
        {
          playerId: id1, season: '2025-2026',
          overall: { matchesPlayed: 20, totalRuns: 850, battingAverage: 52.43, totalWickets: 5, strikeRate: 87.65, economyRate: 0, bowlingAverage: 0 },
          recentForm: { trend: 'Improving' }, milestones: [],
        },
        {
          playerId: id2, season: '2025-2026',
          overall: { matchesPlayed: 15, totalRuns: 620, battingAverage: 44.28, totalWickets: 8, strikeRate: 82.10, economyRate: 5.2, bowlingAverage: 22.5 },
          recentForm: { trend: 'Stable' }, milestones: [],
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/performance/compare?playerIds=${id1},${id2}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.comparison).toHaveLength(2);
      expect(res.body.data.comparison[0].overall.battingAverage).toBe(52.43);
      expect(res.body.data.comparison[1].recentTrend).toBe('Stable');
    });

    it('400 — more than 10 players rejected', async () => {
      const token = makeToken({ role: 'Selector' });
      const ids = Array.from({ length: 11 }, (_, i) =>
        `a0eebc99-9c0b-4ef8-bb6d-6bb9bd38${String(i).padStart(4, '0')}`
      ).join(',');

      PerformanceModel.comparePlayerStats.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/v1/performance/compare?playerIds=${ids}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('403 — Player cannot use compare endpoint', async () => {
      const token = makeToken({ role: 'Player' });
      const res = await request(app)
        .get('/api/v1/performance/compare?playerIds=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });
});
