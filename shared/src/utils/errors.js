// ─────────────────────────────────────────
// Custom Application Error class
// Thrown throughout the app, caught by errorHandler middleware
// ─────────────────────────────────────────

class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code
   * @param {*} errors - Optional validation errors or detail
   */
  constructor(message, statusCode = 500, errors = null) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true; // Marks as known/expected error (vs programmer bugs)
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─────────────────────────────────────────
// Named error factories for common cases
// ─────────────────────────────────────────

const BadRequestError = (message = 'Bad request', errors = null) =>
  new AppError(message, 400, errors);

const UnauthorizedError = (message = 'Unauthorized') =>
  new AppError(message, 401);

const ForbiddenError = (message = 'Forbidden: insufficient permissions') =>
  new AppError(message, 403);

const NotFoundError = (message = 'Resource not found') =>
  new AppError(message, 404);

const ConflictError = (message = 'Resource already exists') =>
  new AppError(message, 409);

const ValidationError = (message = 'Validation failed', errors = null) =>
  new AppError(message, 422, errors);

const TooManyRequestsError = (message = 'Too many requests, please try again later') =>
  new AppError(message, 429);

const InternalError = (message = 'Internal server error') =>
  new AppError(message, 500);

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  TooManyRequestsError,
  InternalError,
};
