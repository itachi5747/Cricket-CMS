const { Router } = require('express');
const { SERVICES } = require('../config/services');
const { gatewayAuth } = require('../middleware/auth.middleware');
const { apiRateLimiter, authRateLimiter, uploadRateLimiter } = require('../middleware/rateLimit.middleware');
const { cacheMiddleware } = require('../middleware/cache.middleware');
const { createServiceProxy } = require('../middleware/proxy.middleware');

const router = Router();

// ─────────────────────────────────────────
// Pre-create proxy instances for each service.
// Proxies are created once at startup, not per-request.
// ─────────────────────────────────────────
const proxies = Object.fromEntries(
  Object.entries(SERVICES).map(([key, service]) => [
    key,
    createServiceProxy(service),
  ])
);

// ─────────────────────────────────────────
// AUTH SERVICE
// Public endpoints (login, register etc.) skip JWT check.
// Auth endpoints get a stricter rate limiter (10/min vs 100/min).
// ─────────────────────────────────────────
router.use(
  SERVICES.auth.prefix,
  authRateLimiter,    // stricter: 10 req/min
  gatewayAuth,        // will pass-through for public paths
  proxies.auth
);

// ─────────────────────────────────────────
// USER SERVICE
// ─────────────────────────────────────────
router.use(
  SERVICES.user.prefix,
  apiRateLimiter,
  gatewayAuth,
  cacheMiddleware,
  proxies.user
);

// ─────────────────────────────────────────
// TEAM SERVICE
// ─────────────────────────────────────────
router.use(
  SERVICES.team.prefix,
  apiRateLimiter,
  gatewayAuth,
  cacheMiddleware,
  proxies.team
);

// ─────────────────────────────────────────
// MATCH SERVICE
// ─────────────────────────────────────────
router.use(
  SERVICES.match.prefix,
  apiRateLimiter,
  gatewayAuth,
  cacheMiddleware,
  proxies.match
);

// ─────────────────────────────────────────
// PERFORMANCE SERVICE
// ─────────────────────────────────────────
router.use(
  SERVICES.performance.prefix,
  apiRateLimiter,
  gatewayAuth,
  proxies.performance
);

// ─────────────────────────────────────────
// FINANCIAL SERVICE
// ─────────────────────────────────────────
router.use(
  SERVICES.financial.prefix,
  apiRateLimiter,
  gatewayAuth,
  proxies.financial
);

// ─────────────────────────────────────────
// NOTIFICATION SERVICE
// ─────────────────────────────────────────
router.use(
  SERVICES.notification.prefix,
  apiRateLimiter,
  gatewayAuth,
  proxies.notification
);

// ─────────────────────────────────────────
// FILE SERVICE
// Uploads get a dedicated rate limiter since
// they are expensive (multipart parsing + MinIO upload)
// ─────────────────────────────────────────
router.use(
  SERVICES.file.prefix,
  (req, res, next) => {
    // Apply stricter limiter for upload endpoint only
    if (req.path === '/upload' && req.method === 'POST') {
      return uploadRateLimiter(req, res, next);
    }
    return apiRateLimiter(req, res, next);
  },
  gatewayAuth,
  proxies.file
);

// ─────────────────────────────────────────
// ATTENDANCE SERVICE
// ─────────────────────────────────────────
router.use(
  SERVICES.attendance.prefix,
  apiRateLimiter,
  gatewayAuth,
  proxies.attendance
);

module.exports = router;
