const {
  sendSuccess,
  sendCreated,
  sendPaginated,
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
  getPaginationParams,
  createLogger,
  ROLES,
  EVENTS,
} = require('@cricket-cms/shared');

const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const FinancialModel = require('../models/financial.model');

const logger = createLogger('financial-controller');

// ─────────────────────────────────────────
// BUDGET
// ─────────────────────────────────────────

// GET /api/v1/financial/budget
const getBudget = async (req, res, next) => {
  try {
    const fiscalYear = req.query.fiscalYear || FinancialModel.getCurrentFiscalYear();
    const budget = await FinancialModel.getBudget(fiscalYear);

    if (!budget) {
      return sendSuccess(res, {
        fiscalYear,
        message: 'No budget set for this fiscal year',
        totalBudget: 0,
        allocatedAmount: 0,
        spentAmount: 0,
        remainingBalance: 0,
        utilizationPercentage: 0,
      });
    }

    return sendSuccess(res, {
      budgetId:             budget.id,
      fiscalYear:           budget.fiscal_year,
      totalBudget:          parseFloat(budget.total_budget),
      allocatedAmount:      parseFloat(budget.allocated_amount),
      spentAmount:          parseFloat(budget.spent_amount),
      remainingBalance:     parseFloat(budget.remaining_balance),
      utilizationPercentage:parseFloat(budget.utilization_percentage),
    });

  } catch (err) { next(err); }
};

// POST /api/v1/financial/budget — Chairman only
const createBudget = async (req, res, next) => {
  try {
    const { fiscalYear, totalBudget } = req.body;

    // Prevent duplicate budget for same fiscal year
    const existing = await FinancialModel.getBudget(fiscalYear);
    if (existing) {
      throw ConflictError(`A budget for fiscal year ${fiscalYear} already exists`);
    }

    const budget = await FinancialModel.createBudget({
      fiscalYear, totalBudget, createdBy: req.user.userId,
    });

    logger.info('Budget created', { fiscalYear, totalBudget, createdBy: req.user.userId });

    return sendCreated(res, {
      budgetId:    budget.id,
      fiscalYear:  budget.fiscal_year,
      totalBudget: parseFloat(budget.total_budget),
    }, `Budget for ${fiscalYear} created successfully`);

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// SPONSORSHIPS
// ─────────────────────────────────────────

// GET /api/v1/financial/sponsorships
const listSponsorships = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status } = req.query;

    const { sponsorships, total, totalActiveValue } = await FinancialModel.getAllSponsorships({
      status, limit, offset,
    });

    return sendPaginated(
      res,
      sponsorships.map((s) => ({
        sponsorshipId:     s.id,
        sponsorName:       s.sponsor_name,
        contractValue:     parseFloat(s.contract_value),
        contractStartDate: s.contract_start_date,
        contractEndDate:   s.contract_end_date,
        paymentSchedule:   s.payment_schedule,
        status:            s.status,
        contactPerson:     s.contact_person,
        contactEmail:      s.contact_email,
        notes:             s.notes,
        createdAt:         s.created_at,
      })),
      { page, limit, total },
      'Sponsorships retrieved',
      { totalActiveValue }
    );

  } catch (err) { next(err); }
};

// POST /api/v1/financial/sponsorships — Accountant
const createSponsorship = async (req, res, next) => {
  try {
    const {
      sponsorName, contractValue, contractStartDate, contractEndDate,
      paymentSchedule, contactPerson, contactEmail, notes,
    } = req.body;

    // Validate date range
    if (new Date(contractEndDate) <= new Date(contractStartDate)) {
      throw BadRequestError('Contract end date must be after start date');
    }

    const sponsorship = await FinancialModel.createSponsorship({
      sponsorName, contractValue, contractStartDate, contractEndDate,
      paymentSchedule, contactPerson, contactEmail, notes,
      createdBy: req.user.userId,
    });

    // Publish event — budget service will update income tracking
    await publishEvent(EVENTS.SPONSORSHIP_ADDED, {
      sponsorshipId:  sponsorship.id,
      sponsorName:    sponsorship.sponsor_name,
      contractValue:  parseFloat(sponsorship.contract_value),
      fiscalYear:     FinancialModel.getCurrentFiscalYear(),
      addedBy:        req.user.userId,
    }, { userId: req.user.userId, source: 'financial-service' });

    logger.info('Sponsorship added', {
      sponsorshipId: sponsorship.id, sponsorName, contractValue,
    });

    return sendCreated(res, {
      sponsorshipId: sponsorship.id,
      sponsorName:   sponsorship.sponsor_name,
      contractValue: parseFloat(sponsorship.contract_value),
      status:        sponsorship.status,
    }, 'Sponsorship added successfully');

  } catch (err) { next(err); }
};

