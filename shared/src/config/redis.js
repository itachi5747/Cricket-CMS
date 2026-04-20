const { createClient } = require('redis');
const { createLogger } = require('../utils/logger');

const logger = createLogger('redis');

let client = null;

// ─────────────────────────────────────────
// connectRedis
// ─────────────────────────────────────────
const connectRedis = async () => {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL environment variable not set');

  client = createClient({ url });

  client.on('connect', () => logger.info('Redis connected'));
  client.on('error', (err) => logger.error('Redis error', { error: err.message }));
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'));

  await client.connect();
  return client;
};

// ─────────────────────────────────────────
// getRedis
// ─────────────────────────────────────────
const getRedis = () => {
  if (!client) throw new Error('Redis not initialized. Call connectRedis() first.');
  return client;
};

// ─────────────────────────────────────────
// closeRedis
// ─────────────────────────────────────────
const closeRedis = async () => {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis connection closed');
  }
};

// ─────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────

/** Store a value with optional TTL in seconds */
const setKey = async (key, value, ttlSeconds = null) => {
  const redis = getRedis();
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (ttlSeconds) {
    await redis.setEx(key, ttlSeconds, serialized);
  } else {
    await redis.set(key, serialized);
  }
};

/** Get and auto-parse JSON values */
const getKey = async (key) => {
  const redis = getRedis();
  const value = await redis.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Delete a key */
const deleteKey = async (key) => {
  const redis = getRedis();
  await redis.del(key);
};

/** Check if key exists */
const exists = async (key) => {
  const redis = getRedis();
  return (await redis.exists(key)) === 1;
};

/** Increment a counter (for rate limiting, login attempts etc.) */
const increment = async (key, ttlSeconds = null) => {
  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1 && ttlSeconds) {
    await redis.expire(key, ttlSeconds);
  }
  return count;
};

// ─────────────────────────────────────────
// Token blacklist helpers
// ─────────────────────────────────────────

const BLACKLIST_PREFIX = 'blacklist:token:';

/** Blacklist a JWT (store until its natural expiry) */
const blacklistToken = async (token, expiresInSeconds) => {
  await setKey(`${BLACKLIST_PREFIX}${token}`, '1', expiresInSeconds);
};

/** Check if a token is blacklisted */
const isTokenBlacklisted = async (token) => {
  return exists(`${BLACKLIST_PREFIX}${token}`);
};

// ─────────────────────────────────────────
// Test connection
// ─────────────────────────────────────────
const testRedisConnection = async () => {
  await getRedis().ping();
};

module.exports = {
  connectRedis,
  getRedis,
  closeRedis,
  setKey,
  getKey,
  deleteKey,
  exists,
  increment,
  blacklistToken,
  isTokenBlacklisted,
  testRedisConnection,
};
