require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const compression= require('compression');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('@cricket-cms/shared');
const { connectRedis, closeRedis, testRedisConnection } = require('@cricket-cms/shared').redis;

const gatewayRoutes = require('./routes');

const logger = createLogger('api-gateway');
const PORT   = process.env.PORT || 8000;

// ─────────────────────────────────────────
// buildGatewayApp
// Constructs the Express app.
// Exported separately for testing.
// ─────────────────────────────────────────
const buildGatewayApp = () => {
  const app = express();

  // ── Security headers ──
  app.use(helmet({
    // Allow the proxy to set content-type headers freely
    contentSecurityPolicy: false,
  }));

  // ── CORS ──
  app.use(cors({
    origin:  process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization',
      'x-correlation-id', 'x-requested-with',
    ],
    credentials: true,
  }));

  // ── Compression ──
  app.use(compression());

  // ── Correlation ID ──
  // Every request gets a unique trace ID so you can follow
  // a single user action across all service logs
  app.use((req, res, next) => {
    const id = req.headers['x-correlation-id'] || uuidv4();
    req.correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
  });

  // ── Request logging ──
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level    = res.statusCode >= 500 ? 'error'
                     : res.statusCode >= 400 ? 'warn'
                     : 'info';
      logger[level](`${req.method} ${req.path}`, {
        statusCode:    res.statusCode,
        duration:      `${duration}ms`,
        correlationId: req.correlationId,
        userId:        req.headers['x-user-id'] || 'anonymous',
      });
    });
    next();
  });

  // ── Health check — no auth, no rate limiting ──
  app.get('/health', (req, res) => {
    res.status(200).json({
      status:    'UP',
      service:   'api-gateway',
      timestamp: new Date().toISOString(),
      version:   '1.0.0',
    });
  });

  // ── Readiness check — verifies Redis is reachable ──
  app.get('/ready', async (req, res) => {
    try {
      await testRedisConnection();
      res.status(200).json({
        status:  'READY',
        service: 'api-gateway',
        checks:  { redis: 'OK' },
      });
    } catch (err) {
      res.status(503).json({
        status:  'NOT_READY',
        service: 'api-gateway',
        checks:  { redis: err.message },
      });
    }
  });

  // ── Aggregate health of all downstream services ──
  app.get('/health/services', async (req, res) => {
    const { SERVICES } = require('./config/services');
    const http = require('http');

    const checkService = (service) =>
      new Promise((resolve) => {
        const url = new URL(`${service.url}/health`);
        const req = http.get({ hostname: url.hostname, port: url.port, path: '/health', timeout: 2000 }, (r) => {
          resolve({ name: service.name, status: r.statusCode === 200 ? 'UP' : 'DEGRADED', statusCode: r.statusCode });
        });
        req.on('error', () => resolve({ name: service.name, status: 'DOWN' }));
        req.on('timeout', () => { req.destroy(); resolve({ name: service.name, status: 'TIMEOUT' }); });
      });

    const results = await Promise.allSettled(
      Object.values(SERVICES).map(checkService)
    );

    const services = results.map((r) => r.status === 'fulfilled' ? r.value : { status: 'ERROR' });
    const allUp    = services.every((s) => s.status === 'UP');

    res.status(allUp ? 200 : 207).json({
      gateway:   'UP',
      allHealthy: allUp,
      services,
      checkedAt: new Date().toISOString(),
    });
  });

  // ── Mount all service proxy routes ──
  app.use(gatewayRoutes);

  // ── 404 for unknown routes ──
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: `Route ${req.method} ${req.path} not found`,
    });
  });

  // ── Global error handler ──
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    logger.error('Unhandled gateway error', {
      error:         err.message,
      stack:         err.stack,
      path:          req.path,
      correlationId: req.correlationId,
    });
    res.status(500).json({
      success: false,
      message: 'Gateway error',
    });
  });

  return app;
};

// ─────────────────────────────────────────
// bootstrap
// ─────────────────────────────────────────
const bootstrap = async () => {
  try {
    // Redis is required for rate limiting and token blacklist checks
    logger.info('Connecting to Redis...');
    await connectRedis();
    logger.info('Redis connected');

    const app    = buildGatewayApp();
    const server = app.listen(PORT, () => {
      logger.info('API Gateway running', {
        port: PORT,
        env:  process.env.NODE_ENV || 'development',
      });
      logger.info('Routes registered', {
        services: [
          'auth-service    → /api/v1/auth',
          'user-service    → /api/v1/users',
          'team-service    → /api/v1/teams',
          'match-service   → /api/v1/matches',
          'performance     → /api/v1/performance',
          'financial       → /api/v1/financial',
          'notifications   → /api/v1/notifications',
          'file-service    → /api/v1/files',
          'attendance      → /api/v1/attendance',
        ],
      });
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down`);
      server.close(async () => {
        await closeRedis();
        logger.info('API Gateway shutdown complete');
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason: String(reason) });
    });

    return server;
  } catch (err) {
    logger.error('Failed to start API Gateway', { error: err.message });
    process.exit(1);
  }
};

// Only start server if this file is run directly (not imported in tests)
if (require.main === module) {
  bootstrap();
}

module.exports = { buildGatewayApp };
