const amqp = require('amqplib');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../utils/logger');
const { EXCHANGES, QUEUES } = require('../constants');

const logger = createLogger('rabbitmq');

let connection = null;
let channel = null;

// ─────────────────────────────────────────
// connectRabbitMQ
// Establishes connection and sets up all exchanges + queues.
// ─────────────────────────────────────────
const connectRabbitMQ = async (retries = 5, delay = 3000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = process.env.RABBITMQ_URL;
      if (!url) throw new Error('RABBITMQ_URL environment variable not set');

      connection = await amqp.connect(url);
      channel = await connection.createChannel();

      // Prefetch: process one message at a time (fair dispatch)
      await channel.prefetch(1);

      // ── Assert exchanges ──
      await channel.assertExchange(EXCHANGES.MAIN_TOPIC, 'topic', { durable: true });
      await channel.assertExchange(EXCHANGES.NOTIFICATIONS_FANOUT, 'fanout', { durable: true });
      await channel.assertExchange(EXCHANGES.DEAD_LETTER, 'direct', { durable: true });

      // ── Assert queues ──
      const queueOptions = {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': EXCHANGES.DEAD_LETTER,
          'x-message-ttl': 7 * 24 * 60 * 60 * 1000, // 7 days TTL
        },
      };

      await channel.assertQueue(QUEUES.USER_EVENTS, queueOptions);
      await channel.assertQueue(QUEUES.MATCH_EVENTS, queueOptions);
      await channel.assertQueue(QUEUES.PERFORMANCE_EVENTS, queueOptions);
      await channel.assertQueue(QUEUES.FINANCIAL_EVENTS, queueOptions);
      await channel.assertQueue(QUEUES.SQUAD_EVENTS, queueOptions);
      await channel.assertQueue(QUEUES.ATTENDANCE_EVENTS, queueOptions);
      await channel.assertQueue(QUEUES.NOTIFICATIONS_ALL, {
        durable: true,
        arguments: { 'x-message-ttl': 30 * 24 * 60 * 60 * 1000 }, // 30 days
      });

      // Dead letter queue
      await channel.assertQueue(QUEUES.DEAD_LETTER, { durable: true });

      // ── Bind queues to exchanges ──
      const bindings = [
        [QUEUES.USER_EVENTS, 'user.*'],
        [QUEUES.MATCH_EVENTS, 'match.*'],
        [QUEUES.PERFORMANCE_EVENTS, 'performance.*'],
        [QUEUES.PERFORMANCE_EVENTS, 'stats.*'],
        [QUEUES.FINANCIAL_EVENTS, 'salary.*'],
        [QUEUES.FINANCIAL_EVENTS, 'expense.*'],
        [QUEUES.FINANCIAL_EVENTS, 'sponsorship.*'],
        [QUEUES.SQUAD_EVENTS, 'squad.*'],
        [QUEUES.ATTENDANCE_EVENTS, 'session.*'],
      ];

      for (const [queue, pattern] of bindings) {
        await channel.bindQueue(queue, EXCHANGES.MAIN_TOPIC, pattern);
      }

      // Fanout binding for notifications
      await channel.bindQueue(QUEUES.NOTIFICATIONS_ALL, EXCHANGES.NOTIFICATIONS_FANOUT, '');

      // Connection error handling
      connection.on('error', (err) => {
        logger.error('RabbitMQ connection error', { error: err.message });
      });

      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed, reconnecting...');
        setTimeout(() => connectRabbitMQ(), delay);
      });

      logger.info('RabbitMQ connected and configured');
      return channel;
    } catch (err) {
      logger.warn(`RabbitMQ connection attempt ${attempt}/${retries} failed`, {
        error: err.message,
      });
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
};

// ─────────────────────────────────────────
// publishEvent
// Publishes an event to the main topic exchange.
// ─────────────────────────────────────────
const publishEvent = async (eventType, data, metadata = {}) => {
  if (!channel) throw new Error('RabbitMQ not connected');

  const message = {
    eventId: uuidv4(),
    eventType,
    timestamp: new Date().toISOString(),
    version: '1.0',
    data,
    metadata: {
      correlationId: metadata.correlationId || uuidv4(),
      triggeredBy: metadata.userId || null,
      source: metadata.source || process.env.SERVICE_NAME,
      ...metadata,
    },
  };

  const buffer = Buffer.from(JSON.stringify(message));

  channel.publish(EXCHANGES.MAIN_TOPIC, eventType, buffer, {
    persistent: true,        // Survive broker restart
    contentType: 'application/json',
    messageId: message.eventId,
    timestamp: Date.now(),
  });

  logger.debug('Event published', { eventType, eventId: message.eventId });

  return message.eventId;
};

// ─────────────────────────────────────────
// consumeQueue
// Subscribe to a queue with idempotency check via processedEventIds Set.
// ─────────────────────────────────────────
const consumeQueue = async (queueName, handler, options = {}) => {
  if (!channel) throw new Error('RabbitMQ not connected');

  const processedIds = new Set(); // In-memory idempotency (use Redis in prod)
  const maxRetries = options.maxRetries || 3;

  await channel.consume(queueName, async (msg) => {
    if (!msg) return;

    let parsed;
    try {
      parsed = JSON.parse(msg.content.toString());
    } catch {
      logger.error('Failed to parse message', { queue: queueName });
      channel.nack(msg, false, false); // Dead-letter invalid messages
      return;
    }

    const { eventId, eventType } = parsed;

    // Idempotency check
    if (processedIds.has(eventId)) {
      logger.debug('Duplicate event skipped', { eventId, eventType });
      channel.ack(msg);
      return;
    }

    // Retry count from headers
    const retryCount = (msg.properties.headers?.['x-retry-count'] || 0);

    try {
      await handler(parsed);
      processedIds.add(eventId);
      // Clean up old IDs to prevent unbounded growth
      if (processedIds.size > 10000) {
        const first = processedIds.values().next().value;
        processedIds.delete(first);
      }
      channel.ack(msg);
      logger.debug('Event processed', { eventId, eventType, queue: queueName });
    } catch (err) {
      logger.error('Event processing failed', {
        eventId,
        eventType,
        queue: queueName,
        error: err.message,
        retryCount,
      });

      if (retryCount < maxRetries) {
        // Requeue with incremented retry count after a delay
        setTimeout(() => {
          channel.publish(
            EXCHANGES.MAIN_TOPIC,
            eventType,
            msg.content,
            {
              persistent: true,
              headers: { 'x-retry-count': retryCount + 1 },
            }
          );
        }, 2000 * (retryCount + 1)); // Exponential backoff
        channel.ack(msg);
      } else {
        // Max retries exceeded — send to dead letter queue
        channel.nack(msg, false, false);
        logger.error('Message dead-lettered after max retries', { eventId, eventType });
      }
    }
  });

  logger.info('Consumer registered', { queue: queueName });
};

// ─────────────────────────────────────────
// closeRabbitMQ
// ─────────────────────────────────────────
const closeRabbitMQ = async () => {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    logger.info('RabbitMQ connection closed');
  } catch (err) {
    logger.error('Error closing RabbitMQ', { error: err.message });
  }
};

// Test connection
const testRabbitMQConnection = async () => {
  if (!channel) throw new Error('RabbitMQ not connected');
};

module.exports = {
  connectRabbitMQ,
  publishEvent,
  consumeQueue,
  closeRabbitMQ,
  testRabbitMQConnection,
};
