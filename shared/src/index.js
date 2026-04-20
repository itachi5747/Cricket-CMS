// ─────────────────────────────────────────
// @cricket-cms/shared — Public API
// Everything a microservice needs, exported from one place.
//
// Usage in any service:
//   const { createApp, startServer, ROLES, AppError, authenticateJWT } = require('@cricket-cms/shared');
// ─────────────────────────────────────────

// App factory
const { createApp, startServer } = require('./config/createApp');

// Database connections
const postgres = require('./config/postgres');
const mongodb = require('./config/mongodb');
const redis = require('./config/redis');
const rabbitmq = require('./config/rabbitmq');
const { consumeQueue } = require('./config/rabbitmq');

// Middleware
const { authenticateJWT, authorizeRole, optionalAuth, requireOwnership } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { validate, validateQuery, validateParams } = require('./middleware/validate');
const { correlationId, requestLogger } = require('./middleware/requestLogger');

// Utilities
const { createLogger } = require('./utils/logger');
const {
  sendSuccess,
  sendCreated,
  sendAccepted,
  sendError,
  sendPaginated,
  getPaginationParams,
} = require('./utils/response');
const {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  TooManyRequestsError,
  InternalError,
} = require('./utils/errors');

// Constants
const constants = require('./constants');
const {
  ROLES,
  ALL_ROLES,
  PLAYER_ROLES,
  STAFF_TYPES,
  MATCH_TYPES,
  MATCH_STATUS,
  MATCH_RESULTS,
  SQUAD_STATUS,
  ATTENDANCE_STATUS,
  SESSION_TYPES,
  PAYMENT_STATUS,
  EXPENSE_STATUS,
  SPONSORSHIP_STATUS,
  TRANSACTION_TYPES,
  FITNESS_STATUS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITY,
  FILE_TYPES,
  REPORT_TYPES,
  REPORT_STATUS,
  EVENTS,
  EXCHANGES,
  QUEUES,
  PAGINATION_DEFAULTS,
  TOKEN,
} = constants;

// Validators
const commonValidators = require('./validators/common');

module.exports = {
  // App
  createApp,
  startServer,

  // DB
  postgres,
  mongodb,
  redis,
  rabbitmq,
  consumeQueue,

  // Middleware
  authenticateJWT,
  authorizeRole,
  optionalAuth,
  requireOwnership,
  errorHandler,
  notFoundHandler,
  validate,
  validateQuery,
  validateParams,
  correlationId,
  requestLogger,

  // Utils
  createLogger,
  sendSuccess,
  sendCreated,
  sendAccepted,
  sendError,
  sendPaginated,
  getPaginationParams,

  // Errors
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  TooManyRequestsError,
  InternalError,

  // Constants
  ROLES,
  ALL_ROLES,
  PLAYER_ROLES,
  STAFF_TYPES,
  MATCH_TYPES,
  MATCH_STATUS,
  MATCH_RESULTS,
  SQUAD_STATUS,
  ATTENDANCE_STATUS,
  SESSION_TYPES,
  PAYMENT_STATUS,
  EXPENSE_STATUS,
  SPONSORSHIP_STATUS,
  TRANSACTION_TYPES,
  FITNESS_STATUS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITY,
  FILE_TYPES,
  REPORT_TYPES,
  REPORT_STATUS,
  EVENTS,
  EXCHANGES,
  QUEUES,
  PAGINATION_DEFAULTS,
  TOKEN,

  // Validators
  commonValidators,
};
