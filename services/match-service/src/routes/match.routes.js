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
  createMatchSchema,
  updateMatchSchema,
  updateResultSchema,
  setLineupSchema,
  upsertLogisticsSchema,
  listMatchesQuerySchema,
  matchIdParamSchema,
} = require('../validators/match.validators');

const {
  createMatch,
  listMatches,
  getMatch,
  updateMatch,
  deleteMatch,
  setLineup,
  getLineup,
  updateResult,
  upsertLogistics,
  getLogistics,
} = require('../controllers/match.controller');

const router = Router();

// ── IMPORTANT: specific sub-routes (/lineup, /logistics, /result)
// must be defined BEFORE the /:matchId catch-all route
// for the same reason as in team.routes.js
// ─────────────────────────────────────────

// ── Match list & creation ─────────────────
router.get('/',
  authenticateJWT,
  validateQuery(listMatchesQuerySchema),
  listMatches
);

router.post('/',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH]),
  validate(createMatchSchema),
  createMatch
);

// ── Match detail, update, delete ──────────
router.get('/:matchId',
  authenticateJWT,
  validateParams(matchIdParamSchema),
  getMatch
);

router.put('/:matchId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH]),
  validateParams(matchIdParamSchema),
  validate(updateMatchSchema),
  updateMatch
);

router.delete('/:matchId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validateParams(matchIdParamSchema),
  deleteMatch
);

// ── Lineup ────────────────────────────────
router.post('/:matchId/lineup',
  authenticateJWT,
  authorizeRole([ROLES.COACH]),
  validateParams(matchIdParamSchema),
  validate(setLineupSchema),
  setLineup
);

router.get('/:matchId/lineup',
  authenticateJWT,
  validateParams(matchIdParamSchema),
  getLineup
);

// ── Result ────────────────────────────────
router.put('/:matchId/result',
  authenticateJWT,
  authorizeRole([ROLES.COACH]),
  validateParams(matchIdParamSchema),
  validate(updateResultSchema),
  updateResult
);

// ── Logistics ─────────────────────────────
router.post('/:matchId/logistics',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH]),
  validateParams(matchIdParamSchema),
  validate(upsertLogisticsSchema),
  upsertLogistics
);

router.get('/:matchId/logistics',
  authenticateJWT,
  validateParams(matchIdParamSchema),
  getLogistics
);

module.exports = router;
