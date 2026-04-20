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
  createTeamSchema,
  updateTeamSchema,
  addPlayersSchema,
  createSquadSchema,
  approveSquadSchema,
  listTeamsQuerySchema,
  listSquadsQuerySchema,
  teamIdParamSchema,
  squadIdParamSchema,
  playerIdParamSchema,
} = require('../validators/team.validators');

const {
  createTeam,
  listTeams,
  getTeam,
  updateTeam,
  deleteTeam,
  addPlayersToTeam,
  removePlayerFromTeam,
  createSquad,
  listSquads,
  getSquad,
  finalizeSquad,
  approveSquad,
} = require('../controllers/team.controller');

const router = Router();

// All routes require authentication
// ─────────────────────────────────────────

// ── IMPORTANT: /squads routes MUST come before /:teamId routes ──
// Express matches routes top-to-bottom.
// If /:teamId came first, the string "squads" would be treated as a teamId param.
// This is a classic Express routing gotcha.
// ─────────────────────────────────────────

// ── Squads ────────────────────────────────
router.get('/squads',
  authenticateJWT,
  validateQuery(listSquadsQuerySchema),
  listSquads
);

router.post('/squads',
  authenticateJWT,
  authorizeRole([ROLES.SELECTOR]),
  validate(createSquadSchema),
  createSquad
);

router.get('/squads/:squadId',
  authenticateJWT,
  validateParams(squadIdParamSchema),
  getSquad
);

router.put('/squads/:squadId/finalize',
  authenticateJWT,
  authorizeRole([ROLES.SELECTOR]),
  validateParams(squadIdParamSchema),
  finalizeSquad
);

router.put('/squads/:squadId/approve',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validateParams(squadIdParamSchema),
  validate(approveSquadSchema),
  approveSquad
);

// ── Teams ─────────────────────────────────
router.get('/',
  authenticateJWT,
  validateQuery(listTeamsQuerySchema),
  listTeams
);

router.post('/',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validate(createTeamSchema),
  createTeam
);

router.get('/:teamId',
  authenticateJWT,
  validateParams(teamIdParamSchema),
  getTeam
);

router.put('/:teamId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH]),
  validateParams(teamIdParamSchema),
  validate(updateTeamSchema),
  updateTeam
);

router.delete('/:teamId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validateParams(teamIdParamSchema),
  deleteTeam
);

// ── Team Players ──────────────────────────
router.post('/:teamId/players',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH]),
  validateParams(teamIdParamSchema),
  validate(addPlayersSchema),
  addPlayersToTeam
);

router.delete('/:teamId/players/:playerId',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.COACH]),
  validateParams(playerIdParamSchema),
  removePlayerFromTeam
);

module.exports = router;
