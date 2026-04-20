require('dotenv').config();

const { createApp, startServer, createLogger } = require('@cricket-cms/shared');
const { connectMongo, closeMongo, testMongoConnection } = require('@cricket-cms/shared').mongodb;
const { connectRabbitMQ, closeRabbitMQ, testRabbitMQConnection } = require('@cricket-cms/shared').rabbitmq;

const { initMinio, testMinioConnection } = require('./config/minio');
const fileRoutes = require('./routes/file.routes');

const logger = createLogger('file-service');
const PORT   = process.env.PORT || 3008;

const bootstrap = async () => {
  try {
    // MongoDB — stores file metadata and report records
    logger.info('Connecting to MongoDB...');
    await connectMongo();
    logger.info('MongoDB connected');

    // RabbitMQ — publishes report.generated events
    logger.info('Connecting to RabbitMQ...');
    await connectRabbitMQ();
    logger.info('RabbitMQ connected');

    // MinIO — the actual file storage
    logger.info('Initializing MinIO...');
    await initMinio();
    logger.info('MinIO ready');

    const app = createApp('file-service', {
      // Larger JSON limit for potential base64 payloads
      jsonLimit: '50mb',
      readinessCheck: async () => {
        await testMongoConnection();
        await testRabbitMQConnection();
        await testMinioConnection();
      },
    });

    app.use('/api/v1/files', fileRoutes);

    app.locals.cleanup = async () => {
      await closeMongo();
      await closeRabbitMQ();
    };

    startServer(app, PORT, 'file-service');

  } catch (err) {
    logger.error('Failed to start file service', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

bootstrap();
