require('dotenv').config({ path: `${__dirname}/../.env` });

const request = require('supertest');
const bcrypt  = require('bcryptjs');

// ─────────────────────────────────────────
// We test the Express app directly without
// starting a real HTTP server. supertest handles that.
// ─────────────────────────────────────────

// Mock shared postgres and redis — tests don't need a real DB
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
    redis: {
      connectRedis:        jest.fn().mockResolvedValue(true),
      testRedisConnection: jest.fn().mockResolvedValue(true),
      closeRedis:          jest.fn(),
      blacklistToken:      jest.fn().mockResolvedValue(true),
      isTokenBlacklisted:  jest.fn().mockResolvedValue(false),
    },
  };
});

// Mock user model — we control what the "database" returns per test
jest.mock('../src/models/user.model');
const UserModel = require('../src/models/user.model');

// Mock migrations
jest.mock('../src/config/migrate', () => ({
  runMigrations: jest.fn().mockResolvedValue(true),
}));

// Build app for testing
const { createApp, notFoundHandler, errorHandler } = require('@cricket-cms/shared');
const authRoutes = require('../src/routes/auth.routes');

const buildApp = () => {
  const app = createApp('auth-test');
  app.use('/api/v1/auth', authRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// ─────────────────────────────────────────
describe('Auth Service — All Endpoints', () => {
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test_secret_key_minimum_32_chars_long!!';
    process.env.NODE_ENV   = 'test';
    app = buildApp();
  });

  beforeEach(() => jest.clearAllMocks());

  // ─── REGISTER ───────────────────────────
  describe('POST /api/v1/auth/register', () => {
    const valid = {
      username: 'testplayer',
      email: 'test@cricket.com',
      password: 'Test@1234!',
      role: 'Player',
      fullName: 'Test Player',
    };

    it('201 — registers new user successfully', async () => {
      UserModel.findUserByEmail.mockResolvedValue(null);
      UserModel.findUserByUsername.mockResolvedValue(null);
      UserModel.createUser.mockResolvedValue({
        id: 'uuid-123', username: 'testplayer',
        email: 'test@cricket.com', role: 'Player',
      });

      const res = await request(app).post('/api/v1/auth/register').send(valid);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('test@cricket.com');
      expect(res.body.data.password).toBeUndefined();      // never expose password
      expect(res.body.data.passwordHash).toBeUndefined();  // never expose hash
    });

    it('409 — email already registered', async () => {
      UserModel.findUserByEmail.mockResolvedValue({ id: 'exists' });

      const res = await request(app).post('/api/v1/auth/register').send(valid);
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it('409 — username already taken', async () => {
      UserModel.findUserByEmail.mockResolvedValue(null);
      UserModel.findUserByUsername.mockResolvedValue({ id: 'exists' });

      const res = await request(app).post('/api/v1/auth/register').send(valid);
      expect(res.status).toBe(409);
    });

    it('422 — invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...valid, email: 'not-valid' });
      expect(res.status).toBe(422);
      expect(res.body.errors[0].field).toBe('email');
    });

    it('422 — weak password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...valid, password: '123' });
      expect(res.status).toBe(422);
      expect(res.body.errors[0].field).toBe('password');
    });

    it('422 — invalid role', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...valid, role: 'SuperAdmin' });
      expect(res.status).toBe(422);
    });
  });

  // ─── LOGIN ──────────────────────────────
  describe('POST /api/v1/auth/login', () => {

    it('200 — returns access + refresh tokens', async () => {
      const hash = await bcrypt.hash('Test@1234!', 12);
      UserModel.findUserByEmail.mockResolvedValue({
        id: 'uuid-123', username: 'testplayer',
        email: 'test@cricket.com', password_hash: hash,
        role: 'Player', is_active: true,
      });
      UserModel.saveRefreshToken.mockResolvedValue({ id: 'tok' });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@cricket.com', password: 'Test@1234!' });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.expiresIn).toBe(900);
    });

    it('401 — user not found (same message as wrong password)', async () => {
      UserModel.findUserByEmail.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@cricket.com', password: 'Test@1234!' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('401 — wrong password (same message as user not found)', async () => {
      const hash = await bcrypt.hash('CorrectPass@1!', 12);
      UserModel.findUserByEmail.mockResolvedValue({
        id: 'uuid-123', password_hash: hash, is_active: true,
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@cricket.com', password: 'WrongPass@1!' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('401 — deactivated account', async () => {
      const hash = await bcrypt.hash('Test@1234!', 12);
      UserModel.findUserByEmail.mockResolvedValue({
        id: 'uuid-123', password_hash: hash, is_active: false,
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@cricket.com', password: 'Test@1234!' });

      expect(res.status).toBe(401);
    });
  });

  // ─── REFRESH ────────────────────────────
  describe('POST /api/v1/auth/refresh', () => {
    const jwt = require('jsonwebtoken');

    it('200 — returns new tokens', async () => {
      const token = jwt.sign(
        { userId: 'uuid-123' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      UserModel.findRefreshToken.mockResolvedValue({
        user_id: 'uuid-123', username: 'tp',
        email: 'test@cricket.com', role: 'Player', is_active: true,
      });
      UserModel.rotateRefreshToken.mockResolvedValue({ id: 'new' });

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: token });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
    });

    it('401 — token not in DB', async () => {
      const token = jwt.sign({ userId: 'uuid-123' }, process.env.JWT_SECRET, { expiresIn: '7d' });
      UserModel.findRefreshToken.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: token });

      expect(res.status).toBe(401);
    });

    it('401 — malformed token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'garbage.token.here' });

      expect(res.status).toBe(401);
    });
  });

  // ─── FORGOT PASSWORD ────────────────────
  describe('POST /api/v1/auth/forgot-password', () => {

    it('200 — same response whether email exists or not (prevents enumeration)', async () => {
      UserModel.findUserByEmail.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nobody@cricket.com' });

      // Must be 200, not 404. Never reveal if email is registered.
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('200 — saves reset token when email exists', async () => {
      UserModel.findUserByEmail.mockResolvedValue({ id: 'uuid-123' });
      UserModel.saveResetToken.mockResolvedValue({ id: 'reset-id' });

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'test@cricket.com' });

      expect(res.status).toBe(200);
      expect(UserModel.saveResetToken).toHaveBeenCalledTimes(1);
    });
  });

  // ─── RESET PASSWORD ─────────────────────
  describe('POST /api/v1/auth/reset-password', () => {

    it('200 — resets password and clears all sessions', async () => {
      UserModel.findResetToken.mockResolvedValue({
        id: 'record-id', user_id: 'uuid-123', email: 'test@cricket.com',
      });
      UserModel.updateUserPassword.mockResolvedValue();
      UserModel.deleteAllRefreshTokensForUser.mockResolvedValue();
      UserModel.markResetTokenUsed.mockResolvedValue();

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'valid-token', newPassword: 'NewPass@9876!' });

      expect(res.status).toBe(200);
      expect(UserModel.updateUserPassword).toHaveBeenCalledTimes(1);
      // All sessions must be invalidated after password change
      expect(UserModel.deleteAllRefreshTokensForUser).toHaveBeenCalledWith('uuid-123');
      expect(UserModel.markResetTokenUsed).toHaveBeenCalledWith('record-id');
    });

    it('400 — invalid or expired token', async () => {
      UserModel.findResetToken.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'expired', newPassword: 'NewPass@9876!' });

      expect(res.status).toBe(400);
    });
  });
});
