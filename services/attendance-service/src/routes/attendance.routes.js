const { Router } = require('express');
const {
  authenticateJWT,
  authorizeRole,
  validate,
  validateQuery,
  validateParams,
  ROLES,
} = require('@cricket-cms/shared');

const {
  createSessionSchema,
  updateSessionSchema,
  markAttendanceSchema,
  listSessionsQuerySchema,
  playerHistoryQuerySchema,
  summaryQuerySchema,
  sessionIdParamSchema,
  playerIdParamSchema,
} = require('../validators/attendance.validators');

const {
  createSession,
  listSessions,
  getSession,
  updateSession,
  markAttendance,
  getSessionAttendance,
  getPlayerHistory,
  getMonthlySummary,
} = require('../controllers/attendance.controller');

const router = Router();

// ── IMPORTANT: named routes (/summary, /player/:id)
// must come before /:sessionId to avoid routing conflicts
// ─────────────────────────────────────────

// ── Summary — before /:sessionId ──────────
router.get('/summary',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH]),
  validateQuery(summaryQuerySchema),
  getMonthlySummary
);

// ── Player history — before /:sessionId ───
router.get('/player/:playerId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH, ROLES.PLAYER]),
  validateParams(playerIdParamSchema),
  validateQuery(playerHistoryQuerySchema),
  getPlayerHistory
);

// ── Sessions ──────────────────────────────
router.get('/sessions',
  authenticateJWT,
  validateQuery(listSessionsQuerySchema),
  listSessions
);

router.post('/sessions',
  authenticateJWT,
  authorizeRole([ROLES.COACH]),
  validate(createSessionSchema),
  createSession
);

router.get('/sessions/:sessionId',
  authenticateJWT,
  validateParams(sessionIdParamSchema),
  getSession
);

router.put('/sessions/:sessionId',
  authenticateJWT,
  authorizeRole([ROLES.COACH]),
  validateParams(sessionIdParamSchema),
  validate(updateSessionSchema),
  updateSession
);

// ── Mark attendance ───────────────────────
router.post('/sessions/:sessionId/mark',
  authenticateJWT,
  authorizeRole([ROLES.COACH]),
  validateParams(sessionIdParamSchema),
  validate(markAttendanceSchema),
  markAttendance
);

// ── Get session attendance ─────────────────
router.get('/sessions/:sessionId/attendance',
  authenticateJWT,
  validateParams(sessionIdParamSchema),
  getSessionAttendance
);

module.exports = router;
