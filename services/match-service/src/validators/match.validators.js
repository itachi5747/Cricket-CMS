const Joi = require('joi');
const { commonValidators } = require('@cricket-cms/shared');
const { MATCH_TYPES, MATCH_STATUS, MATCH_RESULTS } = require('@cricket-cms/shared');

const { uuid, uuidRequired, dateString, timeString, matchType } = commonValidators;

// ─────────────────────────────────────────
// POST /api/v1/matches
// ─────────────────────────────────────────
const createMatchSchema = Joi.object({
  opponentTeam: Joi.string().min(2).max(100).required().messages({
    'string.empty': 'Opponent team name is required',
  }),
  matchDate: dateString.required().messages({
    'string.empty': 'Match date is required',
  }),
  matchTime:  timeString,
  venue:      Joi.string().min(2).max(200).required().messages({
    'string.empty': 'Venue is required',
  }),
  matchType:  matchType.required(),
  notes:      Joi.string().max(1000),
});

// ─────────────────────────────────────────
// PUT /api/v1/matches/:matchId
// All fields optional — only update what's provided
// ─────────────────────────────────────────
const updateMatchSchema = Joi.object({
  opponentTeam: Joi.string().min(2).max(100),
  matchDate:    dateString,
  matchTime:    timeString,
  venue:        Joi.string().min(2).max(200),
  matchType:    matchType,
  notes:        Joi.string().max(1000),
}).min(1).messages({ 'object.min': 'At least one field must be provided' });

// ─────────────────────────────────────────
// PUT /api/v1/matches/:matchId/result
// ─────────────────────────────────────────
const updateResultSchema = Joi.object({
  status: Joi.string()
    .valid(MATCH_STATUS.COMPLETED, MATCH_STATUS.IN_PROGRESS)
    .required()
    .messages({ 'any.only': 'Status must be Completed or In_Progress' }),

  result: Joi.string()
    .valid(...Object.values(MATCH_RESULTS))
    .when('status', {
      is: MATCH_STATUS.COMPLETED,
      then: Joi.required().messages({ 'any.required': 'Result is required when status is Completed' }),
    }),

  ourScore:      Joi.string().max(50),
  opponentScore: Joi.string().max(50),
});

// ─────────────────────────────────────────
// POST /api/v1/matches/:matchId/lineup
// players is an array of lineup entries
// ─────────────────────────────────────────
const setLineupSchema = Joi.object({
  players: Joi.array().items(
    Joi.object({
      playerId:         uuidRequired,
      battingOrder:     Joi.number().integer().min(1).max(11),
      bowlingOrder:     Joi.number().integer().min(1).max(11),
      fieldingPosition: Joi.string().max(50),
    })
  ).min(1).max(15).required().messages({
    'array.min': 'Lineup must have at least 1 player',
    'array.max': 'Lineup cannot exceed 15 players',
  }),
});

// ─────────────────────────────────────────
// POST /api/v1/matches/:matchId/logistics
// ─────────────────────────────────────────
const upsertLogisticsSchema = Joi.object({
  travelDetails:      Joi.string().max(1000),
  accommodation:      Joi.string().max(1000),
  equipmentChecklist: Joi.string().max(2000),
  notes:              Joi.string().max(1000),
}).min(1).messages({ 'object.min': 'At least one logistics field must be provided' });

// ─────────────────────────────────────────
// GET /api/v1/matches (query params)
// ─────────────────────────────────────────
const listMatchesQuerySchema = Joi.object({
  status:    Joi.string().valid(...Object.values(MATCH_STATUS)),
  matchType: Joi.string().valid(...Object.values(MATCH_TYPES)),
  from:      dateString,
  to:        dateString,
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(100).default(10),
});

// URL param schemas
const matchIdParamSchema = Joi.object({ matchId: uuidRequired });

module.exports = {
  createMatchSchema,
  updateMatchSchema,
  updateResultSchema,
  setLineupSchema,
  upsertLogisticsSchema,
  listMatchesQuerySchema,
  matchIdParamSchema,
};
