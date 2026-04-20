const { query } = require('@cricket-cms/shared').postgres;
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('financial-migrate');

const runMigrations = async () => {
  logger.info('Running financial service migrations...');

  // ── Table 1: budgets ──
  // One row per fiscal year. fiscal_year format: "2025-2026".
  // allocated_amount = sum of all planned expenses
  // spent_amount     = sum of all approved + processed expenses
  await query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
      fiscal_year      VARCHAR(10)    UNIQUE NOT NULL,
      total_budget     DECIMAL(14,2)  NOT NULL CHECK (total_budget > 0),
      allocated_amount DECIMAL(14,2)  DEFAULT 0,
      spent_amount     DECIMAL(14,2)  DEFAULT 0,
      created_by       UUID           NOT NULL REFERENCES users(id),
      created_at       TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 2: sponsorships ──
  // Income side. Each sponsor has a contract with a total value,
  // start/end dates, and a payment schedule.
  await query(`
    CREATE TABLE IF NOT EXISTS sponsorships (
      id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
      sponsor_name       VARCHAR(200)   NOT NULL,
      contract_value     DECIMAL(14,2)  NOT NULL CHECK (contract_value > 0),
      contract_start_date DATE          NOT NULL,
      contract_end_date   DATE          NOT NULL,
      payment_schedule   VARCHAR(20)    DEFAULT 'Annual'
                         CHECK (payment_schedule IN ('Monthly','Quarterly','Annual','One-time')),
      status             VARCHAR(20)    DEFAULT 'Active'
                         CHECK (status IN ('Active','Expired','Terminated')),
      contact_person     VARCHAR(100),
      contact_email      VARCHAR(255),
      notes              TEXT,
      created_by         UUID           REFERENCES users(id),
      created_at         TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
      updated_at         TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 3: salary_payments ──
  // One row per employee per payment.
  // payment_month format: "2026-03" (YYYY-MM).
  // transaction_id: external bank/payment reference number.
  await query(`
    CREATE TABLE IF NOT EXISTS salary_payments (
      id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID          NOT NULL REFERENCES users(id),
      amount          DECIMAL(10,2) NOT NULL CHECK (amount > 0),
      payment_month   VARCHAR(7)    NOT NULL,
      payment_date    DATE          NOT NULL,
      payment_method  VARCHAR(30),
      transaction_id  VARCHAR(100),
      status          VARCHAR(20)   DEFAULT 'Pending'
                      CHECK (status IN ('Pending','Processed','Failed')),
      notes           TEXT,
      processed_by    UUID          REFERENCES users(id),
      created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Prevent paying the same person twice in the same month
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_unique_month
    ON salary_payments(user_id, payment_month)
    WHERE status != 'Failed'
  `);

  // ── Table 4: expenses ──
  // Outgoing money. Requires Chairman approval before
  // it's counted against the spent_amount budget.
  await query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      category     VARCHAR(50)   NOT NULL
                   CHECK (category IN ('Travel','Equipment','Facilities','Medical','Training','Other')),
      description  TEXT          NOT NULL,
      amount       DECIMAL(10,2) NOT NULL CHECK (amount > 0),
      expense_date DATE          NOT NULL,
      receipt_url  TEXT,
      status       VARCHAR(20)   DEFAULT 'Pending'
                   CHECK (status IN ('Pending','Approved','Rejected')),
      approved_by  UUID          REFERENCES users(id),
      approved_at  TIMESTAMP,
      rejection_reason TEXT,
      created_by   UUID          NOT NULL REFERENCES users(id),
      created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 5: transactions ──
  // Immutable audit trail. Every financial event (salary, expense,
  // sponsorship) writes a row here. Rows are NEVER deleted or updated —
  // this is the source of truth for the financial summary report.
  await query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_type VARCHAR(20)   NOT NULL
                       CHECK (transaction_type IN ('Income','Expense','Salary')),
      amount           DECIMAL(14,2) NOT NULL,
      description      TEXT,
      reference_id     UUID,
      reference_type   VARCHAR(30),
      fiscal_year      VARCHAR(10),
      created_by       UUID          REFERENCES users(id),
      created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Indexes ──
  await query(`CREATE INDEX IF NOT EXISTS idx_salary_user    ON salary_payments(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_salary_month   ON salary_payments(payment_month)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_salary_status  ON salary_payments(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_expense_status ON expenses(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_expense_cat    ON expenses(category)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_expense_date   ON expenses(expense_date)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_txn_date       ON transactions(created_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_txn_type       ON transactions(transaction_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_txn_fiscal     ON transactions(fiscal_year)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sponsor_status ON sponsorships(status)`);

  logger.info('Financial service migrations completed');
};

module.exports = { runMigrations };