// PUT /api/v1/financial/sponsorships/:id — Accountant
const updateSponsorship = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await FinancialModel.getSponsorshipById(id);
    if (!existing) throw NotFoundError('Sponsorship not found');

    if (existing.status === 'Terminated') {
      throw BadRequestError('Cannot update a terminated sponsorship');
    }

    const updated = await FinancialModel.updateSponsorship(id, req.body);

    return sendSuccess(res, {
      sponsorshipId: updated.id,
      sponsorName:   updated.sponsor_name,
      status:        updated.status,
    }, 'Sponsorship updated successfully');

  } catch (err) { next(err); }
};

// DELETE /api/v1/financial/sponsorships/:id — Chairman (terminates, not hard delete)
const terminateSponsorship = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await FinancialModel.getSponsorshipById(id);
    if (!existing) throw NotFoundError('Sponsorship not found');

    if (existing.status === 'Terminated') {
      throw BadRequestError('Sponsorship is already terminated');
    }

    await FinancialModel.terminateSponsorship(id);

    logger.info('Sponsorship terminated', { sponsorshipId: id, terminatedBy: req.user.userId });

    return sendSuccess(res, null, 'Sponsorship terminated successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// SALARIES
// ─────────────────────────────────────────

// GET /api/v1/financial/salaries
// Players can only see their own payments
const listSalaries = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { role, userId } = req.user;
    let { userId: filterUserId, month, status } = req.query;

    // Players can only see their own salary history
    if (role === ROLES.PLAYER) filterUserId = userId;

    const { payments, total, totalPaid } = await FinancialModel.getAllSalaries({
      userId: filterUserId, month, status, limit, offset,
    });

    return sendPaginated(
      res,
      payments.map((p) => ({
        paymentId:      p.id,
        userId:         p.user_id,
        fullName:       p.full_name,
        email:          p.email,
        role:           p.role,
        amount:         parseFloat(p.amount),
        paymentMonth:   p.payment_month,
        paymentDate:    p.payment_date,
        paymentMethod:  p.payment_method,
        transactionId:  p.transaction_id,
        status:         p.status,
        notes:          p.notes,
      })),
      { page, limit, total },
      'Salary payments retrieved',
      { totalPaid }
    );

  } catch (err) { next(err); }
};

// POST /api/v1/financial/salaries/process — Accountant only
const processSalary = async (req, res, next) => {
  try {
    const { userId, amount, paymentMonth, paymentDate, paymentMethod, transactionId, notes } = req.body;
    const fiscalYear = FinancialModel.getCurrentFiscalYear(new Date(paymentDate));

    const payment = await FinancialModel.processSalaryPayment({
      userId, amount, paymentMonth, paymentDate,
      paymentMethod, transactionId, notes,
      processedBy: req.user.userId,
      fiscalYear,
    });

    // Update budget spent amount
    await FinancialModel.incrementBudgetSpent(fiscalYear, amount);

    // Notify the employee their salary has been processed
    await publishEvent(EVENTS.SALARY_PAID, {
      paymentId:     payment.id,
      userId,
      amount,
      paymentMonth,
      paymentDate,
      paymentMethod: paymentMethod || 'Bank Transfer',
      processedBy:   req.user.userId,
    }, { userId: req.user.userId, source: 'financial-service' });

    logger.info('Salary processed', {
      paymentId: payment.id, userId, amount, paymentMonth,
    });

    return sendCreated(res, {
      paymentId:    payment.id,
      userId:       payment.user_id,
      amount:       parseFloat(payment.amount),
      paymentMonth: payment.payment_month,
      status:       payment.status,
    }, 'Salary payment processed successfully');

  } catch (err) {
    // Unique constraint on (user_id, payment_month) where status != Failed
    if (err.code === '23505') {
      return next(ConflictError(
        'A salary payment for this employee this month has already been processed'
      ));
    }
    next(err);
  }
};

// ─────────────────────────────────────────
// EXPENSES
// ─────────────────────────────────────────

// GET /api/v1/financial/expenses
const listExpenses = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { category, status, from, to } = req.query;

    const { expenses, total } = await FinancialModel.getAllExpenses({
      category, status, from, to, limit, offset,
    });

    return sendPaginated(
      res,
      expenses.map((e) => ({
        expenseId:       e.id,
        category:        e.category,
        description:     e.description,
        amount:          parseFloat(e.amount),
        expenseDate:     e.expense_date,
        status:          e.status,
        submittedBy:     e.submitted_by_name,
        approvedBy:      e.approved_by_name,
        rejectionReason: e.rejection_reason,
        receiptUrl:      e.receipt_url,
        createdAt:       e.created_at,
      })),
      { page, limit, total }
    );

  } catch (err) { next(err); }
};

