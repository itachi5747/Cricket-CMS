const { consumeQueue, createLogger, QUEUES, EVENTS } = require('@cricket-cms/shared');
const NotificationModel = require('../models/notification.model');
const { sendEmail, buildHtmlEmail } = require('../services/email.service');

const logger = createLogger('financial-consumer');

const startFinancialConsumer = async () => {
  await consumeQueue(QUEUES.FINANCIAL_EVENTS, async (event) => {
    const { eventType, data } = event;

    // ── salary.paid ───────────────────────
    // Accountant processed a salary — email + in-app to the employee
    if (eventType === EVENTS.SALARY_PAID) {
      const { paymentId, userId, amount, paymentMonth, paymentMethod } = data;

      logger.info('Processing salary.paid notification', { paymentId, userId });

      const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD',
      }).format(amount);

      const title   = `Salary Processed for ${paymentMonth}`;
      const message = `Your salary of ${formattedAmount} for ${paymentMonth} has been processed via ${paymentMethod || 'Bank Transfer'}.`;

      // In-app notification
      await NotificationModel.createNotification({
        userId,
        type:     'in_app',
        category: 'payment',
        title,
        message,
        priority: 'high',
        data:     { paymentId, link: `/financial/salaries` },
        emailSent: false,
      });

      // Email notification
      // In production, fetch user email from user-service.
      // For now we log that email would be sent.
      logger.info('Salary notification created', {
        userId,
        paymentMonth,
        amount,
        note: 'Email would be sent to user email address fetched from user-service',
      });
    }

    // ── expense.approved ──────────────────
    // Chairman approved or rejected an expense — notify submitter
    if (eventType === EVENTS.EXPENSE_APPROVED) {
      const {
        expenseId, category, amount,
        approved, rejectionReason, submittedBy,
      } = data;

      logger.info('Processing expense.approved notification', { expenseId, approved });

      const decision        = approved ? 'approved' : 'rejected';
      const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD',
      }).format(amount);

      let message = `Your ${category} expense of ${formattedAmount} has been ${decision}.`;
      if (!approved && rejectionReason) {
        message += ` Reason: ${rejectionReason}`;
      }

      await NotificationModel.createNotification({
        userId:   submittedBy,
        type:     'in_app',
        category: 'payment',
        title:    `Expense ${approved ? 'Approved' : 'Rejected'}: ${category}`,
        message,
        priority: approved ? 'medium' : 'high',
        data:     { expenseId, link: `/financial/expenses/${expenseId}` },
      });
    }

    // ── sponsorship.added ─────────────────
    // New sponsorship — notify Chairman
    if (eventType === EVENTS.SPONSORSHIP_ADDED) {
      const { sponsorshipId, sponsorName, contractValue, addedBy } = data;

      logger.info('Processing sponsorship.added notification', { sponsorshipId });

      const formattedValue = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD',
      }).format(contractValue);

      // Notify the person who added the sponsorship as confirmation
      await NotificationModel.createNotification({
        userId:   addedBy,
        type:     'in_app',
        category: 'payment',
        title:    'Sponsorship Added',
        message:  `Sponsorship from ${sponsorName} worth ${formattedValue} has been recorded successfully.`,
        priority: 'low',
        data:     { link: `/financial/sponsorships` },
      });
    }
  });

  logger.info('Financial events consumer started');
};

module.exports = { startFinancialConsumer };
