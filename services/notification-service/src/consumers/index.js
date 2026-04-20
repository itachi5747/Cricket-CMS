const { createLogger } = require('@cricket-cms/shared');
const { startMatchConsumer }       = require('./match.consumer');
const { startSquadConsumer }       = require('./squad.consumer');
const { startFinancialConsumer }   = require('./financial.consumer');
const { startPerformanceConsumer } = require('./performance.consumer');

const logger = createLogger('consumers');

// ─────────────────────────────────────────
// startAllConsumers
// Starts all RabbitMQ event consumers.
// Called once during service bootstrap after
// RabbitMQ connection is established.
//
// Each consumer runs independently — if one
// consumer throws, it doesn't affect the others.
// ─────────────────────────────────────────
const startAllConsumers = async () => {
  const consumers = [
    { name: 'match',       fn: startMatchConsumer },
    { name: 'squad',       fn: startSquadConsumer },
    { name: 'financial',   fn: startFinancialConsumer },
    { name: 'performance', fn: startPerformanceConsumer },
  ];

  const results = await Promise.allSettled(
    consumers.map(async ({ name, fn }) => {
      await fn();
      logger.info(`Consumer started: ${name}`);
    })
  );

  // Log any consumer that failed to start — service stays up even if one fails
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.error(`Consumer failed to start: ${consumers[i].name}`, {
        error: result.reason?.message,
      });
    }
  });

  const started = results.filter((r) => r.status === 'fulfilled').length;
  logger.info(`${started}/${consumers.length} consumers started successfully`);
};

module.exports = { startAllConsumers };
