require('dotenv').config({ path: `${__dirname}/../.env` });
const request = require('supertest');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_minimum_32_chars_long!!';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV   = 'test';

// ── Helper: generate valid test JWT ──────
const makeToken = (overrides = {}) =>
  jwt.sign(
    { userId: 'user-uuid-1', username: 'testuser', email: 'test@c.com', role: 'Chairman', ...overrides },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

// ── Mock shared modules ──────────────────
jest.mock('@cricket-cms/shared', () => {
  const actual = jest.requireActual('@cricket-cms/shared');
  return {
    ...actual,
    postgres: {
      createPool:     jest.fn(),
      testConnection: jest.fn().mockResolvedValue(true),
      closePool:      jest.fn(),
      query:          jest.fn(),
      transaction:    jest.fn(),
    },
    mongodb: {
      connectMongo:         jest.fn().mockResolvedValue(true),
      testMongoConnection:  jest.fn().mockResolvedValue(true),
      closeMongo:           jest.fn(),
    },
  };
});

jest.mock('../src/models/profile.model');
jest.mock('../src/models/metadata.model');
jest.mock('../src/config/migrate', () => ({ runMigrations: jest.fn().mockResolvedValue(true) }));

const ProfileModel  = require('../src/models/profile.model');
const MetadataModel = require('../src/models/metadata.model');

const { createApp, notFoundHandler, errorHandler } = require('@cricket-cms/shared');
const userRoutes = require('../src/routes/user.routes');

const buildApp = () => {
  const app = createApp('user-test');
  app.use('/api/v1/users', userRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// ─────────────────────────────────────────
describe('User Service — All Endpoints', () => {
  let app;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => jest.clearAllMocks());

  // ─── GET /profile ────────────────────────
  describe('GET /api/v1/users/profile', () => {

    it('200 — returns own profile for any logged-in user', async () => {
      const token = makeToken({ role: 'Player' });

      ProfileModel.getProfileByUserId.mockResolvedValue({
        user_id: 'user-uuid-1', username: 'testuser',
        email: 'test@c.com', role: 'Player', is_active: true,
        full_name: 'Test Player', contact_number: '+92-300-0000001',
        address: null, date_of_birth: null, profile_image_url: null,
      });
      ProfileModel.getPlayerByUserId.mockResolvedValue({
        id: 'player-uuid-1', player_role: 'Batsman',
        jersey_number: 10, fitness_status: 'Fit',
        is_available: true, contract_end_date: '2026-12-31',
      });
      MetadataModel.getPreferences.mockResolvedValue({
        preferences: { theme: 'dark', language: 'en' },
      });

      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.username).toBe('testuser');
      expect(res.body.data.playerDetails.playerRole).toBe('Batsman');
      expect(res.body.data.preferences.theme).toBe('dark');
    });

    it('401 — no token provided', async () => {
      const res = await request(app).get('/api/v1/users/profile');
      expect(res.status).toBe(401);
    });
  });

  // ─── PUT /profile ───────────────────────
  describe('PUT /api/v1/users/profile', () => {

    it('200 — updates profile fields', async () => {
      const token = makeToken();
      ProfileModel.updateProfile.mockResolvedValue({
        full_name: 'Updated Name', contact_number: '+92-300-9999999',
        address: null, date_of_birth: null, profile_image_url: null,
      });

      const res = await request(app)
        .put('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Updated Name', contactNumber: '+92-300-9999999' });

      expect(res.status).toBe(200);
      expect(res.body.data.fullName).toBe('Updated Name');
    });

    it('422 — empty body rejected', async () => {
      const token = makeToken();
      const res = await request(app)
        .put('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /players ───────────────────────
  describe('GET /api/v1/users/players', () => {

    it('200 — Chairman can list players', async () => {
      const token = makeToken({ role: 'Chairman' });
      ProfileModel.getAllPlayers.mockResolvedValue({
        players: [
          { player_id: 'p1', user_id: 'u1', full_name: 'Ahmed Khan',
            email: 'ahmed@c.com', player_role: 'Batsman', jersey_number: 1,
            fitness_status: 'Fit', is_available: true, profile_image_url: null,
            salary: 3500, contract_end_date: '2026-12-31' },
        ],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/users/players')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].fullName).toBe('Ahmed Khan');
      expect(res.body.pagination.totalRecords).toBe(1);
    });

    it('403 — Player cannot list all players', async () => {
      const token = makeToken({ role: 'Player' });
      const res = await request(app)
        .get('/api/v1/users/players')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('200 — supports playerRole filter', async () => {
      const token = makeToken({ role: 'Coach' });
      ProfileModel.getAllPlayers.mockResolvedValue({ players: [], total: 0 });

      const res = await request(app)
        .get('/api/v1/users/players?playerRole=Batsman')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(ProfileModel.getAllPlayers).toHaveBeenCalledWith(
        expect.objectContaining({ playerRole: 'Batsman' })
      );
    });
  });

  // ─── POST /players ──────────────────────
  describe('POST /api/v1/users/players', () => {

    it('201 — Chairman creates a player', async () => {
      const token = makeToken({ role: 'Chairman' });
      ProfileModel.createPlayerWithProfile.mockResolvedValue({
        playerId: 'new-player-id', userId: 'new-user-id',
        username: 'newplayer', email: 'new@c.com',
        fullName: 'New Player', playerRole: 'Batsman',
      });
      MetadataModel.getPlayerMetadata.mockResolvedValue({});

      const res = await request(app)
        .post('/api/v1/users/players')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'newplayer', email: 'new@cricket.com',
          password: 'Player@1234!', fullName: 'New Player',
          playerRole: 'Batsman',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.playerRole).toBe('Batsman');
    });

    it('403 — Coach cannot create player accounts', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/users/players')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'newplayer', email: 'new@cricket.com',
          password: 'Player@1234!', fullName: 'New Player', playerRole: 'Batsman',
        });
      expect(res.status).toBe(403);
    });

    it('422 — invalid player role rejected', async () => {
      const token = makeToken({ role: 'Chairman' });
      const res = await request(app)
        .post('/api/v1/users/players')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'newplayer', email: 'new@cricket.com',
          password: 'Player@1234!', fullName: 'New Player',
          playerRole: 'Goalkeeper', // not a valid cricket role
        });
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /staff ─────────────────────────
  describe('GET /api/v1/users/staff', () => {

    it('200 — Chairman lists staff', async () => {
      const token = makeToken({ role: 'Chairman' });
      ProfileModel.getAllStaff.mockResolvedValue({
        staff: [{
          staff_id: 's1', user_id: 'u2', full_name: 'Head Coach',
          email: 'coach@c.com', role: 'Coach', staff_type: 'Coach',
          salary: 8000, hire_date: '2024-01-01',
          specialization: 'Batting', is_active: true,
        }],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/users/staff')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].staffType).toBe('Coach');
    });

    it('403 — Coach cannot list all staff', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .get('/api/v1/users/staff')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ─── DELETE /staff/:staffId ──────────────
  describe('DELETE /api/v1/users/staff/:staffId', () => {

    it('200 — Chairman deactivates a staff member', async () => {
      const token = makeToken({ role: 'Chairman', userId: 'chairman-id' });
      ProfileModel.getStaffById.mockResolvedValue({
        staff_id: 'staff-uuid', user_id: 'different-user-id', // not chairman
      });
      ProfileModel.deactivateStaff.mockResolvedValue({ id: 'different-user-id' });

      const res = await request(app)
        .delete('/api/v1/users/staff/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('403 — Chairman cannot deactivate themselves', async () => {
      const token = makeToken({ role: 'Chairman', userId: 'chairman-id' });
      ProfileModel.getStaffById.mockResolvedValue({
        staff_id: 'staff-uuid', user_id: 'chairman-id', // same as requester
      });

      const res = await request(app)
        .delete('/api/v1/users/staff/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });
});
