require('dotenv').config();

const { createApp, startServer, createLogger } = require('@cricket-cms/shared');
const { connectMongo, closeMongo, testMongoConnection } = require('@cricket-cms/shared').mongodb;
const { connectRabbitMQ, closeRabbitMQ, testRabbitMQConnection } = require('@cricket-cms/shared').rabbitmq;

const { seedTemplates }     = require('./models/notification.model');
const { createTransporter } = require('./services/email.service');
const { startAllConsumers } = require('./consumers');
const notificationRoutes    = require('./routes/notification.routes');

const logger = createLogger('notification-service');
const PORT   = process.env.PORT || 3007;

const bootstrap = async () => {
  try {
    // MongoDB
    logger.info('Connecting to MongoDB...');
    await connectMongo();
    logger.info('MongoDB connected');

    // RabbitMQ — essential, this service is a consumer
    logger.info('Connecting to RabbitMQ...');
    await connectRabbitMQ();
    logger.info('RabbitMQ connected');

    // Seed default notification templates
    logger.info('Seeding notification templates...');
    await seedTemplates();
    logger.info('Templates ready');

    // Initialize email transporter
    logger.info('Initializing email transporter...');
    await createTransporter();

    // Start all RabbitMQ consumers
    logger.info('Starting consumers...');
    await startAllConsumers();

    // HTTP app for reading notifications
    const app = createApp('notification-service', {
      readinessCheck: async () => {
        await testMongoConnection();
        await testRabbitMQConnection();
      },
    });

    app.use('/api/v1/notifications', notificationRoutes);

    app.locals.cleanup = async () => {
      await closeMongo();
      await closeRabbitMQ();
    };

    startServer(app, PORT, 'notification-service');

  } catch (err) {
    logger.error('Failed to start notification service', {
      error: err.message, stack: err.stack,
    });
    process.exit(1);
  }
};

bootstrap();
