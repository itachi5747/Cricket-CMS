const Joi = require('joi');
const { commonValidators } = require('@cricket-cms/shared');
const { MATCH_TYPES } = require('@cricket-cms/shared');

const { uuidRequired, uuid, dateString, matchType } = commonValidators;

// ─────────────────────────────────────────
// POST /api/v1/performance/record
// Coach submits one player's performance for one match
// ─────────────────────────────────────────
const recordPerformanceSchema = Joi.object({
  playerId:  uuidRequired,
  matchId:   uuidRequired,
  matchDate: dateString.required(),
  matchType: matchType.required(),
  opponent:  Joi.string().min(2).max(100).required(),

  batting: Joi.object({
    runs:          Joi.number().integer().min(0).default(0),
    ballsFaced:    Joi.number().integer().min(0).default(0),
    fours:         Joi.number().integer().min(0).default(0),
    sixes:         Joi.number().integer().min(0).default(0),
    dismissalType: Joi.string().valid(
      'Bowled', 'Caught', 'LBW', 'Run Out', 'Stumped',
      'Hit Wicket', 'Retired', 'Not Out', 'Did Not Bat'
    ),
    position: Joi.number().integer().min(1).max(11),
    didBat:   Joi.boolean().default(true),
  }).default({}),

  bowling: Joi.object({
    overs:         Joi.number().min(0).default(0),
    maidens:       Joi.number().integer().min(0).default(0),
    runsConceded:  Joi.number().integer().min(0).default(0),
    wickets:       Joi.number().integer().min(0).max(10).default(0),
    dotBalls:      Joi.number().integer().min(0).default(0),
    didBowl:       Joi.boolean().default(false),
  }).default({}),

  fielding: Joi.object({
    catches:   Joi.number().integer().min(0).default(0),
    runOuts:   Joi.number().integer().min(0).default(0),
    stumpings: Joi.number().integer().min(0).default(0),
  }).default({}),

  playerOfMatch: Joi.boolean().default(false),
  rating:        Joi.number().min(1).max(10),
  coachNotes:    Joi.string().max(1000),
});

// ─────────────────────────────────────────
// GET /api/v1/performance/player/:playerId  (query params)
// ─────────────────────────────────────────
const playerHistoryQuerySchema = Joi.object({
  from:      dateString,
  to:        dateString,
  matchType: Joi.string().valid(...Object.values(MATCH_TYPES)),
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(100).default(10),
});

// ─────────────────────────────────────────
// GET /api/v1/performance/player/:playerId/stats  (query params)
// ─────────────────────────────────────────
const playerStatsQuerySchema = Joi.object({
  season:    Joi.string().pattern(/^\d{4}-\d{4}$/),
  matchType: Joi.string().valid(...Object.values(MATCH_TYPES)),
});

// ─────────────────────────────────────────
// GET /api/v1/performance/compare  (query params)
// playerIds = comma-separated UUIDs
// ─────────────────────────────────────────
const compareQuerySchema = Joi.object({
  playerIds: Joi.string()
    .pattern(/^[0-9a-f-]+(,[0-9a-f-]+)*$/i)
    .required()
    .messages({
      'string.pattern.base': 'playerIds must be comma-separated UUIDs',
      'string.empty': 'playerIds is required',
    }),
  season: Joi.string().pattern(/^\d{4}-\d{4}$/),
});

// URL param schemas
const playerIdParamSchema  = Joi.object({ playerId:  uuidRequired });
const matchIdParamSchema   = Joi.object({ matchId:   uuidRequired });

module.exports = {
  recordPerformanceSchema,
  playerHistoryQuerySchema,
  playerStatsQuerySchema,
  compareQuerySchema,
  playerIdParamSchema,
  matchIdParamSchema,
};
