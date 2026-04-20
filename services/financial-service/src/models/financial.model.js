const { query, transaction } = require('@cricket-cms/shared').postgres;

// ─────────────────────────────────────────
// Helper — get current fiscal year string
// Cricket fiscal year: July–June
// If month >= 7 (July), year is current–next
// If month < 7  (Jan–Jun), year is prev–current
// ─────────────────────────────────────────
const getCurrentFiscalYear = (date = new Date()) => {
  const year  = date.getFullYear();
  const month = date.getMonth() + 1;
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
};

// ─────────────────────────────────────────
// BUDGET QUERIES
// ─────────────────────────────────────────

const getBudget = async (fiscalYear) => {
  const result = await query(
    `SELECT
       b.*,
       b.total_budget - b.spent_amount AS remaining_balance,
       CASE WHEN b.total_budget > 0
         THEN ROUND((b.spent_amount / b.total_budget * 100)::NUMERIC, 2)
         ELSE 0
       END AS utilization_percentage
     FROM budgets b
     WHERE b.fiscal_year = $1`,
    [fiscalYear]
  );
  return result.rows[0] || null;
};

const createBudget = async ({ fiscalYear, totalBudget, createdBy }) => {
  const result = await query(
    `INSERT INTO budgets (fiscal_year, total_budget, created_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [fiscalYear, totalBudget, createdBy]
  );
  return result.rows[0];
};

// Increase spent_amount when expense approved or salary processed
const incrementBudgetSpent = async (fiscalYear, amount) => {
  await query(
    `UPDATE budgets
     SET spent_amount = spent_amount + $1, updated_at = CURRENT_TIMESTAMP
     WHERE fiscal_year = $2`,
    [amount, fiscalYear]
  );
};

// Increase allocated_amount when expense submitted (before approval)
const incrementBudgetAllocated = async (fiscalYear, amount) => {
  await query(
    `UPDATE budgets
     SET allocated_amount = allocated_amount + $1, updated_at = CURRENT_TIMESTAMP
     WHERE fiscal_year = $2`,
    [amount, fiscalYear]
  );
};

// ─────────────────────────────────────────
// SPONSORSHIP QUERIES
// ─────────────────────────────────────────

const getAllSponsorships = async ({ status, limit, offset }) => {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (status) { conditions.push(`status = $${idx++}`); params.push(status); }

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM sponsorships WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Also get total active contract value
  const valueResult = await query(
    `SELECT COALESCE(SUM(contract_value), 0) AS total_value
     FROM sponsorships WHERE status = 'Active'`
  );

  const result = await query(
    `SELECT * FROM sponsorships
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return {
    sponsorships: result.rows,
    total,
    totalActiveValue: parseFloat(valueResult.rows[0].total_value),
  };
};

const getSponsorshipById = async (id) => {
  const result = await query(`SELECT * FROM sponsorships WHERE id = $1`, [id]);
  return result.rows[0] || null;
};

const createSponsorship = async ({
  sponsorName, contractValue, contractStartDate, contractEndDate,
  paymentSchedule, contactPerson, contactEmail, notes, createdBy,
}) => {
  const result = await query(
    `INSERT INTO sponsorships
       (sponsor_name, contract_value, contract_start_date, contract_end_date,
        payment_schedule, contact_person, contact_email, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      sponsorName, contractValue, contractStartDate, contractEndDate,
      paymentSchedule || 'Annual', contactPerson || null,
      contactEmail || null, notes || null, createdBy,
    ]
  );
  return result.rows[0];
};

const updateSponsorship = async (id, { sponsorName, contactPerson, contactEmail, notes, paymentSchedule }) => {
  const result = await query(
    `UPDATE sponsorships SET
       sponsor_name      = COALESCE($1, sponsor_name),
       contact_person    = COALESCE($2, contact_person),
       contact_email     = COALESCE($3, contact_email),
       notes             = COALESCE($4, notes),
       payment_schedule  = COALESCE($5, payment_schedule),
       updated_at        = CURRENT_TIMESTAMP
     WHERE id = $6
     RETURNING *`,
    [sponsorName, contactPerson, contactEmail, notes, paymentSchedule, id]
  );
  return result.rows[0] || null;
};

const terminateSponsorship = async (id) => {
  const result = await query(
    `UPDATE sponsorships
     SET status = 'Terminated', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
};

// ─────────────────────────────────────────
// SALARY QUERIES
// ─────────────────────────────────────────

const getAllSalaries = async ({ userId, month, status, limit, offset }) => {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (userId) { conditions.push(`sp.user_id = $${idx++}`); params.push(userId); }
  if (month)  { conditions.push(`sp.payment_month = $${idx++}`); params.push(month); }
  if (status) { conditions.push(`sp.status = $${idx++}`); params.push(status); }

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM salary_payments sp WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const totalPaidResult = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid
     FROM salary_payments WHERE status = 'Processed'`
  );

  const result = await query(
    `SELECT
       sp.*,
       pr.full_name,
       u.email,
       u.role
     FROM salary_payments sp
     JOIN users u     ON u.id = sp.user_id
     JOIN profiles pr ON pr.user_id = sp.user_id
     WHERE ${whereClause}
     ORDER BY sp.payment_date DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return {
    payments: result.rows,
    total,
    totalPaid: parseFloat(totalPaidResult.rows[0].total_paid),
  };
};

// Process a salary payment — uses transaction for atomicity:
// insert salary_payment + insert transaction record together
const processSalaryPayment = async ({
  userId, amount, paymentMonth, paymentDate,
  paymentMethod, transactionId, notes, processedBy, fiscalYear,
}) => {
  return transaction(async (client) => {
    // Insert salary payment
    const salaryResult = await client.query(
      `INSERT INTO salary_payments
         (user_id, amount, payment_month, payment_date, payment_method,
          transaction_id, status, notes, processed_by)
       VALUES ($1,$2,$3,$4,$5,$6,'Processed',$7,$8)
       RETURNING *`,
      [userId, amount, paymentMonth, paymentDate,
       paymentMethod || null, transactionId || null, notes || null, processedBy]
    );

    // Write to audit trail
    await client.query(
      `INSERT INTO transactions
         (transaction_type, amount, description, reference_id, reference_type, fiscal_year, created_by)
       VALUES ('Salary', $1, $2, $3, 'SalaryPayment', $4, $5)`,
      [
        amount,
        `Salary payment for ${paymentMonth}`,
        salaryResult.rows[0].id,
        fiscalYear,
        processedBy,
      ]
    );

    return salaryResult.rows[0];
  });
};

// ─────────────────────────────────────────
// EXPENSE QUERIES
// ─────────────────────────────────────────

const getAllExpenses = async ({ category, status, from, to, limit, offset }) => {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (category) { conditions.push(`e.category = $${idx++}`); params.push(category); }
  if (status)   { conditions.push(`e.status = $${idx++}`);   params.push(status); }
  if (from)     { conditions.push(`e.expense_date >= $${idx++}`); params.push(from); }
  if (to)       { conditions.push(`e.expense_date <= $${idx++}`); params.push(to); }

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM expenses e WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query(
    `SELECT
       e.*,
       pr.full_name    AS submitted_by_name,
       apr.full_name   AS approved_by_name
     FROM expenses e
     JOIN users u       ON u.id = e.created_by
     JOIN profiles pr   ON pr.user_id = e.created_by
     LEFT JOIN users au ON au.id = e.approved_by
     LEFT JOIN profiles apr ON apr.user_id = au.id
     WHERE ${whereClause}
     ORDER BY e.expense_date DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return { expenses: result.rows, total };
};

const getExpenseById = async (id) => {
  const result = await query(
    `SELECT e.*, pr.full_name AS submitted_by_name
     FROM expenses e
     JOIN profiles pr ON pr.user_id = e.created_by
     WHERE e.id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

const createExpense = async ({ category, description, amount, expenseDate, receiptUrl, createdBy }) => {
  const result = await query(
    `INSERT INTO expenses (category, description, amount, expense_date, receipt_url, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [category, description, amount, expenseDate, receiptUrl || null, createdBy]
  );
  return result.rows[0];
};

// Approve or reject expense — transaction writes audit record if approved
const approveExpense = async (id, { approved, approvedBy, rejectionReason, fiscalYear }) => {
  return transaction(async (client) => {
    const newStatus = approved ? 'Approved' : 'Rejected';

    const result = await client.query(
      `UPDATE expenses SET
         status           = $1,
         approved_by      = $2,
         approved_at      = CURRENT_TIMESTAMP,
         rejection_reason = COALESCE($3, rejection_reason),
         updated_at       = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [newStatus, approvedBy, rejectionReason || null, id]
    );

    const expense = result.rows[0];

    if (approved) {
      // Write to audit trail
      await client.query(
        `INSERT INTO transactions
           (transaction_type, amount, description, reference_id, reference_type, fiscal_year, created_by)
         VALUES ('Expense', $1, $2, $3, 'Expense', $4, $5)`,
        [expense.amount, expense.description, expense.id, fiscalYear, approvedBy]
      );

      // Update budget spent amount
      await client.query(
        `UPDATE budgets
         SET spent_amount = spent_amount + $1, updated_at = CURRENT_TIMESTAMP
         WHERE fiscal_year = $2`,
        [expense.amount, fiscalYear]
      );
    }

    return expense;
  });
};

// ─────────────────────────────────────────
// REPORTS & TRANSACTIONS
// ─────────────────────────────────────────

// Financial summary report — income vs expenses for a date range
const getFinancialSummary = async ({ from, to, fiscalYear }) => {
  const result = await query(
    `SELECT
       transaction_type,
       COUNT(*)              AS count,
       COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE created_at >= $1
       AND created_at <= $2
     GROUP BY transaction_type`,
    [from, to]
  );

  // Expense breakdown by category
  const expenseBreakdown = await query(
    `SELECT
       category,
       COUNT(*)          AS count,
       COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE status = 'Approved'
       AND expense_date BETWEEN $1 AND $2
     GROUP BY category
     ORDER BY total DESC`,
    [from, to]
  );

  // Active sponsorship income
  const sponsorshipIncome = await query(
    `SELECT COALESCE(SUM(contract_value), 0) AS total
     FROM sponsorships
     WHERE status = 'Active'
       AND contract_start_date <= $2
       AND contract_end_date >= $1`,
    [from, to]
  );

  return {
    transactions:      result.rows,
    expenseBreakdown:  expenseBreakdown.rows,
    sponsorshipIncome: parseFloat(sponsorshipIncome.rows[0].total),
  };
};

// Audit trail — paginated list of all transactions
const getTransactions = async ({ type, fiscalYear, limit, offset }) => {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (type)       { conditions.push(`t.transaction_type = $${idx++}`); params.push(type); }
  if (fiscalYear) { conditions.push(`t.fiscal_year = $${idx++}`);      params.push(fiscalYear); }

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM transactions t WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query(
    `SELECT
       t.*,
       pr.full_name AS created_by_name
     FROM transactions t
     LEFT JOIN users u    ON u.id = t.created_by
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE ${whereClause}
     ORDER BY t.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return { transactions: result.rows, total };
};

module.exports = {
  getCurrentFiscalYear,
  getBudget,
  createBudget,
  incrementBudgetSpent,
  incrementBudgetAllocated,
  getAllSponsorships,
  getSponsorshipById,
  createSponsorship,
  updateSponsorship,
  terminateSponsorship,
  getAllSalaries,
  processSalaryPayment,
  getAllExpenses,
  getExpenseById,
  createExpense,
  approveExpense,
  getFinancialSummary,
  getTransactions,
};
