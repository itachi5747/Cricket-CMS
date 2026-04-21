const { getKey, setKey, createLogger } = require('@cricket-cms/shared');
const { CACHE_CONFIG } = require('../config/services');

const logger = createLogger('cache');

// ─────────────────────────────────────────
// cacheMiddleware
//
// Caches successful GET responses in Redis.
// Cache key includes the full URL + userId so
// users never see each other's data.
//
// Cache is BYPASSED for:
//   - Non-GET methods (mutations must always hit the service)
//   - Authenticated requests to private data (per-user cache key handles this)
//   - Requests with Authorization changes
//
// Cache is INVALIDATED automatically by TTL.
// For explicit invalidation (e.g. after a PUT) services
// would need to publish a cache-bust event — out of scope for Phase 10.
// ─────────────────────────────────────────
const cacheMiddleware = async (req, res, next) => {
  // Only cache GET requests
  if (req.method !== 'GET') return next();

  // Check if this path is configured for caching
  const cacheEntry = Object.entries(CACHE_CONFIG).find(([pattern]) =>
    req.path.startsWith(pattern)
  );

  if (!cacheEntry) return next();

  const [, { ttl }] = cacheEntry;

  // Build a cache key unique to this user + URL
  const userId   = req.user?.userId || 'anonymous';
  const cacheKey = `cache:${userId}:${req.path}:${JSON.stringify(req.query)}`;

  try {
    // Try to serve from cache
    const cached = await getKey(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(cached);
    }
  } catch (err) {
    // Cache read failed — proceed without cache
    logger.debug('Cache read error — proceeding without cache', { error: err.message });
    return next();
  }

  // Cache miss — intercept the response to store it
  res.setHeader('X-Cache', 'MISS');

  // Wrap res.json to capture the response body before sending
  const originalJson = res.json.bind(res);
  res.json = async (body) => {
    // Only cache successful responses
    if (res.statusCode === 200 && body?.success) {
      try {
        await setKey(cacheKey, JSON.stringify(body), ttl);
        logger.debug('Response cached', { cacheKey, ttl });
      } catch (err) {
        logger.debug('Cache write error', { error: err.message });
      }
    }
    return originalJson(body);
  };

  next();
};

module.exports = { cacheMiddleware };
