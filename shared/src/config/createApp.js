const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const { correlationId, requestLogger } = require('../middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

// ─────────────────────────────────────────
// createApp
// Factory that bootstraps an Express app with all shared middleware.
// Each microservice calls this instead of manually setting up Express.
//
// Usage:
//   const { createApp } = require('@cricket-cms/shared');
//   const app = createApp('auth-service');
//   // Mount your routes:
//   app.use('/api/v1/auth', authRoutes);
//   // Start:
//   app.listen(3001);
// ─────────────────────────────────────────
const createApp = (serviceName, options = {}) => {
  const app = express();
  const logger = createLogger(serviceName);

  // ── Security headers ──
  app.use(helmet());

  // ── CORS ──
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-correlation-id',
        'x-user-id',
        'x-user-role',
      ],
      credentials: true,
    })
  );

  // ── Compression ──
  app.use(compression());

  // ── Body parsing ──
  app.use(express.json({ limit: options.jsonLimit || '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── Correlation ID ──
  app.use(correlationId);

  // ── HTTP request logging ──
  app.use(requestLogger());

  // ── Health check endpoints (no auth required) ──
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'UP',
      service: serviceName,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (req, res) => {
    try {
      // Each service can override readiness check by passing options.readinessCheck
      if (options.readinessCheck) {
        await options.readinessCheck();
      }
      res.status(200).json({
        status: 'READY',
        service: serviceName,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Readiness check failed', { error: error.message });
      res.status(503).json({
        status: 'NOT_READY',
        service: serviceName,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── Attach logger to app for service-level use ──
  app.locals.logger = logger;

  // ── Return app — service mounts its own routes before calling startServer ──
  // errorHandler and notFoundHandler are added by startServer() below

  return app;
};

// ─────────────────────────────────────────
// startServer
// Called AFTER all routes are mounted.
// Adds 404 + error handlers, starts listening.
// ─────────────────────────────────────────
const startServer = (app, port, serviceName) => {
  const logger = createLogger(serviceName);

  // These must be LAST
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = app.listen(port, () => {
    logger.info(`${serviceName} running`, {
      port,
      env: process.env.NODE_ENV || 'development',
      pid: process.pid,
    });
  });

  // ── Graceful shutdown ──
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);

    server.close(async () => {
      logger.info('HTTP server closed');

      // Close DB connections if cleanup function provided
      if (app.locals.cleanup) {
        try {
          await app.locals.cleanup();
          logger.info('Connections closed');
        } catch (err) {
          logger.error('Error during cleanup', { error: err.message });
        }
      }

      process.exit(0);
    });

    // Force exit after 10s if graceful shutdown stalls
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { reason, promise });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  return server;
};

module.exports = { createApp, startServer };
