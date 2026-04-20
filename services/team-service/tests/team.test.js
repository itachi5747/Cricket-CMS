require('dotenv').config({ path: `${__dirname}/../.env` });
const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_minimum_32_chars_long!!';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV   = 'test';

const makeToken = (overrides = {}) =>
  jwt.sign(
    { userId: 'user-uuid-1', username: 'testuser', email: 'test@c.com', role: 'Chairman', ...overrides },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

// ── Mocks ────────────────────────────────
jest.mock('@cricket-cms/shared', () => {
  const actual = jest.requireActual('@cricket-cms/shared');
  return {
    ...actual,
    postgres: {
      createPool: jest.fn(), testConnection: jest.fn().mockResolvedValue(true),
      closePool: jest.fn(), query: jest.fn(), transaction: jest.fn(),
    },
    rabbitmq: {
      connectRabbitMQ:      jest.fn().mockResolvedValue(true),
      testRabbitMQConnection: jest.fn().mockResolvedValue(true),
      closeRabbitMQ:        jest.fn(),
      publishEvent:         jest.fn().mockResolvedValue('event-id-123'),
    },
  };
});

jest.mock('../src/models/team.model');
jest.mock('../src/config/migrate', () => ({ runMigrations: jest.fn().mockResolvedValue(true) }));

const TeamModel = require('../src/models/team.model');
const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const { createApp, notFoundHandler, errorHandler } = require('@cricket-cms/shared');
const teamRoutes = require('../src/routes/team.routes');

const buildApp = () => {
  const app = createApp('team-test');
  app.use('/api/v1/teams', teamRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// ─────────────────────────────────────────
describe('Team Service — All Endpoints', () => {
  let app;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => jest.clearAllMocks());

  // ─── POST /teams ─────────────────────────
  describe('POST /api/v1/teams', () => {

    it('201 — Chairman creates a team', async () => {
      const token = makeToken({ role: 'Chairman' });
      TeamModel.getTeamByName.mockResolvedValue(null);
      TeamModel.createTeam.mockResolvedValue({
        id: 'team-uuid-1', name: 'National Team',
        description: 'Senior squad', created_at: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'National Team', description: 'Senior squad' });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('National Team');
    });

    it('409 — duplicate team name', async () => {
      const token = makeToken({ role: 'Chairman' });
      TeamModel.getTeamByName.mockResolvedValue({ id: 'existing-team' });

      const res = await request(app)
        .post('/api/v1/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'National Team' });

      expect(res.status).toBe(409);
    });

    it('403 — Coach cannot create team', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'National Team' });
      expect(res.status).toBe(403);
    });

    it('422 — name too short', async () => {
      const token = makeToken({ role: 'Chairman' });
      const res = await request(app)
        .post('/api/v1/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'A' });
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /teams ──────────────────────────
  describe('GET /api/v1/teams', () => {

    it('200 — any authenticated user can list teams', async () => {
      const token = makeToken({ role: 'Player' });
      TeamModel.getAllTeams.mockResolvedValue({
        teams: [{
          id: 'team-uuid-1', name: 'National Team', description: null,
          player_count: '15', coach_staff_id: null, coach_name: null,
          coach_email: null, created_at: new Date(),
        }],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/teams')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].name).toBe('National Team');
      expect(res.body.pagination.totalRecords).toBe(1);
    });

    it('401 — no token', async () => {
      const res = await request(app).get('/api/v1/teams');
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /:teamId/players ───────────────
  describe('POST /api/v1/teams/:teamId/players', () => {
    const teamId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('200 — adds players with captain assignment', async () => {
      const token = makeToken({ role: 'Coach' });
      TeamModel.getTeamById.mockResolvedValue({ id: teamId, players: [] });
      TeamModel.addPlayersToTeam.mockResolvedValue(2);

      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/players`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          positions: [
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', position: 'Opener', isCaptain: true },
            { playerId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', position: 'Bowler' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.addedPlayers).toBe(2);
    });

    it('400 — two captains rejected', async () => {
      const token = makeToken({ role: 'Coach' });
      TeamModel.getTeamById.mockResolvedValue({ id: teamId, players: [] });

      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/players`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          positions: [
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', isCaptain: true },
            { playerId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', isCaptain: true },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('captain');
    });

    it('403 — Player cannot add players to team', async () => {
      const token = makeToken({ role: 'Player' });
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/players`)
        .set('Authorization', `Bearer ${token}`)
        .send({ positions: [{ playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }] });
      expect(res.status).toBe(403);
    });
  });

  // ─── SQUAD WORKFLOW ──────────────────────
  describe('Squad Approval Workflow', () => {
    const squadId = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    // Step 1: Selector creates squad
    it('201 — Selector creates squad', async () => {
      const token = makeToken({ role: 'Selector', userId: 'selector-uuid' });
      TeamModel.createSquad.mockResolvedValue({
        id: squadId, name: 'Asia Cup Squad',
        tournament_name: 'Asia Cup 2026',
        status: 'Draft', created_at: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/teams/squads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Asia Cup Squad',
          tournamentName: 'Asia Cup 2026',
          players: [
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', priority: 1 },
            { playerId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', priority: 2 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('Draft');
    });

    it('403 — Coach cannot create squad', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/teams/squads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Asia Cup Squad',
          players: [{ playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }],
        });
      expect(res.status).toBe(403);
    });

    // Step 2: Selector finalizes squad
    it('200 — Selector finalizes squad → status becomes Pending_Approval', async () => {
      const token = makeToken({ role: 'Selector', userId: 'selector-uuid' });
      TeamModel.getSquadById.mockResolvedValue({
        id: squadId, status: 'Draft',
        selected_by: 'selector-uuid',
        players: [{ player_id: 'p1' }], // has players
      });
      TeamModel.isSquadOwnedBy.mockResolvedValue(true);
      TeamModel.updateSquadStatus.mockResolvedValue({ id: squadId, status: 'Pending_Approval' });

      const res = await request(app)
        .put(`/api/v1/teams/squads/${squadId}/finalize`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Pending_Approval');
      // RabbitMQ event must be published
      expect(publishEvent).toHaveBeenCalledWith(
        'squad.finalized',
        expect.objectContaining({ squadId }),
        expect.any(Object)
      );
    });

    it('400 — cannot finalize squad that is already Pending_Approval', async () => {
      const token = makeToken({ role: 'Selector', userId: 'selector-uuid' });
      TeamModel.getSquadById.mockResolvedValue({
        id: squadId, status: 'Pending_Approval',
        selected_by: 'selector-uuid', players: [{}],
      });
      TeamModel.isSquadOwnedBy.mockResolvedValue(true);

      const res = await request(app)
        .put(`/api/v1/teams/squads/${squadId}/finalize`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('400 — cannot finalize empty squad', async () => {
      const token = makeToken({ role: 'Selector', userId: 'selector-uuid' });
      TeamModel.getSquadById.mockResolvedValue({
        id: squadId, status: 'Draft',
        selected_by: 'selector-uuid',
        players: [], // no players!
      });
      TeamModel.isSquadOwnedBy.mockResolvedValue(true);

      const res = await request(app)
        .put(`/api/v1/teams/squads/${squadId}/finalize`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('player');
    });

    // Step 3: Chairman approves
    it('200 — Chairman approves squad → publishes squad.approved event', async () => {
      const token = makeToken({ role: 'Chairman', userId: 'chairman-uuid' });
      TeamModel.getSquadById.mockResolvedValue({
        id: squadId, status: 'Pending_Approval',
        selected_by: 'selector-uuid', players: [{}],
      });
      TeamModel.updateSquadStatus.mockResolvedValue({ id: squadId, status: 'Approved' });

      const res = await request(app)
        .put(`/api/v1/teams/squads/${squadId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: true, comments: 'Well balanced squad' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Approved');
      expect(publishEvent).toHaveBeenCalledWith(
        'squad.approved',
        expect.objectContaining({ squadId, status: 'Approved' }),
        expect.any(Object)
      );
    });

    // Step 3b: Chairman rejects
    it('200 — Chairman rejects squad → requires rejection reason', async () => {
      const token = makeToken({ role: 'Chairman', userId: 'chairman-uuid' });
      TeamModel.getSquadById.mockResolvedValue({
        id: squadId, status: 'Pending_Approval',
        selected_by: 'selector-uuid', players: [{}],
      });
      TeamModel.updateSquadStatus.mockResolvedValue({ id: squadId, status: 'Rejected' });

      const res = await request(app)
        .put(`/api/v1/teams/squads/${squadId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: false, rejectionReason: 'Team balance is off' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Rejected');
    });

    it('400 — rejection without reason fails', async () => {
      const token = makeToken({ role: 'Chairman' });
      TeamModel.getSquadById.mockResolvedValue({
        id: squadId, status: 'Pending_Approval', players: [{}],
      });

      const res = await request(app)
        .put(`/api/v1/teams/squads/${squadId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: false }); // no rejectionReason

      expect(res.status).toBe(400);
    });

    it('403 — Selector cannot approve squads', async () => {
      const token = makeToken({ role: 'Selector' });
      const res = await request(app)
        .put(`/api/v1/teams/squads/${squadId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: true });
      expect(res.status).toBe(403);
    });
  });
});
