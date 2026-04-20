const { Router } = require('express');
const {
  authenticateJWT,
  authorizeRole,
  validate,
  validateQuery,
  validateParams,
  commonValidators,
  ROLES,
} = require('@cricket-cms/shared');

const {
  updateProfileSchema,
  createPlayerSchema,
  updatePlayerSchema,
  listPlayersQuerySchema,
  createStaffSchema,
  updateStaffSchema,
  listStaffQuerySchema,
  updatePreferencesSchema,
} = require('../validators/user.validators');

const {
  getMyProfile,
  updateMyProfile,
  listPlayers,
  getPlayer,
  createPlayer,
  updatePlayer,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  getPreferences,
  updatePreferences,
} = require('../controllers/user.controller');

const Joi = require('joi');
const router = Router();

// ─────────────────────────────────────────
// All routes in this service require a valid JWT.
// authenticateJWT runs on every request.
// authorizeRole() is added per-route for RBAC.
// ─────────────────────────────────────────

// ── Profile (any logged-in user) ──────────
router.get('/profile',
  authenticateJWT,
  getMyProfile
);

router.put('/profile',
  authenticateJWT,
  validate(updateProfileSchema),
  updateMyProfile
);

// ── Players ───────────────────────────────
// List players — Coach, Selector, Chairman can see all players
router.get('/players',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH, ROLES.SELECTOR]),
  validateQuery(listPlayersQuerySchema),
  listPlayers
);

// Get one player — same roles
router.get('/players/:playerId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH, ROLES.SELECTOR]),
  validateParams(Joi.object({ playerId: commonValidators.uuidRequired })),
  getPlayer
);

// Create player — Chairman only
router.post('/players',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validate(createPlayerSchema),
  createPlayer
);

// Update player — Chairman or Coach
router.put('/players/:playerId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH]),
  validateParams(Joi.object({ playerId: commonValidators.uuidRequired })),
  validate(updatePlayerSchema),
  updatePlayer
);

// ── Staff ─────────────────────────────────
// All staff operations — Chairman only
router.get('/staff',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validateQuery(listStaffQuerySchema),
  listStaff
);

router.post('/staff',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validate(createStaffSchema),
  createStaff
);

router.put('/staff/:staffId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validateParams(Joi.object({ staffId: commonValidators.uuidRequired })),
  validate(updateStaffSchema),
  updateStaff
);

router.delete('/staff/:staffId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validateParams(Joi.object({ staffId: commonValidators.uuidRequired })),
  deleteStaff
);

// ── Preferences ───────────────────────────
// Any logged-in user can manage their own preferences
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
