const { increment, createLogger } = require('@cricket-cms/shared');
const { getRedis } = require('@cricket-cms/shared').redis;

const logger = createLogger('rate-limiter');

// ─────────────────────────────────────────
// createRateLimiter
// Factory that returns an Express middleware.
// Uses Redis atomic INCR so it works correctly
// across multiple gateway instances.
//
// Key strategy:
//   Authenticated users: keyed by userId
//     → prevents one user flooding from many IPs
//   Unauthenticated (public routes): keyed by IP
//     → prevents brute-force on login/register
// ─────────────────────────────────────────
const createRateLimiter = ({
  windowSeconds = 60,
  maxRequests   = 100,
  message       = 'Too many requests. Please try again later.',
} = {}) => {
  return async (req, res, next) => {
    try {
      // Key by userId for authenticated requests, IP for anonymous
      const identifier = req.user?.userId || req.ip || 'anonymous';
      const key = `rate_limit:${identifier}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;

      // Atomically increment and set TTL on first hit
      const redis = getRedis();
      const count = await redis.incr(key);

      if (count === 1) {
        // First request in this window — set expiry
        await redis.expire(key, windowSeconds);
      }

      // Set rate limit headers so clients can see their status
      res.setHeader('X-RateLimit-Limit',     maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));
      res.setHeader('X-RateLimit-Reset',
        Math.ceil(Date.now() / 1000) + windowSeconds
      );

      if (count > maxRequests) {
        logger.warn('Rate limit exceeded', {
          identifier,
          count,
          limit:  maxRequests,
          path:   req.path,
          method: req.method,
        });

        return res.status(429).json({
          success:    false,
          message,
          retryAfter: windowSeconds,
        });
      }

      next();
    } catch (err) {
      // If Redis is down, fail open (allow the request through)
      // rather than breaking the entire gateway
      logger.error('Rate limiter Redis error — failing open', { error: err.message });
      next();
    }
  };
};

// ─────────────────────────────────────────
// Standard limiters used in routes
// ─────────────────────────────────────────

// General API limit — 100 requests per minute per user
const apiRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests:   parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  message:       'API rate limit exceeded. Maximum 100 requests per minute.',
});

// Strict limiter for auth endpoints — 10 per minute per IP
const authRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests:   10,
  message:       'Too many authentication attempts. Please wait before trying again.',
});

// File upload limiter — 20 per minute (uploads are heavy)
const uploadRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests:   20,
  message:       'Upload rate limit exceeded. Maximum 20 uploads per minute.',
});

module.exports = { createRateLimiter, apiRateLimiter, authRateLimiter, uploadRateLimiter };
