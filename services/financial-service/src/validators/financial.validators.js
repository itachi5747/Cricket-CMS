const Joi = require('joi');
const { commonValidators } = require('@cricket-cms/shared');

const { uuidRequired, uuid, dateString, positiveNumber, email } = commonValidators;

// POST /api/v1/financial/budget
const createBudgetSchema = Joi.object({
  fiscalYear:  Joi.string()
    .pattern(/^\d{4}-\d{4}$/)
    .required()
    .messages({ 'string.pattern.base': 'fiscalYear must be in YYYY-YYYY format e.g. 2025-2026' }),
  totalBudget: positiveNumber.required().messages({
    'number.positive': 'Total budget must be a positive number',
  }),
});

// POST /api/v1/financial/sponsorships
const createSponsorshipSchema = Joi.object({
  sponsorName:        Joi.string().min(2).max(200).required(),
  contractValue:      positiveNumber.required(),
  contractStartDate:  dateString.required(),
  contractEndDate:    dateString.required(),
  paymentSchedule:    Joi.string().valid('Monthly','Quarterly','Annual','One-time'),
  contactPerson:      Joi.string().max(100),
  contactEmail:       email,
  notes:              Joi.string().max(1000),
});

// PUT /api/v1/financial/sponsorships/:id
const updateSponsorshipSchema = Joi.object({
  sponsorName:     Joi.string().min(2).max(200),
  contactPerson:   Joi.string().max(100),
  contactEmail:    email,
  notes:           Joi.string().max(1000),
  paymentSchedule: Joi.string().valid('Monthly','Quarterly','Annual','One-time'),
}).min(1).messages({ 'object.min': 'At least one field required' });

// POST /api/v1/financial/salaries/process
const processSalarySchema = Joi.object({
  userId:         uuidRequired,
  amount:         positiveNumber.required(),
  paymentMonth:   Joi.string()
    .pattern(/^\d{4}-\d{2}$/)
    .required()
    .messages({ 'string.pattern.base': 'paymentMonth must be in YYYY-MM format e.g. 2026-03' }),
  paymentDate:    dateString.required(),
  paymentMethod:  Joi.string().max(30),
  transactionId:  Joi.string().max(100),
  notes:          Joi.string().max(500),
});

// POST /api/v1/financial/expenses
const createExpenseSchema = Joi.object({
  category:    Joi.string()
    .valid('Travel','Equipment','Facilities','Medical','Training','Other')
    .required(),
  description: Joi.string().min(5).max(1000).required(),
  amount:      positiveNumber.required(),
  expenseDate: dateString.required(),
  receiptUrl:  Joi.string().uri().max(500),
});

// PUT /api/v1/financial/expenses/:id/approve
const approveExpenseSchema = Joi.object({
  approved:        Joi.boolean().required(),
  rejectionReason: Joi.string().max(500).when('approved', {
    is: false,
    then: Joi.required().messages({
      'any.required': 'Rejection reason is required when rejecting an expense',
    }),
  }),
});

// GET query schemas
const listSponsorshipsQuerySchema = Joi.object({
  status: Joi.string().valid('Active','Expired','Terminated'),
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(10),
});

const listSalariesQuerySchema = Joi.object({
  userId: uuid,
  month:  Joi.string().pattern(/^\d{4}-\d{2}$/),
  status: Joi.string().valid('Pending','Processed','Failed'),
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(10),
});

const listExpensesQuerySchema = Joi.object({
  category: Joi.string().valid('Travel','Equipment','Facilities','Medical','Training','Other'),
  status:   Joi.string().valid('Pending','Approved','Rejected'),
  from:     dateString,
  to:       dateString,
  page:     Joi.number().integer().min(1).default(1),
  limit:    Joi.number().integer().min(1).max(100).default(10),
});

const summaryQuerySchema = Joi.object({
  from: dateString.required(),
  to:   dateString.required(),
});

const transactionsQuerySchema = Joi.object({
  type:       Joi.string().valid('Income','Expense','Salary'),
  fiscalYear: Joi.string().pattern(/^\d{4}-\d{4}$/),
  page:       Joi.number().integer().min(1).default(1),
  limit:      Joi.number().integer().min(1).max(100).default(20),
});

const budgetQuerySchema = Joi.object({
  fiscalYear: Joi.string().pattern(/^\d{4}-\d{4}$/),
});

// URL param schemas
const idParamSchema = Joi.object({ id: uuidRequired });

module.exports = {
  createBudgetSchema,
  createSponsorshipSchema,
  updateSponsorshipSchema,
  processSalarySchema,
  createExpenseSchema,
  approveExpenseSchema,
  listSponsorshipsQuerySchema,
  listSalariesQuerySchema,
  listExpensesQuerySchema,
  summaryQuerySchema,
  transactionsQuerySchema,
  budgetQuerySchema,
  idParamSchema,
};
