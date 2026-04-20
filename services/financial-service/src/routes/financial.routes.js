const { Router } = require('express');
const {
  authenticateJWT,
  authorizeRole,
  validate,
  validateQuery,
  validateParams,
  ROLES,
} = require('@cricket-cms/shared');

const {
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
} = require('../validators/financial.validators');

const {
  getBudget,
  createBudget,
  listSponsorships,
  createSponsorship,
  updateSponsorship,
  terminateSponsorship,
  listSalaries,
  processSalary,
  listExpenses,
  createExpense,
  approveExpense,
  getFinancialSummary,
  listTransactions,
} = require('../controllers/financial.controller');

const router = Router();

// ── IMPORTANT: specific named routes must come before parameterized ones
// e.g. /salaries/process before /salaries/:id
// ─────────────────────────────────────────

// ── Budget ────────────────────────────────
router.get('/budget',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.ACCOUNTANT]),
  validateQuery(budgetQuerySchema),
  getBudget
);

router.post('/budget',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validate(createBudgetSchema),
  createBudget
);

// ── Sponsorships ──────────────────────────
router.get('/sponsorships',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.ACCOUNTANT]),
  validateQuery(listSponsorshipsQuerySchema),
  listSponsorships
);

router.post('/sponsorships',
  authenticateJWT,
  authorizeRole([ROLES.ACCOUNTANT]),
  validate(createSponsorshipSchema),
  createSponsorship
);

router.put('/sponsorships/:id',
  authenticateJWT,
  authorizeRole([ROLES.ACCOUNTANT]),
  validateParams(idParamSchema),
  validate(updateSponsorshipSchema),
  updateSponsorship
);

router.delete('/sponsorships/:id',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validateParams(idParamSchema),
  terminateSponsorship
);

// ── Salaries ──────────────────────────────
// /salaries/process MUST come before /salaries
// so Express doesn't treat "process" as a query param
router.post('/salaries/process',
  authenticateJWT,
  authorizeRole([ROLES.ACCOUNTANT]),
  validate(processSalarySchema),
  processSalary
);

router.get('/salaries',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.ACCOUNTANT, ROLES.PLAYER, ROLES.COACH, ROLES.SELECTOR]),
  validateQuery(listSalariesQuerySchema),
  listSalaries
);

// ── Expenses ──────────────────────────────
router.get('/expenses',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.ACCOUNTANT]),
  validateQuery(listExpensesQuerySchema),
  listExpenses
);

router.post('/expenses',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.ACCOUNTANT]),
  validate(createExpenseSchema),
  createExpense
);

router.put('/expenses/:id/approve',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN]),
  validateParams(idParamSchema),
  validate(approveExpenseSchema),
  approveExpense
);

// ── Reports & Audit ───────────────────────
router.get('/reports/summary',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.ACCOUNTANT]),
  validateQuery(summaryQuerySchema),
  getFinancialSummary
);

router.get('/transactions',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.ACCOUNTANT]),
  validateQuery(transactionsQuerySchema),
  listTransactions
);

module.exports = router;
