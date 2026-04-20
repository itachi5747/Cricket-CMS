const { AppError } = require('../utils/errors');
const { createLogger } = require('../utils/logger');

const logger = createLogger('error-handler');

// ─────────────────────────────────────────
// Global Error Handler Middleware
// Must be registered LAST in Express app: app.use(errorHandler)
// ─────────────────────────────────────────
const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let { errors } = err;

  // ── Handle specific error types ──

  // Joi validation errors
  if (err.isJoi || err.name === 'ValidationError') {
    statusCode = 422;
    message = 'Validation failed';
    errors = err.details?.map((d) => ({
      field: d.path?.join('.'),
      message: d.message.replace(/['"]/g, ''),
    }));
  }

  // PostgreSQL errors
  if (err.code === '23505') {
    // unique_violation
    statusCode = 409;
    message = 'Resource already exists';
    const field = err.detail?.match(/\(([^)]+)\)/)?.[1] || 'field';
    errors = [{ field, message: `${field} already in use` }];
  }

  if (err.code === '23503') {
    // foreign_key_violation
    statusCode = 400;
    message = 'Referenced resource does not exist';
  }

  if (err.code === '22P02') {
    // invalid_text_representation (bad UUID etc)
    statusCode = 400;
    message = 'Invalid ID format';
  }

  // MongoDB duplicate key error
  if (err.code === 11000) {
    statusCode = 409;
    message = 'Resource already exists';
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    errors = [{ field, message: `${field} already in use` }];
  }

  // JWT errors (shouldn't reach here normally, caught in middleware)
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token has expired';
  }

  // ── Log the error ──
  const isOperational = err instanceof AppError && err.isOperational;

  if (!isOperational || statusCode >= 500) {
    logger.error('Unhandled error', {
      message: err.message,
      stack: err.stack,
      statusCode,
      path: req.path,
      method: req.method,
      userId: req.user?.userId,
      correlationId: req.headers['x-correlation-id'],
    });
  } else {
    logger.warn('Operational error', {
      message,
      statusCode,
      path: req.path,
      method: req.method,
      userId: req.user?.userId,
    });
  }

  // ── Send response ──
  const response = {
    success: false,
    message,
  };

  if (errors) {
    response.errors = errors;
  }

  // Only include stack trace in development
  if (process.env.NODE_ENV === 'development' && !isOperational) {
    response.stack = err.stack;
  }

  return res.status(statusCode).json(response);
};

// ─────────────────────────────────────────
// 404 Not Found handler
// Register before errorHandler for unmatched routes
// ─────────────────────────────────────────
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
};

module.exports = { errorHandler, notFoundHandler };
