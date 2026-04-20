require('dotenv').config();

const { createApp, startServer, createLogger } = require('@cricket-cms/shared');
const { createPool, testConnection, closePool } = require('@cricket-cms/shared').postgres;
const { connectRabbitMQ, closeRabbitMQ, testRabbitMQConnection } = require('@cricket-cms/shared').rabbitmq;

const { runMigrations } = require('./config/migrate');
const matchRoutes = require('./routes/match.routes');

const logger = createLogger('match-service');
const PORT = process.env.PORT || 3004;

const bootstrap = async () => {
  try {
    logger.info('Connecting to PostgreSQL...');
    createPool();
    await testConnection();
    logger.info('PostgreSQL connected');

    logger.info('Connecting to RabbitMQ...');
    await connectRabbitMQ();
    logger.info('RabbitMQ connected');

    await runMigrations();

    const app = createApp('match-service', {
      readinessCheck: async () => {
        await testConnection();
        await testRabbitMQConnection();
      },
    });

    app.use('/api/v1/matches', matchRoutes);

    app.locals.cleanup = async () => {
      await closePool();
      await closeRabbitMQ();
    };

    startServer(app, PORT, 'match-service');

  } catch (err) {
    logger.error('Failed to start match service', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

bootstrap();
