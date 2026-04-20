const Joi = require('joi');
const { commonValidators } = require('@cricket-cms/shared');
const { ATTENDANCE_STATUS, SESSION_TYPES } = require('@cricket-cms/shared');

const { uuidRequired, uuid, dateString, timeString } = commonValidators;

// POST /api/v1/attendance/sessions
const createSessionSchema = Joi.object({
  sessionName: Joi.string().min(2).max(100).required().messages({
    'string.empty': 'Session name is required',
  }),
  sessionType: Joi.string()
    .valid(...Object.values(SESSION_TYPES))
    .required()
    .messages({
      'any.only': `Session type must be one of: ${Object.values(SESSION_TYPES).join(', ')}`,
    }),
  sessionDate: dateString.required(),
  startTime:   timeString.required(),
  endTime:     timeString.required(),
  venue:       Joi.string().max(200),
  coachId:     uuid,
  notes:       Joi.string().max(1000),
});

// PUT /api/v1/attendance/sessions/:sessionId
const updateSessionSchema = Joi.object({
  sessionName: Joi.string().min(2).max(100),
  sessionType: Joi.string().valid(...Object.values(SESSION_TYPES)),
  sessionDate: dateString,
  startTime:   timeString,
  endTime:     timeString,
  venue:       Joi.string().max(200),
  notes:       Joi.string().max(1000),
}).min(1).messages({ 'object.min': 'At least one field must be provided' });

// POST /api/v1/attendance/sessions/:sessionId/mark
// attendanceRecords is an array — one entry per player
const markAttendanceSchema = Joi.object({
  attendanceRecords: Joi.array().items(
    Joi.object({
      playerId:    uuidRequired,
      status:      Joi.string()
        .valid(...Object.values(ATTENDANCE_STATUS))
        .required()
        .messages({
          'any.only': `Status must be one of: ${Object.values(ATTENDANCE_STATUS).join(', ')}`,
        }),
      // arrivalTime only makes sense for Present or Late
      arrivalTime: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/),
      notes:       Joi.string().max(500),
    })
  ).min(1).required().messages({
    'array.min': 'At least one attendance record must be provided',
  }),
});

// GET /api/v1/attendance/sessions query params
const listSessionsQuerySchema = Joi.object({
  sessionType: Joi.string().valid(...Object.values(SESSION_TYPES)),
  from:        dateString,
  to:          dateString,
  page:        Joi.number().integer().min(1).default(1),
  limit:       Joi.number().integer().min(1).max(100).default(10),
});

// GET /api/v1/attendance/player/:playerId query params
const playerHistoryQuerySchema = Joi.object({
  from:  dateString,
  to:    dateString,
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

// GET /api/v1/attendance/summary query params
const summaryQuerySchema = Joi.object({
  month: Joi.string()
    .pattern(/^\d{4}-\d{2}$/)
    .required()
    .messages({
      'string.pattern.base': 'month must be in YYYY-MM format e.g. 2026-03',
      'string.empty':        'month is required',
    }),
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

// URL params
const sessionIdParamSchema = Joi.object({ sessionId: uuidRequired });
const playerIdParamSchema  = Joi.object({ playerId:  uuidRequired });

module.exports = {
  createSessionSchema,
  updateSessionSchema,
  markAttendanceSchema,
  listSessionsQuerySchema,
  playerHistoryQuerySchema,
  summaryQuerySchema,
  sessionIdParamSchema,
  playerIdParamSchema,
};
