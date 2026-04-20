const { consumeQueue, createLogger, QUEUES, EVENTS } = require('@cricket-cms/shared');
const NotificationModel = require('../models/notification.model');
const { sendEmail, buildHtmlEmail } = require('../services/email.service');

const logger = createLogger('squad-consumer');

const startSquadConsumer = async () => {
  await consumeQueue(QUEUES.SQUAD_EVENTS, async (event) => {
    const { eventType, data } = event;

    // ── squad.finalized ───────────────────
    // Selector has finalized a squad — notify Chairman to approve
    if (eventType === EVENTS.SQUAD_FINALIZED) {
      const { squadId, squadName, selectedBy, playerCount } = data;

      logger.info('Processing squad.finalized notification', { squadId });

      // In a full system, we'd look up the Chairman's userId from user-service.
      // For now we log and save a notification for the selectedBy user confirming
      // finalization, and note that Chairman notification would be sent.
      // In production: query user-service for users with role=Chairman and notify them.

      // Notify the Selector that their squad is pending approval
      await NotificationModel.createNotification({
        userId:   selectedBy,
        type:     'in_app',
        category: 'squad',
        title:    'Squad Submitted for Approval',
        message:  `Your squad "${squadName}" with ${playerCount} players has been submitted to the Chairman for approval.`,
        priority: 'medium',
        data:     { squadId, link: `/teams/squads/${squadId}` },
      });

      logger.info('squad.finalized notification sent', { squadId, notifiedUser: selectedBy });
    }

    // ── squad.approved ────────────────────
    // Chairman approved — notify Selector + all selected players
    if (eventType === EVENTS.SQUAD_APPROVED) {
      const { squadId, squadName, selectedBy, approvedBy } = data;

      logger.info('Processing squad.approved notification', { squadId });

      // Notify the Selector
      await NotificationModel.createNotification({
        userId:   selectedBy,
        type:     'in_app',
        category: 'squad',
        title:    `Squad Approved: ${squadName}`,
        message:  `Your squad "${squadName}" has been approved by the Chairman. Players will be notified.`,
        priority: 'high',
        data:     { squadId, link: `/teams/squads/${squadId}` },
      });

      logger.info('squad.approved notification sent to Selector', { squadId });
    }

    // ── squad.rejected ────────────────────
    // Chairman rejected — notify Selector with reason
    if (eventType === EVENTS.SQUAD_REJECTED) {
      const { squadId, squadName, selectedBy, rejectionReason } = data;

      logger.info('Processing squad.rejected notification', { squadId });

      await NotificationModel.createNotification({
        userId:   selectedBy,
        type:     'in_app',
        category: 'squad',
        title:    `Squad Rejected: ${squadName}`,
        message:  `Your squad "${squadName}" was rejected. Reason: ${rejectionReason || 'No reason provided'}. Please revise and resubmit.`,
        priority: 'high',
        data:     { squadId, link: `/teams/squads/${squadId}` },
      });
    }
  });

  logger.info('Squad events consumer started');
};

module.exports = { startSquadConsumer };
