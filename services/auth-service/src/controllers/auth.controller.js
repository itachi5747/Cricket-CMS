const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const {
  sendSuccess,
  sendCreated,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
  BadRequestError,
  createLogger,
} = require('@cricket-cms/shared');
const { blacklistToken, isTokenBlacklisted } = require('@cricket-cms/shared').redis;
const UserModel = require('../models/user.model');

const logger = createLogger('auth-controller');

const SALT_ROUNDS = 12;   // bcrypt work factor — higher = slower = more secure
const ACCESS_EXPIRY  = process.env.JWT_ACCESS_EXPIRY  || '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';
const RESET_EXPIRY_SECONDS = parseInt(process.env.RESET_TOKEN_EXPIRY_SECONDS, 10) || 3600;

// ─────────────────────────────────────────
// Helper — generates both JWT tokens
// Called by register and login
// ─────────────────────────────────────────
const generateTokens = (user) => {
  const payload = {
    userId:   user.id,
    username: user.username,
    email:    user.email,
    role:     user.role,
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: ACCESS_EXPIRY,
  });

  // Refresh token carries less data — just enough to identify the user
  // The rest of the data gets re-fetched from DB on /refresh
  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET,
    { expiresIn: REFRESH_EXPIRY }
  );

  return { accessToken, refreshToken };
};

// ─────────────────────────────────────────
// Helper — calculates the Date when refresh token expires
// Stored in DB so we can query for non-expired tokens
// ─────────────────────────────────────────
const getRefreshTokenExpiry = () => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7); // 7 days from now
  return expiry;
};

// ─────────────────────────────────────────
// POST /api/v1/auth/register
// ─────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    const { username, email, password, role, fullName, contactNumber } = req.body;

    // Check email not already registered
    const existingEmail = await UserModel.findUserByEmail(email);
    if (existingEmail) {
      throw ConflictError('An account with this email already exists');
    }

    // Check username not already taken
    const existingUsername = await UserModel.findUserByUsername(username);
    if (existingUsername) {
      throw ConflictError('This username is already taken');
    }

    // Hash the password — NEVER store plain text
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create the user record
    const user = await UserModel.createUser({ username, email, passwordHash, role });

    logger.info('New user registered', { userId: user.id, role: user.role });

    // Note: we don't send tokens on register — user must login separately.
    // This is intentional: registration confirms the account exists,
    // login proves the user knows their password.
    return sendCreated(res, {
      userId:   user.id,
      username: user.username,
      email:    user.email,
      role:     user.role,
    }, 'Account registered successfully');

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// POST /api/v1/auth/login
// ─────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user — must include password_hash for comparison
    const user = await UserModel.findUserByEmail(email);

    // Use the SAME error message whether email or password is wrong.
    // Never tell attackers which one is incorrect.
    if (!user) {
      throw UnauthorizedError('Invalid email or password');
    }

    // Check account is active
    if (!user.is_active) {
      throw UnauthorizedError('Your account has been deactivated. Contact the administrator.');
    }

    // Compare submitted password against stored hash
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      logger.warn('Failed login attempt', { email });
      throw UnauthorizedError('Invalid email or password');
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Persist refresh token to DB
    await UserModel.saveRefreshToken(user.id, refreshToken, getRefreshTokenExpiry());

    logger.info('User logged in', { userId: user.id, role: user.role });

    return sendSuccess(res, {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
      user: {
        userId:   user.id,
        username: user.username,
        email:    user.email,
        role:     user.role,
      },
    }, 'Login successful');

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// POST /api/v1/auth/refresh
// Client sends refresh token → gets new access token
// ─────────────────────────────────────────
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    // Verify the token is a valid JWT
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch {
      throw UnauthorizedError('Invalid or expired refresh token');
    }

    // Confirm token exists in DB (not already rotated or deleted)
    const tokenRecord = await UserModel.findRefreshToken(refreshToken);
    if (!tokenRecord) {
      throw UnauthorizedError('Refresh token not found or expired. Please login again.');
    }

    // Confirm user account still active
    if (!tokenRecord.is_active) {
      throw UnauthorizedError('Account has been deactivated');
    }

    // Build user object for token generation
    const user = {
      id:       tokenRecord.user_id,
      username: tokenRecord.username,
      email:    tokenRecord.email,
      role:     tokenRecord.role,
    };

    // Generate fresh tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    // Rotate: atomically delete old refresh token, insert new one
    await UserModel.rotateRefreshToken(
      refreshToken,
      user.id,
      newRefreshToken,
      getRefreshTokenExpiry()
    );

    return sendSuccess(res, {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900,
    }, 'Token refreshed successfully');

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// POST /api/v1/auth/logout
// Requires: Authorization: Bearer <accessToken>
// Body: { refreshToken } (optional — for single device logout)
// ─────────────────────────────────────────
const logout = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const { refreshToken } = req.body || {};

    // Blacklist the current access token so it can't be reused
    // even though it hasn't expired yet
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.split(' ')[1];
      try {
        const decoded = jwt.decode(accessToken);
        if (decoded && decoded.exp) {
          const secondsRemaining = decoded.exp - Math.floor(Date.now() / 1000);
          if (secondsRemaining > 0) {
            await blacklistToken(accessToken, secondsRemaining);
          }
        }
      } catch {
        // Non-critical — token may already be expired
      }
    }

    // Delete refresh token from DB
    if (refreshToken) {
      await UserModel.deleteRefreshToken(refreshToken);
    }

    logger.info('User logged out', { userId: req.user?.userId });

    return sendSuccess(res, null, 'Logged out successfully');

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// POST /api/v1/auth/forgot-password
// Generates a reset token and "emails" it
// (in dev mode we just return it in the response)
// ─────────────────────────────────────────
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await UserModel.findUserByEmail(email);

    // IMPORTANT: always return the same response whether email exists or not.
    // This prevents user enumeration attacks (figuring out which emails
    // are registered by watching which ones return different responses).
    if (!user) {
      return sendSuccess(
        res, null,
        'If an account with this email exists, a reset link has been sent'
      );
    }

    // Generate a cryptographically secure random token
    // crypto.randomBytes is much stronger than Math.random()
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_EXPIRY_SECONDS * 1000);

    await UserModel.saveResetToken(user.id, resetToken, expiresAt);

    // TODO Phase 7 (Notification Service) will send the actual email.
    // For now, in development we log the token so you can test /reset-password.
    if (process.env.NODE_ENV === 'development') {
      logger.info('Password reset token (DEV ONLY)', { resetToken, email });
    }

    logger.info('Password reset requested', { userId: user.id });

    return sendSuccess(
      res, null,
      'If an account with this email exists, a reset link has been sent'
    );

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// POST /api/v1/auth/reset-password
// ─────────────────────────────────────────
const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    // Find the token — must be valid, unused, and not expired
    const tokenRecord = await UserModel.findResetToken(token);
    if (!tokenRecord) {
      throw BadRequestError('Reset token is invalid or has expired');
    }

    // Hash the new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password and invalidate all active sessions
    // (if someone is logged in on other devices, they should be forced to re-login)
    await UserModel.updateUserPassword(tokenRecord.user_id, newPasswordHash);
    await UserModel.deleteAllRefreshTokensForUser(tokenRecord.user_id);
    await UserModel.markResetTokenUsed(tokenRecord.id);

    logger.info('Password reset successfully', { userId: tokenRecord.user_id });

    return sendSuccess(res, null, 'Password reset successful. Please login with your new password.');

  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
};
