const { Router } = require('express');
const {
  authenticateJWT,
  validate,
  validateQuery,
  validateParams,
} = require('@cricket-cms/shared');

const {
  listNotificationsQuerySchema,
  updatePreferencesSchema,
  notificationIdParamSchema,
} = require('../validators/notification.validators');

const {
  getNotifications,
  markOneAsRead,
  markAllAsRead,
  getPreferences,
  updatePreferences,
} = require('../controllers/notification.controller');

const router = Router();

// ── IMPORTANT: /read-all and /preferences before /:notificationId
// ─────────────────────────────────────────

router.get('/',
  authenticateJWT,
  validateQuery(listNotificationsQuerySchema),
  getNotifications
);

// read-all MUST come before /:notificationId/read
router.put('/read-all',
  authenticateJWT,
  markAllAsRead
);

router.put('/:notificationId/read',
  authenticateJWT,
  validateParams(notificationIdParamSchema),
  markOneAsRead
);

router.get('/preferences',
  authenticateJWT,
  getPreferences
);

router.put('/preferences',
  authenticateJWT,
  validate(updatePreferencesSchema),
  updatePreferences
);

module.exports = router;
