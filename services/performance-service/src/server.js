require('dotenv').config();

const { createApp, startServer, createLogger } = require('@cricket-cms/shared');
const { connectMongo, closeMongo, testMongoConnection } = require('@cricket-cms/shared').mongodb;
const { connectRabbitMQ, closeRabbitMQ, testRabbitMQConnection } = require('@cricket-cms/shared').rabbitmq;

const { startMatchConsumer } = require('./consumers/match.consumer');
const performanceRoutes      = require('./routes/performance.routes');

const logger = createLogger('performance-service');
const PORT = process.env.PORT || 3005;

// ─────────────────────────────────────────
// Note: No PostgreSQL here — this service
// is 100% MongoDB. All playerId and matchId
// references are stored as strings (UUIDs).
// ─────────────────────────────────────────
const bootstrap = async () => {
  try {
    // MongoDB
    logger.info('Connecting to MongoDB...');
    await connectMongo();
    logger.info('MongoDB connected');

    // RabbitMQ — needed for consuming match events + publishing performance.recorded
    logger.info('Connecting to RabbitMQ...');
    await connectRabbitMQ();
    logger.info('RabbitMQ connected');

    // Start consuming match.completed events
    await startMatchConsumer();

    // Create Express app
    const app = createApp('performance-service', {
      readinessCheck: async () => {
        await testMongoConnection();
        await testRabbitMQConnection();
      },
    });

    app.use('/api/v1/performance', performanceRoutes);

    app.locals.cleanup = async () => {
      await closeMongo();
      await closeRabbitMQ();
    };

    startServer(app, PORT, 'performance-service');

  } catch (err) {
    logger.error('Failed to start performance service', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

bootstrap();
