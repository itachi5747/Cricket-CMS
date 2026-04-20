const { consumeQueue, createLogger, QUEUES, EVENTS } = require('@cricket-cms/shared');

const logger = createLogger('performance-consumer');

// ─────────────────────────────────────────
// match.completed consumer
//
// When a match finishes, the Match Service publishes
// a match.completed event. This consumer receives it
// and logs a prompt for the coach to record player stats.
//
// In Phase 7 (Notification Service) the actual email/push
// notification to the coach is handled there. This consumer's
// job is just to log and trigger any internal performance
// service actions needed.
//
// Why handle it here too? Because in the future this service
// might auto-generate performance templates or pre-fill
// known stats from match data. The hook is already wired.
// ─────────────────────────────────────────
const startMatchConsumer = async () => {
  await consumeQueue(QUEUES.MATCH_EVENTS, async (event) => {
    const { eventType, data } = event;

    // This queue receives ALL match events (scheduled, completed, cancelled)
    // We only care about match.completed here
    if (eventType !== EVENTS.MATCH_COMPLETED) return;

    const {
      matchId,
      opponentTeam,
      matchDate,
      matchType,
      result,
      lineupPlayerIds = [],
    } = data;

    logger.info('Match completed event received', {
      matchId,
      opponentTeam,
      matchDate,
      result,
      playerCount: lineupPlayerIds.length,
    });

    // Log which players need performance records entered
    // Coach will use POST /api/v1/performance/record for each
    if (lineupPlayerIds.length > 0) {
      logger.info('Performance records needed', {
        matchId,
        opponentTeam,
        matchType,
        playerCount: lineupPlayerIds.length,
        action: 'Coach should submit performance via POST /api/v1/performance/record',
      });
    }
  });

  logger.info('Match events consumer started');
};

module.exports = { startMatchConsumer };
