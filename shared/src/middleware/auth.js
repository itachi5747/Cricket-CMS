const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

// ─────────────────────────────────────────
// authenticateJWT
// Validates the Bearer token in Authorization header.
// Attaches decoded user payload to req.user.
// ─────────────────────────────────────────
const authenticateJWT = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw UnauthorizedError('No token provided');
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, username, email, role, iat, exp }

    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return next(UnauthorizedError('Invalid token'));
    }
    if (err.name === 'TokenExpiredError') {
      return next(UnauthorizedError('Token has expired'));
    }
    next(err);
  }
};

// ─────────────────────────────────────────
// authorizeRole
// Factory that returns middleware restricting access to given roles.
// Usage: router.get('/admin', authenticateJWT, authorizeRole(['Chairman']))
// ─────────────────────────────────────────
const authorizeRole = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(UnauthorizedError('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        ForbiddenError(
          `Role '${req.user.role}' is not permitted. Required: ${allowedRoles.join(', ')}`
        )
      );
    }

    next();
  };
};

// ─────────────────────────────────────────
// optionalAuth
// Attaches user to req if token is present, but doesn't block if missing.
// Useful for endpoints that behave differently for auth vs. anonymous users.
// ─────────────────────────────────────────
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }
  } catch {
    // Silently ignore invalid tokens for optional auth
    req.user = null;
  }

  next();
};

// ─────────────────────────────────────────
// requireOwnership
// Ensures user is only accessing/modifying their own resource,
// unless they have an elevated role.
// Usage: requireOwnership(['Chairman', 'Coach'], 'userId')
// ─────────────────────────────────────────
const requireOwnership = (privilegedRoles = [], paramName = 'userId') => {
  return (req, res, next) => {
    const { user } = req;
    if (!user) return next(UnauthorizedError());

    const targetId = req.params[paramName] || req.body[paramName];

    if (privilegedRoles.includes(user.role)) return next();

    if (user.userId !== targetId) {
      return next(ForbiddenError('You can only access your own resources'));
    }

    next();
  };
};

module.exports = {
  authenticateJWT,
  authorizeRole,
  optionalAuth,
  requireOwnership,
};
