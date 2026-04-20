const winston = require('winston');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// ─────────────────────────────────────────
// Custom log format for development
// ─────────────────────────────────────────
const devFormat = printf(({ level, message, timestamp: ts, service, stack, ...meta }) => {
  let log = `${ts} [${service || 'app'}] ${level}: ${message}`;
  if (Object.keys(meta).length) log += ` ${JSON.stringify(meta)}`;
  if (stack) log += `\n${stack}`;
  return log;
});

// ─────────────────────────────────────────
// Create logger factory
// ─────────────────────────────────────────
const createLogger = (serviceName) => {
  const isProduction = process.env.NODE_ENV === 'production';

  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    defaultMeta: {
      service: serviceName,
      environment: process.env.NODE_ENV || 'development',
    },
    transports: [
      // Console transport
      new winston.transports.Console({
        format: isProduction
          ? combine(timestamp(), errors({ stack: true }), json())
          : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), devFormat),
      }),
    ],
  });

  // Add file transport in production
  if (isProduction) {
    logger.add(
      new winston.transports.File({
        filename: `logs/${serviceName}-error.log`,
        level: 'error',
        format: combine(timestamp(), errors({ stack: true }), json()),
      })
    );
    logger.add(
      new winston.transports.File({
        filename: `logs/${serviceName}-combined.log`,
        format: combine(timestamp(), json()),
      })
    );
  }

  return logger;
};

module.exports = { createLogger };
