const { ValidationError } = require('../utils/errors');

// ─────────────────────────────────────────
// Joi Validation Middleware Factory
// Usage: router.post('/register', validate(schemas.register), controller)
// ─────────────────────────────────────────

/**
 * Validate request body against a Joi schema
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,   // Report all errors, not just first
      stripUnknown: true,  // Remove unknown fields
      convert: true,       // Type coercion (string '5' → number 5)
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      return next(ValidationError('Validation failed', errors));
    }

    req.body = value; // Replace with sanitized/coerced values
    next();
  };
};

/**
 * Validate query parameters against a Joi schema
 */
const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      return next(ValidationError('Invalid query parameters', errors));
    }

    req.query = value;
    next();
  };
};

/**
 * Validate URL params against a Joi schema
 */
const validateParams = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      return next(ValidationError('Invalid URL parameters', errors));
    }

    req.params = value;
    next();
  };
};

module.exports = { validate, validateQuery, validateParams };
