require('dotenv').config();

const { createApp, startServer, createLogger } = require('@cricket-cms/shared');
const { createPool, testConnection, closePool } = require('@cricket-cms/shared').postgres;
const { connectRabbitMQ, closeRabbitMQ, testRabbitMQConnection } = require('@cricket-cms/shared').rabbitmq;

const { runMigrations } = require('./config/migrate');
const teamRoutes = require('./routes/team.routes');

const logger = createLogger('team-service');
const PORT = process.env.PORT || 3003;

const bootstrap = async () => {
  try {
    // PostgreSQL
    logger.info('Connecting to PostgreSQL...');
    createPool();
    await testConnection();
    logger.info('PostgreSQL connected');

    // RabbitMQ — needed to publish squad events
    logger.info('Connecting to RabbitMQ...');
    await connectRabbitMQ();
    logger.info('RabbitMQ connected');

    // Migrations
    await runMigrations();

    const app = createApp('team-service', {
      readinessCheck: async () => {
        await testConnection();
        await testRabbitMQConnection();
      },
    });

    app.use('/api/v1/teams', teamRoutes);

    app.locals.cleanup = async () => {
      await closePool();
      await closeRabbitMQ();
    };

    startServer(app, PORT, 'team-service');

  } catch (err) {
    logger.error('Failed to start team service', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

bootstrap();
