require('dotenv').config({ path: `${__dirname}/../.env` });
const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_minimum_32_chars_long!!';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV   = 'test';

const makeToken = (overrides = {}) =>
  jwt.sign(
    { userId: 'user-uuid-1', username: 'testuser', email: 'test@c.com', role: 'Coach', ...overrides },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

// ── Mocks ──────────────────────────────────
jest.mock('@cricket-cms/shared', () => {
  const actual = jest.requireActual('@cricket-cms/shared');
  return {
    ...actual,
    postgres: {
      createPool: jest.fn(), testConnection: jest.fn().mockResolvedValue(true),
      closePool: jest.fn(), query: jest.fn(), transaction: jest.fn(),
    },
    rabbitmq: {
      connectRabbitMQ:        jest.fn().mockResolvedValue(true),
      testRabbitMQConnection: jest.fn().mockResolvedValue(true),
      closeRabbitMQ:          jest.fn(),
      publishEvent:           jest.fn().mockResolvedValue('event-id'),
    },
  };
});

jest.mock('../src/models/match.model');
jest.mock('../src/config/migrate', () => ({ runMigrations: jest.fn().mockResolvedValue(true) }));

const MatchModel  = require('../src/models/match.model');
const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const { createApp, notFoundHandler, errorHandler } = require('@cricket-cms/shared');
const matchRoutes = require('../src/routes/match.routes');

const buildApp = () => {
  const app = createApp('match-test');
  app.use('/api/v1/matches', matchRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// Reusable mock match object
const mockMatch = {
  id: 'match-uuid-1',
  opponent_team: 'Australia', match_date: '2026-06-15',
  match_time: '14:00:00', venue: 'MCG', match_type: 'ODI',
  status: 'Scheduled', result: null, our_score: null,
  opponent_score: null, notes: null,
  created_by: 'user-uuid-1', created_by_name: 'Head Coach',
  approved_by_name: null, created_at: new Date(), updated_at: new Date(),
};

// ─────────────────────────────────────────
describe('Match Service — All Endpoints', () => {
  let app;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => jest.clearAllMocks());

  // ─── POST /matches ───────────────────────
  describe('POST /api/v1/matches', () => {

    it('201 — Coach schedules a match and event is published', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.createMatch.mockResolvedValue(mockMatch);

      const res = await request(app)
        .post('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`)
        .send({
          opponentTeam: 'Australia',
          matchDate: '2026-06-15',
          venue: 'MCG',
          matchType: 'ODI',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.opponentTeam).toBe('Australia');
      expect(res.body.data.status).toBe('Scheduled');
      // match.scheduled event must be published
      expect(publishEvent).toHaveBeenCalledWith(
        'match.scheduled',
        expect.objectContaining({ matchId: 'match-uuid-1' }),
        expect.any(Object)
      );
    });

    it('403 — Player cannot schedule a match', async () => {
      const token = makeToken({ role: 'Player' });
      const res = await request(app)
        .post('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`)
        .send({ opponentTeam: 'Australia', matchDate: '2026-06-15', venue: 'MCG', matchType: 'ODI' });
      expect(res.status).toBe(403);
    });

    it('422 — invalid matchType rejected', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`)
        .send({ opponentTeam: 'Australia', matchDate: '2026-06-15', venue: 'MCG', matchType: 'FiftyFifty' });
      expect(res.status).toBe(422);
    });

    it('422 — missing required fields', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`)
        .send({ opponentTeam: 'Australia' }); // missing date, venue, matchType
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /matches ────────────────────────
  describe('GET /api/v1/matches', () => {

    it('200 — any authenticated user can list matches', async () => {
      const token = makeToken({ role: 'Player' });
      MatchModel.getAllMatches.mockResolvedValue({ matches: [mockMatch], total: 1 });

      const res = await request(app)
        .get('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination.totalRecords).toBe(1);
    });

    it('200 — supports status filter', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.getAllMatches.mockResolvedValue({ matches: [], total: 0 });

      const res = await request(app)
        .get('/api/v1/matches?status=Completed')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(MatchModel.getAllMatches).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Completed' })
      );
    });

    it('422 — invalid status filter rejected', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .get('/api/v1/matches?status=NotAStatus')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /matches/:matchId ───────────────
  describe('GET /api/v1/matches/:matchId', () => {

    it('200 — returns match with lineup and logistics', async () => {
      const token = makeToken({ role: 'Player' });
      MatchModel.getMatchById.mockResolvedValue(mockMatch);
      MatchModel.getLineupByMatchId.mockResolvedValue([{
        lineup_id: 'l1', player_id: 'p1', full_name: 'Ahmed Khan',
        player_role: 'Batsman', jersey_number: 1,
        batting_order: 1, bowling_order: null,
        fielding_position: 'Cover', profile_image_url: null,
      }]);
      MatchModel.getLogisticsByMatchId.mockResolvedValue({
        travel_details: 'Flight on 14th', accommodation: 'Hilton',
        equipment_checklist: 'All packed', notes: null,
      });

      const res = await request(app)
        .get('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.lineup).toHaveLength(1);
      expect(res.body.data.lineup[0].battingOrder).toBe(1);
      expect(res.body.data.logistics.travelDetails).toBe('Flight on 14th');
    });

    it('404 — match not found', async () => {
      const token = makeToken();
      MatchModel.getMatchById.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── PUT /:matchId (update details) ──────
  describe('PUT /api/v1/matches/:matchId', () => {

    it('200 — Coach updates a Scheduled match', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.getMatchById.mockResolvedValue({ ...mockMatch, status: 'Scheduled' });
      MatchModel.updateMatch.mockResolvedValue({ ...mockMatch, venue: 'SCG' });

      const res = await request(app)
        .put('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`)
        .send({ venue: 'SCG' });

      expect(res.status).toBe(200);
    });

    it('400 — cannot edit a Completed match', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.getMatchById.mockResolvedValue({ ...mockMatch, status: 'Completed' });

      const res = await request(app)
        .put('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`)
        .send({ venue: 'SCG' });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /:matchId/lineup ───────────────
  describe('POST /api/v1/matches/:matchId/lineup', () => {

    it('200 — Coach sets lineup', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.getMatchById.mockResolvedValue({ ...mockMatch, status: 'Scheduled' });
      MatchModel.setLineup.mockResolvedValue(2);

      const res = await request(app)
        .post('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/lineup')
        .set('Authorization', `Bearer ${token}`)
        .send({
          players: [
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', battingOrder: 1 },
            { playerId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', battingOrder: 2 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.playerCount).toBe(2);
    });

    it('400 — duplicate batting orders rejected', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.getMatchById.mockResolvedValue({ ...mockMatch, status: 'Scheduled' });

      const res = await request(app)
        .post('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/lineup')
        .set('Authorization', `Bearer ${token}`)
        .send({
          players: [
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', battingOrder: 1 },
            { playerId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', battingOrder: 1 }, // duplicate!
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('batting');
    });

    it('403 — Selector cannot set lineup', async () => {
      const token = makeToken({ role: 'Selector' });
      const res = await request(app)
        .post('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/lineup')
        .set('Authorization', `Bearer ${token}`)
        .send({ players: [{ playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }] });
      expect(res.status).toBe(403);
    });
  });

  // ─── PUT /:matchId/result ────────────────
  describe('PUT /api/v1/matches/:matchId/result', () => {

    it('200 — records result and publishes match.completed event', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.getMatchById.mockResolvedValue({ ...mockMatch, status: 'In_Progress' });
      MatchModel.updateMatchStatus.mockResolvedValue({
        id: 'match-uuid-1', status: 'Completed',
        result: 'Win', our_score: '320/6', opponent_score: '285/10',
      });
      MatchModel.getLineupPlayerIds.mockResolvedValue(['user-1', 'user-2', 'user-3']);

      const res = await request(app)
        .put('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/result')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'Completed', result: 'Win', ourScore: '320/6', opponentScore: '285/10' });

      expect(res.status).toBe(200);
      expect(res.body.data.result).toBe('Win');
      // match.completed MUST be published so Performance + Notification services react
      expect(publishEvent).toHaveBeenCalledWith(
        'match.completed',
        expect.objectContaining({
          result: 'Win',
          lineupPlayerIds: ['user-1', 'user-2', 'user-3'],
        }),
        expect.any(Object)
      );
    });

    it('400 — result required when status is Completed', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.getMatchById.mockResolvedValue({ ...mockMatch, status: 'In_Progress' });

      const res = await request(app)
        .put('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/result')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'Completed' }); // missing result

      expect(res.status).toBe(422);
    });

    it('400 — cannot update result of cancelled match', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.getMatchById.mockResolvedValue({ ...mockMatch, status: 'Cancelled' });

      const res = await request(app)
        .put('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/result')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'Completed', result: 'Win' });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /:matchId/logistics ────────────
  describe('POST /api/v1/matches/:matchId/logistics', () => {

    it('200 — Coach adds logistics', async () => {
      const token = makeToken({ role: 'Coach' });
      MatchModel.getMatchById.mockResolvedValue(mockMatch);
      MatchModel.upsertLogistics.mockResolvedValue({
        travel_details: 'Flight on 14th', accommodation: 'Hilton',
        equipment_checklist: 'All packed', notes: null,
      });

      const res = await request(app)
        .post('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/logistics')
        .set('Authorization', `Bearer ${token}`)
        .send({
          travelDetails: 'Flight on 14th',
          accommodation: 'Hilton',
          equipmentChecklist: 'All packed',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.travelDetails).toBe('Flight on 14th');
    });
  });

  // ─── DELETE /:matchId ────────────────────
  describe('DELETE /api/v1/matches/:matchId', () => {

    it('200 — Chairman cancels a Scheduled match and publishes event', async () => {
      const token = makeToken({ role: 'Chairman' });
      MatchModel.getMatchById.mockResolvedValue({ ...mockMatch, status: 'Scheduled' });
      MatchModel.deleteMatch.mockResolvedValue({ id: 'match-uuid-1' });

      const res = await request(app)
        .delete('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(publishEvent).toHaveBeenCalledWith(
        'match.cancelled',
        expect.objectContaining({ matchId: 'match-uuid-1' }),
        expect.any(Object)
      );
    });

    it('400 — cannot cancel a Completed match', async () => {
      const token = makeToken({ role: 'Chairman' });
      MatchModel.getMatchById.mockResolvedValue({ ...mockMatch, status: 'Completed' });

      const res = await request(app)
        .delete('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('403 — Coach cannot delete a match', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .delete('/api/v1/matches/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });
});
