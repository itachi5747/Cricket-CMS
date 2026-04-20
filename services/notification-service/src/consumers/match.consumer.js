const { consumeQueue, createLogger, QUEUES, EVENTS } = require('@cricket-cms/shared');
const NotificationModel = require('../models/notification.model');
const { sendEmail, buildHtmlEmail } = require('../services/email.service');

const logger = createLogger('match-consumer');

// ─────────────────────────────────────────
// Helper — build and save a notification + optionally send email
// ─────────────────────────────────────────
const notify = async ({ userId, type, category, title, message, priority, data, sendMail }) => {
  try {
    const notification = await NotificationModel.createNotification({
      userId, type, category, title, message, priority, data,
    });

    if (sendMail && sendMail.to) {
      try {
        await sendEmail({
          to:      sendMail.to,
          subject: sendMail.subject || title,
          html:    buildHtmlEmail({ title, message, actionUrl: data?.link }),
        });
        await notification.updateOne({ emailSent: true, emailSentAt: new Date() });
      } catch (emailErr) {
        logger.error('Email failed but in-app notification saved', {
          userId, error: emailErr.message,
        });
        await notification.updateOne({ emailError: emailErr.message });
      }
    }

    return notification;
  } catch (err) {
    logger.error('Failed to create notification', { userId, error: err.message });
  }
};

// ─────────────────────────────────────────
// match.events consumer
// Handles: match.scheduled, match.completed, match.cancelled
// ─────────────────────────────────────────
const startMatchConsumer = async () => {
  await consumeQueue(QUEUES.MATCH_EVENTS, async (event) => {
    const { eventType, data } = event;

    // ── match.scheduled ──────────────────
    if (eventType === EVENTS.MATCH_SCHEDULED) {
      const { matchId, opponentTeam, matchDate, matchTime, venue, scheduledBy } = data;

      logger.info('Processing match.scheduled notification', { matchId, opponentTeam });

      // In a full system, we'd fetch the lineup player IDs from match-service
      // For now we notify the scheduler and log that players would be notified
      // when lineup is set. This is intentional — lineup might not be set yet.
      await notify({
        userId:   scheduledBy,
        type:     'in_app',
        category: 'match',
        title:    'Match Scheduled Successfully',
        message:  `Match against ${opponentTeam} on ${matchDate} at ${venue} has been scheduled.`,
        priority: 'medium',
        data:     { matchId, link: `/matches/${matchId}` },
      });
    }

    // ── match.completed ───────────────────
    if (eventType === EVENTS.MATCH_COMPLETED) {
      const {
        matchId, opponentTeam, result,
        ourScore, opponentScore, lineupPlayerIds = [], completedBy,
      } = data;

      logger.info('Processing match.completed notification', {
        matchId, result, playerCount: lineupPlayerIds.length,
      });

      const resultEmoji = result === 'Win' ? '🏆' : result === 'Loss' ? '😔' : '🤝';
      const title   = `Match ${result}: vs ${opponentTeam}`;
      const message = `Match result: ${resultEmoji} ${result}. Score: ${ourScore || 'N/A'} vs ${opponentScore || 'N/A'}.`;

      // Notify all players who were in the lineup
      if (lineupPlayerIds.length > 0) {
        const bulk = lineupPlayerIds.map((userId) => ({
          userId,
          type:     'in_app',
          category: 'match',
          title,
          message,
          priority: 'high',
          data:     { matchId, link: `/matches/${matchId}` },
          emailSent: false,
          sentAt:   new Date(),
        }));
        await NotificationModel.createBulkNotifications(bulk);
        logger.info('Bulk match.completed notifications sent', {
          count: lineupPlayerIds.length,
        });
      }

      // Notify coach to record player stats
      await notify({
        userId:   completedBy,
        type:     'in_app',
        category: 'match',
        title:    'Please Record Player Performances',
        message:  `Match vs ${opponentTeam} is complete. Please record individual player performances.`,
        priority: 'high',
        data:     { matchId, link: `/performance/record?matchId=${matchId}` },
      });
    }

    // ── match.cancelled ───────────────────
    if (eventType === EVENTS.MATCH_CANCELLED) {
      const { matchId, opponentTeam, matchDate, cancelledBy } = data;

      logger.info('Processing match.cancelled notification', { matchId });

      await notify({
        userId:   cancelledBy,
        type:     'in_app',
        category: 'match',
        title:    'Match Cancelled',
        message:  `The match against ${opponentTeam} on ${matchDate} has been cancelled.`,
        priority: 'high',
        data:     { matchId },
      });
    }
  });

  logger.info('Match events consumer started');
};

module.exports = { startMatchConsumer };
