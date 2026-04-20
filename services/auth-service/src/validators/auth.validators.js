const Joi = require('joi');
const { commonValidators } = require('@cricket-cms/shared');

const { email, password, phoneNumber, role } = commonValidators;

// ─────────────────────────────────────────
// One schema per endpoint.
// These are passed to the validate() middleware
// in the route file:
//   router.post('/register', validate(registerSchema), register)
// ─────────────────────────────────────────

// POST /api/v1/auth/register
// All fields required. Password must meet complexity rules.
const registerSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(50)
    .required()
    .messages({
      'string.alphanum': 'Username can only contain letters and numbers',
      'string.min': 'Username must be at least 3 characters',
      'string.max': 'Username cannot exceed 50 characters',
    }),

  email: email.required(),

  password: password.required(),

  role: role.required(),

  fullName: Joi.string().min(2).max(255).required().messages({
    'string.min': 'Full name must be at least 2 characters',
  }),

  contactNumber: phoneNumber.optional(),
});

// POST /api/v1/auth/login
const loginSchema = Joi.object({
  email: email.required(),
  password: Joi.string().required().messages({
    'string.empty': 'Password is required',
  }),
});

// POST /api/v1/auth/refresh
const refreshSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'string.empty': 'Refresh token is required',
  }),
});

// POST /api/v1/auth/forgot-password
const forgotPasswordSchema = Joi.object({
  email: email.required(),
});

// POST /api/v1/auth/reset-password
const resetPasswordSchema = Joi.object({
  token: Joi.string().required().messages({
    'string.empty': 'Reset token is required',
  }),
  newPassword: password.required().messages({
    'string.empty': 'New password is required',
  }),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
