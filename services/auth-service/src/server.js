require('dotenv').config();

const {
  createApp,
  startServer,
  createLogger,
} = require('@cricket-cms/shared');

const { createPool, testConnection, closePool } = require('@cricket-cms/shared').postgres;
const { connectRedis, closeRedis, testRedisConnection } = require('@cricket-cms/shared').redis;

const { runMigrations } = require('./config/migrate');
const authRoutes = require('./routes/auth.routes');

const logger = createLogger('auth-service');
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────
// Bootstrap function — runs in order:
//   1. Connect to PostgreSQL
//   2. Connect to Redis
//   3. Run DB migrations (create tables if not exist)
//   4. Create Express app
//   5. Mount routes
//   6. Start HTTP server
//
// If any step fails, the process exits.
// A crashed service is better than a service
// that silently runs without a DB connection.
// ─────────────────────────────────────────
const bootstrap = async () => {
  try {
    // Step 1 — PostgreSQL
    logger.info('Connecting to PostgreSQL...');
    createPool();
    await testConnection();
    logger.info('PostgreSQL connected');

    // Step 2 — Redis
    logger.info('Connecting to Redis...');
    await connectRedis();
    logger.info('Redis connected');

    // Step 3 — Run migrations (creates tables if they don't exist)
    await runMigrations();

    // Step 4 — Create Express app with all shared middleware
    // Pass a readiness check so /ready endpoint actually tests our connections
    const app = createApp('auth-service', {
      readinessCheck: async () => {
        await testConnection();
        await testRedisConnection();
      },
    });

    // Step 5 — Mount routes
    // All auth endpoints live under /api/v1/auth/
    app.use('/api/v1/auth', authRoutes);

    // Step 6 — Register cleanup for graceful shutdown
    // startServer() calls app.locals.cleanup when SIGTERM is received
    app.locals.cleanup = async () => {
      await closePool();
      await closeRedis();
    };

    // Step 7 — Start listening
    startServer(app, PORT, 'auth-service');

  } catch (err) {
    logger.error('Failed to start auth service', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
};

bootstrap();
