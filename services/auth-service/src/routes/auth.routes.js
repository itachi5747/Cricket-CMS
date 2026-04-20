const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { validate, authenticateJWT } = require('@cricket-cms/shared');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('../validators/auth.validators');
const {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
} = require('../controllers/auth.controller');

const router = Router();

// ─────────────────────────────────────────
// Rate limiter for login endpoint specifically.
// Prevents brute-force password attacks.
// 5 attempts per 15 minutes per IP address.
// After 5 fails, returns 429 Too Many Requests.
// ─────────────────────────────────────────
const loginRateLimiter = rateLimit({
  windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
  skipSuccessfulRequests: true, // Only counts failed attempts toward the limit
});

// ─────────────────────────────────────────
// Routes
// Each route is: path → [middlewares] → controller
// Middlewares run left to right.
// If any middleware calls next(err), the controller is skipped.
// ─────────────────────────────────────────

// Public routes — no JWT required
router.post('/register',         validate(registerSchema),         register);
router.post('/login',            loginRateLimiter, validate(loginSchema), login);
router.post('/refresh',          validate(refreshSchema),          refresh);
router.post('/forgot-password',  validate(forgotPasswordSchema),   forgotPassword);
router.post('/reset-password',   validate(resetPasswordSchema),    resetPassword);

// Protected route — requires valid JWT
// authenticateJWT populates req.user before logout controller runs
router.post('/logout', authenticateJWT, logout);

module.exports = router;
