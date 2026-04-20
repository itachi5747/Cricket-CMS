const { consumeQueue, createLogger, QUEUES, EVENTS } = require('@cricket-cms/shared');
const NotificationModel = require('../models/notification.model');

const logger = createLogger('performance-consumer');

const startPerformanceConsumer = async () => {
  await consumeQueue(QUEUES.PERFORMANCE_EVENTS, async (event) => {
    const { eventType, data } = event;

    // ── performance.recorded ──────────────
    // Coach recorded a player's match stats — notify the player
    if (eventType === EVENTS.PERFORMANCE_RECORDED) {
      const {
        performanceId, playerId, matchId,
        opponent, batting, rating,
      } = data;

      logger.info('Processing performance.recorded notification', {
        performanceId, playerId,
      });

      const runs    = batting?.runs    ?? 0;
      const wickets = batting?.wickets ?? 0;

      let highlights = `Runs: ${runs}`;
      if (wickets > 0) highlights += `, Wickets: ${wickets}`;
      if (rating)      highlights += `, Rating: ${rating}/10`;

      await NotificationModel.createNotification({
        userId:   playerId,
        type:     'in_app',
        category: 'performance',
        title:    `Performance Recorded vs ${opponent}`,
        message:  `Your performance for the match against ${opponent} has been recorded. ${highlights}.`,
        priority: 'low',
        data:     {
          performanceId,
          matchId,
          link: `/performance/player/${playerId}`,
        },
      });
    }
  });

  logger.info('Performance events consumer started');
};

module.exports = { startPerformanceConsumer };
