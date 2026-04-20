const Joi = require('joi');
const { ROLES, PLAYER_ROLES, MATCH_TYPES } = require('../constants');

// ─────────────────────────────────────────
// Reusable field validators
// ─────────────────────────────────────────

const uuid = Joi.string().uuid({ version: 'uuidv4' }).messages({
  'string.guid': '{{#label}} must be a valid UUID',
});

const uuidRequired = uuid.required();

const email = Joi.string().email({ tlds: { allow: false } }).lowercase().trim().messages({
  'string.email': '{{#label}} must be a valid email address',
});

const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  .messages({
    'string.min': 'Password must be at least 8 characters',
    'string.pattern.base':
      'Password must contain at least one uppercase, one lowercase, one number, and one special character',
  });

const phoneNumber = Joi.string()
  .pattern(/^\+?[0-9\-\s]{7,20}$/)
  .messages({
    'string.pattern.base': '{{#label}} must be a valid phone number',
  });

const dateString = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({
    'string.pattern.base': '{{#label}} must be in YYYY-MM-DD format',
  });

const timeString = Joi.string()
  .pattern(/^\d{2}:\d{2}(:\d{2})?$/)
  .messages({
    'string.pattern.base': '{{#label}} must be in HH:MM or HH:MM:SS format',
  });

const positiveNumber = Joi.number().positive();

const role = Joi.string()
  .valid(...Object.values(ROLES))
  .messages({
    'any.only': `Role must be one of: ${Object.values(ROLES).join(', ')}`,
  });

const playerRole = Joi.string()
  .valid(...Object.values(PLAYER_ROLES))
  .messages({
    'any.only': `Player role must be one of: ${Object.values(PLAYER_ROLES).join(', ')}`,
  });

const matchType = Joi.string()
  .valid(...Object.values(MATCH_TYPES))
  .messages({
    'any.only': `Match type must be one of: ${Object.values(MATCH_TYPES).join(', ')}`,
  });

// ─────────────────────────────────────────
// Pagination query schema
// ─────────────────────────────────────────
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

// ─────────────────────────────────────────
// Date range query schema
// ─────────────────────────────────────────
const dateRangeSchema = Joi.object({
  from: dateString,
  to: dateString,
}).and('from', 'to'); // Both must be present or both absent

// ─────────────────────────────────────────
// ID param schema
// ─────────────────────────────────────────
const idParamSchema = Joi.object({
  id: uuidRequired,
});

module.exports = {
  // Primitives
  uuid,
  uuidRequired,
  email,
  password,
  phoneNumber,
  dateString,
  timeString,
  positiveNumber,
  role,
  playerRole,
  matchType,
  // Schemas
  paginationSchema,
  dateRangeSchema,
  idParamSchema,
};
