require('dotenv').config();

const { createApp, startServer, createLogger } = require('@cricket-cms/shared');
const { createPool, testConnection, closePool } = require('@cricket-cms/shared').postgres;
const { connectRabbitMQ, closeRabbitMQ, testRabbitMQConnection } = require('@cricket-cms/shared').rabbitmq;

const { runMigrations }    = require('./config/migrate');
const attendanceRoutes     = require('./routes/attendance.routes');

const logger = createLogger('attendance-service');
const PORT   = process.env.PORT || 3009;

const bootstrap = async () => {
  try {
    logger.info('Connecting to PostgreSQL...');
    createPool();
    await testConnection();
    logger.info('PostgreSQL connected');

    // RabbitMQ — needed to publish session.created events
    logger.info('Connecting to RabbitMQ...');
    await connectRabbitMQ();
    logger.info('RabbitMQ connected');

    await runMigrations();

    const app = createApp('attendance-service', {
      readinessCheck: async () => {
        await testConnection();
        await testRabbitMQConnection();
      },
    });

    app.use('/api/v1/attendance', attendanceRoutes);

    app.locals.cleanup = async () => {
      await closePool();
      await closeRabbitMQ();
    };

    startServer(app, PORT, 'attendance-service');

  } catch (err) {
    logger.error('Failed to start attendance service', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

bootstrap();
