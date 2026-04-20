const {
  sendSuccess,
  sendPaginated,
  NotFoundError,
  getPaginationParams,
  createLogger,
} = require('@cricket-cms/shared');

const NotificationModel = require('../models/notification.model');

const logger = createLogger('notification-controller');

// ─────────────────────────────────────────
// GET /api/v1/notifications
// Returns paginated notifications for the logged-in user
// ─────────────────────────────────────────
const getNotifications = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const { page, limit, offset } = getPaginationParams(req.query);
    const { read, category } = req.query;

    const readFilter = read !== undefined
      ? read === 'true' || read === true
      : undefined;

    const { notifications, total, unreadCount } = await NotificationModel.getUserNotifications({
      userId,
      read:     readFilter,
      category,
      limit,
      skip:     offset,
    });

    return sendPaginated(
      res,
      notifications.map((n) => ({
        notificationId: n._id,
        type:           n.type,
        category:       n.category,
        title:          n.title,
        message:        n.message,
        priority:       n.priority,
        read:           n.read,
        readAt:         n.readAt,
        data:           n.data,
        sentAt:         n.sentAt,
      })),
      { page, limit, total },
      'Notifications retrieved',
      { unreadCount }
    );

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// PUT /api/v1/notifications/:notificationId/read
// ─────────────────────────────────────────
const markOneAsRead = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const { userId } = req.user;

    const updated = await NotificationModel.markAsRead(notificationId, userId);
    if (!updated) throw NotFoundError('Notification not found');

    return sendSuccess(res, null, 'Notification marked as read');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// PUT /api/v1/notifications/read-all
// ─────────────────────────────────────────
const markAllAsRead = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const markedCount = await NotificationModel.markAllAsRead(userId);

    return sendSuccess(res, { markedCount }, 'All notifications marked as read');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/notifications/preferences
// Returns in-memory defaults — in a full system
// these would be stored per-user in MongoDB (user_preferences collection)
// which lives in user-service. For this service we return the structure.
// ─────────────────────────────────────────
const getPreferences = async (req, res, next) => {
  try {
    // Default preferences — in production fetch from user-service
    return sendSuccess(res, {
      email: true,
      push:  true,
      sms:   false,
      categories: {
        match:       true,
        payment:     true,
        feedback:    true,
        system:      false,
        attendance:  true,
        squad:       true,
        performance: true,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// PUT /api/v1/notifications/preferences
// In a full system this would persist to user-service MongoDB.
// Here we acknowledge the update and echo back.
// ─────────────────────────────────────────
const updatePreferences = async (req, res, next) => {
  try {
    logger.info('Notification preferences updated', { userId: req.user.userId });
    return sendSuccess(res, req.body, 'Preferences updated successfully');
  } catch (err) { next(err); }
};

module.exports = {
  getNotifications,
  markOneAsRead,
  markAllAsRead,
  getPreferences,
  updatePreferences,
};
