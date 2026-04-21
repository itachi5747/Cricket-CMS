const jwt = require('jsonwebtoken');
const { createLogger } = require('@cricket-cms/shared');
const { isTokenBlacklisted } = require('@cricket-cms/shared').redis;
const { isPublicPath } = require('../config/services');

const logger = createLogger('gateway-auth');

// ─────────────────────────────────────────
// gatewayAuth
//
// Runs on every request before proxying.
// For public paths: passes through immediately.
// For protected paths:
//   1. Extracts Bearer token from Authorization header
//   2. Verifies signature against JWT_SECRET
//   3. Checks token isn't blacklisted in Redis
//      (set when user logs out)
//   4. Injects decoded user data as headers so
//      downstream services can trust them without
//      re-verifying the JWT themselves
//
// Why inject headers instead of forwarding the token?
// Services could verify the JWT themselves, but that
// means every service needs the JWT_SECRET. Centralising
// verification here means only the gateway needs it.
// Services just read x-user-id and x-user-role.
// ─────────────────────────────────────────
const gatewayAuth = async (req, res, next) => {
  const { method, originalUrl } = req;

  // Skip auth for public endpoints (use originalUrl to get full path)
  if (isPublicPath(method, originalUrl)) {
    return next();
  }

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Provide a Bearer token.',
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT signature and expiry
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      const message = jwtErr.name === 'TokenExpiredError'
        ? 'Token has expired. Please refresh your token.'
        : 'Invalid token.';
      return res.status(401).json({ success: false, message });
    }

    // Check token hasn't been blacklisted (user logged out)
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked. Please login again.',
      });
    }

    // Check user account is still active
    if (decoded.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated.',
      });
    }

    // ── Inject user context as request headers ──
    // Downstream services read these instead of re-parsing the JWT.
    // These headers are set BY the gateway — clients cannot spoof them
    // because the gateway always overwrites them.
    req.headers['x-user-id']       = decoded.userId;
    req.headers['x-user-role']     = decoded.role;
    req.headers['x-user-email']    = decoded.email;
    req.headers['x-user-username'] = decoded.username;

    // Keep the original Authorization header so services that
    // want to do their own verification still can
    req.user = decoded;

    next();
  } catch (err) {
    logger.error('Auth middleware error', { error: err.message, path: reqPath });
    return res.status(500).json({ success: false, message: 'Authentication check failed' });
  }
};

module.exports = { gatewayAuth };
