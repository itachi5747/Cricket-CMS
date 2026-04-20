require('dotenv').config();

const { createApp, startServer, createLogger } = require('@cricket-cms/shared');
const { createPool, testConnection, closePool } = require('@cricket-cms/shared').postgres;
const { connectRabbitMQ, closeRabbitMQ, testRabbitMQConnection } = require('@cricket-cms/shared').rabbitmq;

const { runMigrations }   = require('./config/migrate');
const financialRoutes     = require('./routes/financial.routes');

const logger = createLogger('financial-service');
const PORT   = process.env.PORT || 3006;

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

    const app = createApp('financial-service', {
      readinessCheck: async () => {
        await testConnection();
        await testRabbitMQConnection();
      },
    });

    app.use('/api/v1/financial', financialRoutes);

    app.locals.cleanup = async () => {
      await closePool();
      await closeRabbitMQ();
    };

    startServer(app, PORT, 'financial-service');

  } catch (err) {
    logger.error('Failed to start financial service', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

bootstrap();
