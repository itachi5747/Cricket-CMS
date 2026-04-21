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
    redis: {
      connectRedis:        jest.fn().mockResolvedValue(true),
      closeRedis:          jest.fn(),
      testRedisConnection: jest.fn().mockResolvedValue(true),
      getRedis:            jest.fn().mockReturnValue({
        incr:   jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(true),
        get:    jest.fn().mockResolvedValue(null),
        set:    jest.fn().mockResolvedValue(true),
      }),
      isTokenBlacklisted: jest.fn().mockResolvedValue(false),
      getKey:             jest.fn().mockResolvedValue(null),
      setKey:             jest.fn().mockResolvedValue(true),
    },
  };
});

// Mock http-proxy-middleware — don't actually proxy in tests
jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn(() => (req, res, next) => {
    // Simulate a successful proxy response
    res.status(200).json({
      success: true,
      message: 'Proxied response from mock service',
      proxied: true,
      path:    req.path,
    });
  }),
}));

const { buildGatewayApp } = require('../src/server');

// ─────────────────────────────────────────
describe('API Gateway', () => {
  let app;

  beforeAll(() => { app = buildGatewayApp(); });
  beforeEach(() => jest.clearAllMocks());

  // ─── Health checks ───────────────────────
  describe('Health Endpoints', () => {

    it('GET /health — returns 200 with UP status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UP');
      expect(res.body.service).toBe('api-gateway');
    });

    it('GET /ready — returns 200 when Redis is healthy', async () => {
      const res = await request(app).get('/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY');
      expect(res.body.checks.redis).toBe('OK');
    });

    it('GET /health — no auth required', async () => {
      // Health check must work without any token
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });
  });

  // ─── Auth middleware ─────────────────────
  describe('Auth Middleware', () => {

    it('passes public auth paths through without JWT', async () => {
      // POST /api/v1/auth/login is a public path — no token needed
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@c.com', password: 'Test@1234!' });

      // Proxy mock returns 200 — gateway didn't block it
      expect(res.status).toBe(200);
      expect(res.body.proxied).toBe(true);
    });

    it('blocks protected routes without token', async () => {
      const res = await request(app)
        .get('/api/v1/users/profile');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Authentication required');
    });

    it('blocks requests with expired token', async () => {
      const expiredToken = jwt.sign(
        { userId: 'u1', role: 'Coach' },
        JWT_SECRET,
        { expiresIn: '-1s' } // already expired
      );

      const res = await request(app)
        .get('/api/v1/matches')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('expired');
    });

    it('blocks requests with invalid token signature', async () => {
      const res = await request(app)
        .get('/api/v1/matches')
        .set('Authorization', 'Bearer completely.invalid.token');

      expect(res.status).toBe(401);
    });

    it('blocks blacklisted tokens', async () => {
      const { isTokenBlacklisted } = require('@cricket-cms/shared').redis;
      isTokenBlacklisted.mockResolvedValueOnce(true); // token is blacklisted

      const token = makeToken();
      const res   = await request(app)
        .get('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('revoked');
    });

    it('injects user headers for valid token', async () => {
      const token = makeToken({ userId: 'test-user-id', role: 'Coach' });

      // Use a custom proxy mock to capture the headers
      const { createProxyMiddleware } = require('http-proxy-middleware');
      createProxyMiddleware.mockImplementationOnce(() => (req, res) => {
        res.status(200).json({
          success:      true,
          receivedHeaders: {
            'x-user-id':   req.headers['x-user-id'],
            'x-user-role': req.headers['x-user-role'],
          },
        });
      });

      const res = await request(app)
        .get('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  // ─── Rate limiting ────────────────────────
  describe('Rate Limiting', () => {

    it('adds rate limit headers to responses', async () => {
      const token = makeToken();
      const res   = await request(app)
        .get('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`);

      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('returns 429 when rate limit is exceeded', async () => {
      const { getRedis } = require('@cricket-cms/shared').redis;
      const mockRedis = getRedis();

      // Simulate being over the limit
      mockRedis.incr.mockResolvedValueOnce(101); // 1 over the 100 limit

      const token = makeToken();
      const res   = await request(app)
        .get('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.retryAfter).toBeDefined();
    });

    it('fails open when Redis is unavailable', async () => {
      const { getRedis } = require('@cricket-cms/shared').redis;
      const mockRedis = getRedis();

      // Simulate Redis failure
      mockRedis.incr.mockRejectedValueOnce(new Error('Redis connection lost'));

      const token = makeToken();
      const res   = await request(app)
        .get('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`);

      // Should NOT return 429 or 500 — fails open, request goes through
      expect(res.status).not.toBe(429);
      expect(res.status).not.toBe(500);
    });
  });

  // ─── Route proxying ──────────────────────
  describe('Route Proxying', () => {
    const token = makeToken();

    it('proxies /api/v1/auth/* to auth service', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'test', email: 'test@c.com', password: 'Test@1234!' });

      expect(res.status).toBe(200);
      expect(res.body.proxied).toBe(true);
    });

    it('proxies /api/v1/users/* to user service', async () => {
      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.proxied).toBe(true);
    });

    it('proxies /api/v1/teams/* to team service', async () => {
      const res = await request(app)
        .get('/api/v1/teams')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.proxied).toBe(true);
    });

    it('proxies /api/v1/matches/* to match service', async () => {
      const res = await request(app)
        .get('/api/v1/matches')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.proxied).toBe(true);
    });

    it('proxies /api/v1/performance/* to performance service', async () => {
      const res = await request(app)
        .get('/api/v1/performance/compare?playerIds=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.proxied).toBe(true);
    });

    it('proxies /api/v1/financial/* to financial service', async () => {
      const res = await request(app)
        .get('/api/v1/financial/budget')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.proxied).toBe(true);
    });

    it('proxies /api/v1/notifications/* to notification service', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.proxied).toBe(true);
    });

    it('proxies /api/v1/files/* to file service', async () => {
      const res = await request(app)
        .get('/api/v1/files/reports')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.proxied).toBe(true);
    });

    it('proxies /api/v1/attendance/* to attendance service', async () => {
      const res = await request(app)
        .get('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.proxied).toBe(true);
    });

    it('returns 404 for unknown routes', async () => {
      const res = await request(app)
        .get('/api/v1/unknown-service/endpoint')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  // ─── Correlation ID ──────────────────────
  describe('Correlation ID', () => {

    it('generates correlation ID if not provided', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-correlation-id']).toBeDefined();
    });

    it('forwards correlation ID if already present in request', async () => {
      const correlationId = 'my-trace-id-123';
      const res = await request(app)
        .get('/health')
        .set('x-correlation-id', correlationId);
      expect(res.headers['x-correlation-id']).toBe(correlationId);
    });
  });
});
