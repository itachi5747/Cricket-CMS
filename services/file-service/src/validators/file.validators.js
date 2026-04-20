const Joi = require('joi');
const { commonValidators } = require('@cricket-cms/shared');

const { uuidRequired, uuid, dateString } = commonValidators;

// ─────────────────────────────────────────
// File upload — sent as multipart/form-data body fields
// The actual file binary is handled by multer middleware
// ─────────────────────────────────────────
const uploadFileSchema = Joi.object({
  fileType:         Joi.string().valid('document', 'image', 'report').required(),
  relatedEntityType:Joi.string().valid('player', 'match', 'team', 'expense', 'general'),
  relatedEntityId:  uuid,
  description:      Joi.string().max(500),
  tags:             Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string() // multer sends arrays as comma-separated strings
  ),
  isPublic:         Joi.boolean().default(false),
});

// ─────────────────────────────────────────
// POST /api/v1/files/reports/generate
// ─────────────────────────────────────────
const generateReportSchema = Joi.object({
  reportType: Joi.string()
    .valid('financial', 'performance', 'attendance')
    .required()
    .messages({ 'any.only': 'reportType must be financial, performance, or attendance' }),

  reportName: Joi.string().min(3).max(200).required(),

  parameters: Joi.object({
    dateRange: Joi.object({
      start: dateString.required(),
      end:   dateString.required(),
    }),
    season:   Joi.string().pattern(/^\d{4}-\d{4}$/),
    playerId: uuid,
    filters:  Joi.object().default({}),
  }).required(),
});

// ─────────────────────────────────────────
// GET /api/v1/files/entity/:entityType/:entityId
// ─────────────────────────────────────────
const entityParamSchema = Joi.object({
  entityType: Joi.string()
    .valid('player', 'match', 'team', 'expense', 'general')
    .required(),
  entityId:   uuidRequired,
});

// URL param schemas
const fileIdParamSchema   = Joi.object({ fileId:   Joi.string().required() });
const reportIdParamSchema = Joi.object({ reportId: Joi.string().required() });

// GET /api/v1/files/reports query params
const listReportsQuerySchema = Joi.object({
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
});

module.exports = {
  uploadFileSchema,
  generateReportSchema,
  entityParamSchema,
  fileIdParamSchema,
  reportIdParamSchema,
  listReportsQuerySchema,
};
