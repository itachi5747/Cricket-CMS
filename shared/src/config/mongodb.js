const mongoose = require('mongoose');
const { createLogger } = require('../utils/logger');

const logger = createLogger('mongodb');

// ─────────────────────────────────────────
// connectMongo
// Establishes Mongoose connection.
// ─────────────────────────────────────────
const connectMongo = async (options = {}) => {
  const uri = process.env.MONGODB_URL;
  if (!uri) throw new Error('MONGODB_URL environment variable not set');

  mongoose.set('strictQuery', true);

  // Connection event handlers
  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected', { uri: uri.replace(/\/\/.*@/, '//***@') });
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { error: err.message });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  await mongoose.connect(uri, {
    maxPoolSize: options.maxPoolSize || 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    ...options,
  });

  return mongoose.connection;
};

// ─────────────────────────────────────────
// closeMongo
// Call during graceful shutdown
// ─────────────────────────────────────────
const closeMongo = async () => {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
};

// ─────────────────────────────────────────
// testMongoConnection
// Used by readiness check
// ─────────────────────────────────────────
const testMongoConnection = async () => {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB not connected');
  }
};

module.exports = { connectMongo, closeMongo, testMongoConnection };
