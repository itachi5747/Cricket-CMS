const Joi = require('joi');
const { commonValidators } = require('@cricket-cms/shared');
const { PLAYER_ROLES, STAFF_TYPES, FITNESS_STATUS } = require('@cricket-cms/shared');

const { email, password, phoneNumber, uuid, dateString, positiveNumber, playerRole } = commonValidators;

// ─────────────────────────────────────────
// PUT /api/v1/users/profile
// All fields optional — only update what's provided
// ─────────────────────────────────────────
const updateProfileSchema = Joi.object({
  fullName:        Joi.string().min(2).max(255),
  contactNumber:   phoneNumber,
  address:         Joi.string().max(500),
  dateOfBirth:     dateString,
  profileImageUrl: Joi.string().uri().max(500),
}).min(1).messages({
  'object.min': 'At least one field must be provided to update',
});

// ─────────────────────────────────────────
// POST /api/v1/users/players  (Chairman adds player)
// ─────────────────────────────────────────
const createPlayerSchema = Joi.object({
  username:          Joi.string().alphanum().min(3).max(50).required(),
  email:             email.required(),
  password:          password.required(),
  fullName:          Joi.string().min(2).max(255).required(),
  contactNumber:     phoneNumber,
  playerRole:        playerRole.required(),
  jerseyNumber:      Joi.number().integer().min(1).max(999),
  salary:            positiveNumber,
  contractStartDate: dateString,
  contractEndDate:   dateString,
});

// ─────────────────────────────────────────
// PUT /api/v1/users/players/:playerId
// ─────────────────────────────────────────
const updatePlayerSchema = Joi.object({
  playerRole:        playerRole,
  jerseyNumber:      Joi.number().integer().min(1).max(999),
  salary:            positiveNumber,
  contractStartDate: dateString,
  contractEndDate:   dateString,
  fitnessStatus:     Joi.string().valid(...Object.values(FITNESS_STATUS)),
  isAvailable:       Joi.boolean(),
}).min(1).messages({
  'object.min': 'At least one field must be provided to update',
});

// ─────────────────────────────────────────
// GET /api/v1/users/players  (query params)
// ─────────────────────────────────────────
const listPlayersQuerySchema = Joi.object({
  playerRole:    Joi.string().valid(...Object.values(PLAYER_ROLES)),
  isAvailable:   Joi.boolean(),
  fitnessStatus: Joi.string().valid(...Object.values(FITNESS_STATUS)),
  page:          Joi.number().integer().min(1).default(1),
  limit:         Joi.number().integer().min(1).max(100).default(10),
});

// ─────────────────────────────────────────
// POST /api/v1/users/staff  (Chairman adds staff)
// ─────────────────────────────────────────
const createStaffSchema = Joi.object({
  username:        Joi.string().alphanum().min(3).max(50).required(),
  email:           email.required(),
  password:        password.required(),
  fullName:        Joi.string().min(2).max(255).required(),
  contactNumber:   phoneNumber,
  staffType:       Joi.string().valid(...Object.values(STAFF_TYPES)).required(),
  salary:          positiveNumber,
  hireDate:        dateString,
  contractEndDate: dateString,
  specialization:  Joi.string().max(100),
});

// ─────────────────────────────────────────
// PUT /api/v1/users/staff/:staffId
// ─────────────────────────────────────────
const updateStaffSchema = Joi.object({
  salary:          positiveNumber,
  hireDate:        dateString,
  contractEndDate: dateString,
  specialization:  Joi.string().max(100),
  contactNumber:   phoneNumber,
}).min(1).messages({
  'object.min': 'At least one field must be provided to update',
});

// ─────────────────────────────────────────
// GET /api/v1/users/staff  (query params)
// ─────────────────────────────────────────
const listStaffQuerySchema = Joi.object({
  staffType: Joi.string().valid(...Object.values(STAFF_TYPES)),
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(100).default(10),
});

// ─────────────────────────────────────────
// PUT /api/v1/users/preferences
// ─────────────────────────────────────────
const updatePreferencesSchema = Joi.object({
  theme:    Joi.string().valid('light', 'dark'),
  language: Joi.string().min(2).max(5),
  notifications: Joi.object({
    email:      Joi.boolean(),
    push:       Joi.boolean(),
    sms:        Joi.boolean(),
    match:      Joi.boolean(),
    payment:    Joi.boolean(),
    feedback:   Joi.boolean(),
    attendance: Joi.boolean(),
    squad:      Joi.boolean(),
    system:     Joi.boolean(),
  }),
  dashboardWidgets: Joi.array().items(Joi.string()),
}).min(1);

module.exports = {
  updateProfileSchema,
  createPlayerSchema,
  updatePlayerSchema,
  listPlayersQuerySchema,
  createStaffSchema,
  updateStaffSchema,
  listStaffQuerySchema,
  updatePreferencesSchema,
};
