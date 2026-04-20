const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../utils/logger');

const logger = createLogger('http');

// ─────────────────────────────────────────
// Correlation ID Middleware
// Injects a unique request ID for distributed tracing across services
// ─────────────────────────────────────────
const correlationId = (req, res, next) => {
  const id = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = id;
  res.setHeader('x-correlation-id', id);
  next();
};

// ─────────────────────────────────────────
// HTTP Request Logger
// Uses morgan in dev, structured JSON in production
// ─────────────────────────────────────────
const requestLogger = () => {
  if (process.env.NODE_ENV === 'production') {
    // Structured JSON logging for production log aggregators (ELK, CloudWatch)
    morgan.token('correlation-id', (req) => req.correlationId);
    morgan.token('user-id', (req) => req.user?.userId || 'anonymous');

    return morgan(
      (tokens, req, res) => {
        return JSON.stringify({
          method: tokens.method(req, res),
          url: tokens.url(req, res),
          status: parseInt(tokens.status(req, res), 10),
          responseTime: parseFloat(tokens['response-time'](req, res)),
          contentLength: tokens.res(req, res, 'content-length'),
          correlationId: tokens['correlation-id'](req, res),
          userId: tokens['user-id'](req, res),
          timestamp: new Date().toISOString(),
        });
      },
      {
        stream: {
          write: (message) => logger.info(JSON.parse(message)),
        },
        skip: (req) => req.path === '/health' || req.path === '/ready',
      }
    );
  }

  // Dev: colorized, human-readable
  return morgan('dev', {
    skip: (req) => req.path === '/health' || req.path === '/ready',
  });
};

module.exports = { correlationId, requestLogger };
