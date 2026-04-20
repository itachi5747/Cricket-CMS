require('dotenv').config({ path: `${__dirname}/../.env` });
const request = require('supertest');
const jwt     = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_minimum_32_chars_long!!';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV   = 'test';

const makeToken = (overrides = {}) =>
  jwt.sign(
    { userId: 'user-uuid-1', username: 'accountant', email: 'acc@c.com', role: 'Accountant', ...overrides },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

// ── Mocks ────────────────────────────────
jest.mock('@cricket-cms/shared', () => {
  const actual = jest.requireActual('@cricket-cms/shared');
  return {
    ...actual,
    postgres: {
      createPool: jest.fn(), testConnection: jest.fn().mockResolvedValue(true),
      closePool: jest.fn(), query: jest.fn(), transaction: jest.fn(),
    },
    rabbitmq: {
      connectRabbitMQ:         jest.fn().mockResolvedValue(true),
      testRabbitMQConnection:  jest.fn().mockResolvedValue(true),
      closeRabbitMQ:           jest.fn(),
      publishEvent:            jest.fn().mockResolvedValue('event-id'),
    },
  };
});

jest.mock('../src/models/financial.model');
jest.mock('../src/config/migrate', () => ({ runMigrations: jest.fn().mockResolvedValue(true) }));

const FinancialModel = require('../src/models/financial.model');
const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const { createApp, notFoundHandler, errorHandler } = require('@cricket-cms/shared');
const financialRoutes = require('../src/routes/financial.routes');

const buildApp = () => {
  const app = createApp('financial-test');
  app.use('/api/v1/financial', financialRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// ─────────────────────────────────────────
describe('Financial Service — All Endpoints', () => {
  let app;

  beforeAll(() => {
    FinancialModel.getCurrentFiscalYear.mockReturnValue('2025-2026');
    app = buildApp();
  });
  beforeEach(() => jest.clearAllMocks());

  // ─── Budget ──────────────────────────────
  describe('Budget', () => {

    it('GET /budget 200 — Chairman gets current budget', async () => {
      const token = makeToken({ role: 'Chairman' });
      FinancialModel.getBudget.mockResolvedValue({
        id: 'budget-1', fiscal_year: '2025-2026',
        total_budget: '10000000', allocated_amount: '3000000',
        spent_amount: '2000000', remaining_balance: '8000000',
        utilization_percentage: '20.00',
      });

      const res = await request(app)
        .get('/api/v1/financial/budget')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalBudget).toBe(10000000);
      expect(res.body.data.utilizationPercentage).toBe(20);
    });

    it('POST /budget 201 — Chairman creates budget', async () => {
      const token = makeToken({ role: 'Chairman' });
      FinancialModel.getBudget.mockResolvedValue(null); // no existing budget
      FinancialModel.createBudget.mockResolvedValue({
        id: 'b1', fiscal_year: '2026-2027', total_budget: '15000000',
      });

      const res = await request(app)
        .post('/api/v1/financial/budget')
        .set('Authorization', `Bearer ${token}`)
        .send({ fiscalYear: '2026-2027', totalBudget: 15000000 });

      expect(res.status).toBe(201);
      expect(res.body.data.totalBudget).toBe(15000000);
    });

    it('POST /budget 409 — duplicate fiscal year', async () => {
      const token = makeToken({ role: 'Chairman' });
      FinancialModel.getBudget.mockResolvedValue({ id: 'existing' });

      const res = await request(app)
        .post('/api/v1/financial/budget')
        .set('Authorization', `Bearer ${token}`)
        .send({ fiscalYear: '2025-2026', totalBudget: 10000000 });

      expect(res.status).toBe(409);
    });

    it('POST /budget 403 — Accountant cannot create budget', async () => {
      const token = makeToken({ role: 'Accountant' });
      const res = await request(app)
        .post('/api/v1/financial/budget')
        .set('Authorization', `Bearer ${token}`)
        .send({ fiscalYear: '2026-2027', totalBudget: 5000000 });
      expect(res.status).toBe(403);
    });
  });

  // ─── Sponsorships ────────────────────────
  describe('Sponsorships', () => {

    it('POST /sponsorships 201 — Accountant adds sponsor and event published', async () => {
      const token = makeToken({ role: 'Accountant' });
      FinancialModel.createSponsorship.mockResolvedValue({
        id: 'sp-1', sponsor_name: 'SportsCo', contract_value: '500000', status: 'Active',
      });

      const res = await request(app)
        .post('/api/v1/financial/sponsorships')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sponsorName: 'SportsCo International',
          contractValue: 500000,
          contractStartDate: '2026-01-01',
          contractEndDate: '2026-12-31',
          paymentSchedule: 'Quarterly',
        });

      expect(res.status).toBe(201);
      expect(publishEvent).toHaveBeenCalledWith(
        'sponsorship.added',
        expect.objectContaining({ contractValue: 500000 }),
        expect.any(Object)
      );
    });

    it('POST /sponsorships 422 — end date before start date triggers validation', async () => {
      const token = makeToken({ role: 'Accountant' });
      // The date validation is in the controller, not Joi schema
      FinancialModel.createSponsorship.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/financial/sponsorships')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sponsorName: 'SportsCo', contractValue: 500000,
          contractStartDate: '2026-12-31', // end before start
          contractEndDate: '2026-01-01',
        });

      expect(res.status).toBe(400);
    });

    it('GET /sponsorships 403 — Coach cannot view sponsorships', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .get('/api/v1/financial/sponsorships')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ─── Salaries ────────────────────────────
  describe('Salaries', () => {

    it('POST /salaries/process 201 — Accountant processes salary and event published', async () => {
      const token = makeToken({ role: 'Accountant' });
      FinancialModel.processSalaryPayment.mockResolvedValue({
        id: 'pay-1', user_id: 'player-uuid', amount: '3500',
        payment_month: '2026-04', status: 'Processed',
      });
      FinancialModel.incrementBudgetSpent.mockResolvedValue();

      const res = await request(app)
        .post('/api/v1/financial/salaries/process')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          amount: 3500,
          paymentMonth: '2026-04',
          paymentDate: '2026-04-30',
          paymentMethod: 'Bank Transfer',
          transactionId: 'TXN123456',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('Processed');
      expect(publishEvent).toHaveBeenCalledWith(
        'salary.paid',
        expect.objectContaining({ amount: 3500 }),
        expect.any(Object)
      );
      expect(FinancialModel.incrementBudgetSpent).toHaveBeenCalledWith('2025-2026', 3500);
    });

    it('POST /salaries/process 403 — Chairman cannot process salary', async () => {
      const token = makeToken({ role: 'Chairman' });
      const res = await request(app)
        .post('/api/v1/financial/salaries/process')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          amount: 3500, paymentMonth: '2026-04', paymentDate: '2026-04-30',
        });
      expect(res.status).toBe(403);
    });

    it('GET /salaries — Player only sees their own payments', async () => {
      const token = makeToken({ role: 'Player', userId: 'player-user-id' });
      FinancialModel.getAllSalaries.mockResolvedValue({
        payments: [], total: 0, totalPaid: 0,
      });

      await request(app)
        .get('/api/v1/financial/salaries')
        .set('Authorization', `Bearer ${token}`);

      // userId must be forced to the player's own ID
      expect(FinancialModel.getAllSalaries).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'player-user-id' })
      );
    });
  });

  // ─── Expenses ────────────────────────────
  describe('Expenses', () => {

    it('POST /expenses 201 — Accountant records expense', async () => {
      const token = makeToken({ role: 'Accountant' });
      FinancialModel.createExpense.mockResolvedValue({
        id: 'exp-1', category: 'Travel', description: 'Team travel to Australia',
        amount: '50000', status: 'Pending',
      });
      FinancialModel.incrementBudgetAllocated.mockResolvedValue();

      const res = await request(app)
        .post('/api/v1/financial/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          category: 'Travel',
          description: 'Team travel to Australia for ODI series',
          amount: 50000,
          expenseDate: '2026-03-10',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('Pending');
      // Budget allocated should increase immediately on submission
      expect(FinancialModel.incrementBudgetAllocated).toHaveBeenCalledWith('2025-2026', 50000);
    });

    it('PUT /expenses/:id/approve 200 — Chairman approves expense and event published', async () => {
      const token = makeToken({ role: 'Chairman' });
      FinancialModel.getExpenseById.mockResolvedValue({
        id: 'exp-1', status: 'Pending', amount: '50000',
        category: 'Travel', description: 'Team travel', created_by: 'acc-uuid',
        expense_date: '2026-03-10',
      });
      FinancialModel.approveExpense.mockResolvedValue({
        id: 'exp-1', status: 'Approved', amount: '50000',
      });

      const res = await request(app)
        .put('/api/v1/financial/expenses/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/approve')
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: true });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Approved');
      expect(publishEvent).toHaveBeenCalledWith(
        'expense.approved',
        expect.objectContaining({ approved: true }),
        expect.any(Object)
      );
    });

    it('PUT /expenses/:id/approve 400 — rejection requires reason', async () => {
      const token = makeToken({ role: 'Chairman' });
      FinancialModel.getExpenseById.mockResolvedValue({
        id: 'exp-1', status: 'Pending', amount: '50000',
        expense_date: '2026-03-10', created_by: 'acc-uuid',
      });

      const res = await request(app)
        .put('/api/v1/financial/expenses/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/approve')
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: false }); // no rejectionReason

      expect(res.status).toBe(422);
    });

    it('PUT /expenses/:id/approve 400 — cannot approve already-approved expense', async () => {
      const token = makeToken({ role: 'Chairman' });
      FinancialModel.getExpenseById.mockResolvedValue({
        id: 'exp-1', status: 'Approved', amount: '50000',
        expense_date: '2026-03-10', created_by: 'acc-uuid',
      });

      const res = await request(app)
        .put('/api/v1/financial/expenses/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/approve')
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: true });

      expect(res.status).toBe(400);
    });
  });

  // ─── Reports ─────────────────────────────
  describe('Reports', () => {

    it('GET /reports/summary 200 — returns income vs expense breakdown', async () => {
      const token = makeToken({ role: 'Chairman' });
      FinancialModel.getFinancialSummary.mockResolvedValue({
        transactions: [
          { transaction_type: 'Salary',  total: '750000', count: '30' },
          { transaction_type: 'Expense', total: '300000', count: '15' },
        ],
        expenseBreakdown: [
          { category: 'Travel', total: '200000', count: '10' },
          { category: 'Equipment', total: '100000', count: '5' },
        ],
        sponsorshipIncome: 1500000,
      });

      const res = await request(app)
        .get('/api/v1/financial/reports/summary?from=2026-01-01&to=2026-03-31')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.summary.totalIncome).toBe(1500000);
      expect(res.body.data.summary.totalExpenses).toBe(1050000); // 750k salary + 300k expense
      expect(res.body.data.expenseBreakdown.travel).toBe(200000);
    });

    it('GET /reports/summary 403 — Coach cannot view financial reports', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .get('/api/v1/financial/reports/summary?from=2026-01-01&to=2026-03-31')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });
});
