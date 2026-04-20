const { Pool } = require('pg');
const { createLogger } = require('../utils/logger');

const logger = createLogger('postgres');

let pool = null;

// ─────────────────────────────────────────
// createPool
// Call once during service startup.
// ─────────────────────────────────────────
const createPool = (options = {}) => {
  if (pool) return pool;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: options.max || 20,             // Max connections in pool
    min: options.min || 2,              // Min idle connections
    idleTimeoutMillis: 30000,           // Close idle connections after 30s
    connectionTimeoutMillis: 5000,      // Fail fast if can't connect
    ...options,
  });

  pool.on('connect', () => {
    logger.debug('New PostgreSQL client connected');
  });

  pool.on('error', (err) => {
    logger.error('PostgreSQL pool error', { error: err.message });
  });

  return pool;
};

// ─────────────────────────────────────────
// getPool
// Returns the existing pool (must call createPool first)
// ─────────────────────────────────────────
const getPool = () => {
  if (!pool) throw new Error('PostgreSQL pool not initialized. Call createPool() first.');
  return pool;
};

// ─────────────────────────────────────────
// query
// Convenience wrapper with logging
// ─────────────────────────────────────────
const query = async (text, params) => {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;

  if (process.env.NODE_ENV === 'development') {
    logger.debug('Query executed', { text, duration, rows: result.rowCount });
  }

  return result;
};

// ─────────────────────────────────────────
// transaction
// Wraps multiple queries in a BEGIN/COMMIT/ROLLBACK transaction.
// Usage:
//   await transaction(async (client) => {
//     await client.query('INSERT ...');
//     await client.query('UPDATE ...');
//   });
// ─────────────────────────────────────────
const transaction = async (callback) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────
// testConnection
// Used by readiness check
// ─────────────────────────────────────────
const testConnection = async () => {
  await query('SELECT 1');
};

// ─────────────────────────────────────────
// closePool
// Call during graceful shutdown
// ─────────────────────────────────────────
const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
};

module.exports = { createPool, getPool, query, transaction, testConnection, closePool };
