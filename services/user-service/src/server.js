require('dotenv').config();

const { createApp, startServer, createLogger } = require('@cricket-cms/shared');
const { createPool, testConnection, closePool } = require('@cricket-cms/shared').postgres;
const { connectMongo, closeMongo, testMongoConnection } = require('@cricket-cms/shared').mongodb;

const { runMigrations } = require('./config/migrate');
const userRoutes = require('./routes/user.routes');

const logger = createLogger('user-service');
const PORT = process.env.PORT || 3002;

const bootstrap = async () => {
  try {
    // Step 1 — PostgreSQL
    logger.info('Connecting to PostgreSQL...');
    createPool();
    await testConnection();
    logger.info('PostgreSQL connected');

    // Step 2 — MongoDB (for preferences and player metadata)
    logger.info('Connecting to MongoDB...');
    await connectMongo();
    logger.info('MongoDB connected');

    // Step 3 — Run migrations
    // Note: auth-service must have run first so the `users` table exists
    await runMigrations();

    // Step 4 — Create Express app
    const app = createApp('user-service', {
      readinessCheck: async () => {
        await testConnection();
        await testMongoConnection();
      },
    });

    // Step 5 — Mount routes
    app.use('/api/v1/users', userRoutes);

    // Step 6 — Cleanup on shutdown
    app.locals.cleanup = async () => {
      await closePool();
      await closeMongo();
    };

    startServer(app, PORT, 'user-service');

  } catch (err) {
    logger.error('Failed to start user service', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

bootstrap();
