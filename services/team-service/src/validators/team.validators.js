const Joi = require('joi');
const { commonValidators } = require('@cricket-cms/shared');
const { SQUAD_STATUS } = require('@cricket-cms/shared');

const { uuid, uuidRequired } = commonValidators;

// POST /api/v1/teams
const createTeamSchema = Joi.object({
  name:             Joi.string().min(2).max(100).required(),
  description:      Joi.string().max(500),
  assignedCoachId:  uuid,
});

// PUT /api/v1/teams/:teamId
const updateTeamSchema = Joi.object({
  name:             Joi.string().min(2).max(100),
  description:      Joi.string().max(500),
  assignedCoachId:  uuid,
}).min(1).messages({ 'object.min': 'At least one field must be provided' });

// POST /api/v1/teams/:teamId/players
// positions is an array — each item has playerId + optional flags
const addPlayersSchema = Joi.object({
  positions: Joi.array().items(
    Joi.object({
      playerId:       uuidRequired,
      position:       Joi.string().max(50),
      isCaptain:      Joi.boolean().default(false),
      isViceCaptain:  Joi.boolean().default(false),
    })
  ).min(1).required().messages({
    'array.min': 'At least one player must be provided',
  }),
});

// POST /api/v1/teams/squads
const createSquadSchema = Joi.object({
  name:            Joi.string().min(2).max(100).required(),
  tournamentName:  Joi.string().max(150),
  teamId:          uuid,
  // Array of players with optional priority (1=starting, 2=reserve etc.)
  players: Joi.array().items(
    Joi.object({
      playerId: uuidRequired,
      priority: Joi.number().integer().min(1).max(10).default(1),
    })
  ).min(1).required().messages({
    'array.min': 'Squad must have at least one player',
  }),
});

// PUT /api/v1/teams/squads/:squadId/approve
const approveSquadSchema = Joi.object({
  approved:        Joi.boolean().required(),
  comments:        Joi.string().max(500),
  rejectionReason: Joi.string().max(500).when('approved', {
    is: false,
    then: Joi.string().max(500),
  }),
});

// Query params for GET /api/v1/teams
const listTeamsQuerySchema = Joi.object({
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

// Query params for GET /api/v1/teams/squads
const listSquadsQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(SQUAD_STATUS)),
  teamId: uuid,
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(10),
});

// URL param schemas
const teamIdParamSchema   = Joi.object({ teamId:   uuidRequired });
const squadIdParamSchema  = Joi.object({ squadId:  uuidRequired });
const playerIdParamSchema = Joi.object({
  teamId:   uuidRequired,
  playerId: uuidRequired,
});

module.exports = {
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
};
