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
  recordPerformanceSchema,
  playerHistoryQuerySchema,
  playerStatsQuerySchema,
  compareQuerySchema,
  playerIdParamSchema,
  matchIdParamSchema,
} = require('../validators/performance.validators');

const {
  recordPerformance,
  getPlayerHistory,
  getPlayerStats,
  getMatchPerformances,
  comparePlayers,
} = require('../controllers/performance.controller');

const router = Router();

// ── IMPORTANT: specific named routes (/record, /compare)
// must come before parameterized routes (/player/:id, /match/:id)
// ─────────────────────────────────────────

// POST /record — Coach only
router.post('/record',
  authenticateJWT,
  authorizeRole([ROLES.COACH]),
  validate(recordPerformanceSchema),
  recordPerformance
);

// GET /compare — Selector, Coach, Chairman
router.get('/compare',
  authenticateJWT,
  authorizeRole([ROLES.SELECTOR, ROLES.COACH, ROLES.CHAIRMAN]),
  validateQuery(compareQuerySchema),
  comparePlayers
);

// GET /match/:matchId — all roles
router.get('/match/:matchId',
  authenticateJWT,
  validateParams(matchIdParamSchema),
  getMatchPerformances
);

// GET /player/:playerId — Coach, Chairman, Selector, and Player (own only)
router.get('/player/:playerId',
  authenticateJWT,
  authorizeRole([ROLES.COACH, ROLES.CHAIRMAN, ROLES.SELECTOR, ROLES.PLAYER]),
  validateParams(playerIdParamSchema),
  validateQuery(playerHistoryQuerySchema),
  getPlayerHistory
);

// GET /player/:playerId/stats — all roles
router.get('/player/:playerId/stats',
  authenticateJWT,
  validateParams(playerIdParamSchema),
  validateQuery(playerStatsQuerySchema),
  getPlayerStats
);

module.exports = router;