// POST /api/v1/financial/expenses — Accountant or Chairman
const createExpense = async (req, res, next) => {
  try {
    const { category, description, amount, expenseDate, receiptUrl } = req.body;
    const fiscalYear = FinancialModel.getCurrentFiscalYear(new Date(expenseDate));

    const expense = await FinancialModel.createExpense({
      category, description, amount, expenseDate, receiptUrl,
      createdBy: req.user.userId,
    });

    // Track as allocated (not yet spent — that happens on approval)
    await FinancialModel.incrementBudgetAllocated(fiscalYear, amount);

    logger.info('Expense recorded', {
      expenseId: expense.id, category, amount, createdBy: req.user.userId,
    });

    return sendCreated(res, {
      expenseId:   expense.id,
      category:    expense.category,
      description: expense.description,
      amount:      parseFloat(expense.amount),
      status:      expense.status,
    }, 'Expense recorded successfully');

  } catch (err) { next(err); }
};

// PUT /api/v1/financial/expenses/:id/approve — Chairman only
const approveExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { approved, rejectionReason } = req.body;

    const expense = await FinancialModel.getExpenseById(id);
    if (!expense) throw NotFoundError('Expense not found');

    if (expense.status !== 'Pending') {
      throw BadRequestError(
        `Expense has already been ${expense.status.toLowerCase()}`
      );
    }

    const fiscalYear = FinancialModel.getCurrentFiscalYear(
      new Date(expense.expense_date)
    );

    const updated = await FinancialModel.approveExpense(id, {
      approved, approvedBy: req.user.userId, rejectionReason, fiscalYear,
    });

    // Notify submitter of the decision
    await publishEvent(EVENTS.EXPENSE_APPROVED, {
      expenseId:       expense.id,
      category:        expense.category,
      amount:          parseFloat(expense.amount),
      approved,
      rejectionReason: rejectionReason || null,
      submittedBy:     expense.created_by,
      approvedBy:      req.user.userId,
    }, { userId: req.user.userId, source: 'financial-service' });

    logger.info('Expense decision', {
      expenseId: id, approved, decidedBy: req.user.userId,
    });

    return sendSuccess(res, {
      expenseId: updated.id,
      status:    updated.status,
      amount:    parseFloat(updated.amount),
    }, `Expense ${approved ? 'approved' : 'rejected'} successfully`);

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────

// GET /api/v1/financial/reports/summary
const getFinancialSummary = async (req, res, next) => {
  try {
    const { from, to } = req.query;

    const { transactions, expenseBreakdown, sponsorshipIncome } =
      await FinancialModel.getFinancialSummary({ from, to });

    // Pivot transactions into income/expense/salary totals
    const totals = { income: 0, expense: 0, salary: 0 };
    for (const row of transactions) {
      const key = row.transaction_type.toLowerCase();
      totals[key] = parseFloat(row.total);
    }

    const totalExpenses = totals.expense + totals.salary;
    const netResult     = (totals.income + sponsorshipIncome) - totalExpenses;

    return sendSuccess(res, {
      period: { from, to },
      summary: {
        totalIncome:   totals.income + sponsorshipIncome,
        totalExpenses,
        netResult,
        isProfit:      netResult >= 0,
      },
      incomeBreakdown: {
        sponsorships:    sponsorshipIncome,
        otherIncome:     totals.income,
      },
      expenseBreakdown: expenseBreakdown.reduce((acc, row) => {
        acc[row.category.toLowerCase()] = parseFloat(row.total);
        return acc;
      }, {}),
      salaryTotal: totals.salary,
    });

  } catch (err) { next(err); }
};

// GET /api/v1/financial/transactions — audit trail
const listTransactions = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { type, fiscalYear } = req.query;

    const { transactions, total } = await FinancialModel.getTransactions({
      type, fiscalYear, limit, offset,
    });

    return sendPaginated(
      res,
      transactions.map((t) => ({
        transactionId:   t.id,
        type:            t.transaction_type,
        amount:          parseFloat(t.amount),
        description:     t.description,
        referenceType:   t.reference_type,
        fiscalYear:      t.fiscal_year,
        createdBy:       t.created_by_name,
        createdAt:       t.created_at,
      })),
      { page, limit, total }
    );

  } catch (err) { next(err); }
};

module.exports = {
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
};
