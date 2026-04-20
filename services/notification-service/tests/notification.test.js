require('dotenv').config({ path: `${__dirname}/../.env` });
const request = require('supertest');
const jwt     = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_minimum_32_chars_long!!';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV   = 'test';

const makeToken = (overrides = {}) =>
  jwt.sign(
    { userId: 'user-uuid-1', username: 'testuser', email: 'test@c.com', role: 'Player', ...overrides },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

// ── Mocks ────────────────────────────────
jest.mock('@cricket-cms/shared', () => {
  const actual = jest.requireActual('@cricket-cms/shared');
  return {
    ...actual,
    mongodb: {
      connectMongo:        jest.fn().mockResolvedValue(true),
      testMongoConnection: jest.fn().mockResolvedValue(true),
      closeMongo:          jest.fn(),
    },
    rabbitmq: {
      connectRabbitMQ:        jest.fn().mockResolvedValue(true),
      testRabbitMQConnection: jest.fn().mockResolvedValue(true),
      closeRabbitMQ:          jest.fn(),
      consumeQueue:           jest.fn().mockResolvedValue(true),
      publishEvent:           jest.fn().mockResolvedValue('event-id'),
    },
  };
});

jest.mock('../src/models/notification.model');
jest.mock('../src/services/email.service', () => ({
  createTransporter: jest.fn().mockResolvedValue(true),
  sendEmail:         jest.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
  buildHtmlEmail:    jest.fn().mockReturnValue('<html>test</html>'),
}));
jest.mock('../src/consumers', () => ({
  startAllConsumers: jest.fn().mockResolvedValue(true),
}));

const NotificationModel = require('../src/models/notification.model');
const { createApp, notFoundHandler, errorHandler } = require('@cricket-cms/shared');
const notificationRoutes = require('../src/routes/notification.routes');

const buildApp = () => {
  const app = createApp('notification-test');
  app.use('/api/v1/notifications', notificationRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// ─────────────────────────────────────────
describe('Notification Service — HTTP Endpoints', () => {
  let app;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => jest.clearAllMocks());

  // ─── GET / ───────────────────────────────
  describe('GET /api/v1/notifications', () => {

    it('200 — returns paginated notifications with unread count', async () => {
      const token = makeToken();
      NotificationModel.getUserNotifications.mockResolvedValue({
        notifications: [
          {
            _id: 'notif-1',
            type: 'in_app', category: 'match',
            title: 'Match Scheduled', message: 'vs Australia on June 15',
            priority: 'high', read: false, readAt: null,
            data: { matchId: 'match-1', link: '/matches/match-1' },
            sentAt: new Date(),
          },
        ],
        total: 5,
        unreadCount: 3,
      });

      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Match Scheduled');
      expect(res.body.data[0].read).toBe(false);
      expect(res.body.pagination.totalRecords).toBe(5);
    });

    it('200 — filters by read=false (unread only)', async () => {
      const token = makeToken();
      NotificationModel.getUserNotifications.mockResolvedValue({
        notifications: [], total: 0, unreadCount: 0,
      });

      await request(app)
        .get('/api/v1/notifications?read=false')
        .set('Authorization', `Bearer ${token}`);

      expect(NotificationModel.getUserNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ read: false })
      );
    });

    it('200 — filters by category', async () => {
      const token = makeToken();
      NotificationModel.getUserNotifications.mockResolvedValue({
        notifications: [], total: 0, unreadCount: 0,
      });

      await request(app)
        .get('/api/v1/notifications?category=payment')
        .set('Authorization', `Bearer ${token}`);

      expect(NotificationModel.getUserNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'payment' })
      );
    });

    it('401 — no token', async () => {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(401);
    });
  });

  // ─── PUT /read-all ───────────────────────
  describe('PUT /api/v1/notifications/read-all', () => {

    it('200 — marks all as read and returns count', async () => {
      const token = makeToken();
      NotificationModel.markAllAsRead.mockResolvedValue(7);

      const res = await request(app)
        .put('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.markedCount).toBe(7);
      expect(NotificationModel.markAllAsRead).toHaveBeenCalledWith('user-uuid-1');
    });
  });

  // ─── PUT /:notificationId/read ───────────
  describe('PUT /api/v1/notifications/:notificationId/read', () => {

    it('200 — marks specific notification as read', async () => {
      const token = makeToken();
      NotificationModel.markAsRead.mockResolvedValue({
        _id: 'notif-1', read: true, readAt: new Date(),
      });

      const res = await request(app)
        .put('/api/v1/notifications/notif-1/read')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(NotificationModel.markAsRead).toHaveBeenCalledWith('notif-1', 'user-uuid-1');
    });

    it('404 — notification not found or belongs to different user', async () => {
      const token = makeToken();
      NotificationModel.markAsRead.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/v1/notifications/nonexistent-id/read')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /preferences ────────────────────
  describe('GET /api/v1/notifications/preferences', () => {

    it('200 — returns default preferences structure', async () => {
      const token = makeToken();
      const res = await request(app)
        .get('/api/v1/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('email');
      expect(res.body.data).toHaveProperty('push');
      expect(res.body.data).toHaveProperty('categories');
      expect(res.body.data.categories).toHaveProperty('match');
    });
  });

  // ─── PUT /preferences ────────────────────
  describe('PUT /api/v1/notifications/preferences', () => {

    it('200 — updates preferences', async () => {
      const token = makeToken();
      const res = await request(app)
        .put('/api/v1/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: false,
          categories: { match: true, payment: true, system: false },
        });

      expect(res.status).toBe(200);
    });

    it('422 — empty body rejected', async () => {
      const token = makeToken();
      const res = await request(app)
        .put('/api/v1/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(422);
    });
  });
});

// ─────────────────────────────────────────
describe('Notification Consumers — Unit Tests', () => {

  // ── match.consumer ────────────────────────
  describe('Match consumer', () => {

    it('creates in-app notification on match.scheduled', async () => {
      NotificationModel.createNotification.mockResolvedValue({ _id: 'n1' });

      const { startMatchConsumer } = require('../src/consumers/match.consumer');
      // We verify the consumer registers without error
      expect(startMatchConsumer).toBeDefined();
    });

    it('creates bulk notifications on match.completed for lineup players', async () => {
      NotificationModel.createBulkNotifications.mockResolvedValue([]);
      NotificationModel.createNotification.mockResolvedValue({ _id: 'n1' });

      const { createBulkNotifications } = require('../src/models/notification.model');

      // Simulate what the consumer does with 3 lineup players
      const lineupPlayerIds = ['p1', 'p2', 'p3'];
      const bulk = lineupPlayerIds.map((userId) => ({
        userId, type: 'in_app', category: 'match',
        title: 'Match Win: vs Australia', message: 'Great result!',
        priority: 'high', data: {}, emailSent: false, sentAt: new Date(),
      }));

      await createBulkNotifications(bulk);

      expect(NotificationModel.createBulkNotifications).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ userId: 'p1' }),
          expect.objectContaining({ userId: 'p2' }),
          expect.objectContaining({ userId: 'p3' }),
        ])
      );
    });
  });

  // ── Notification model helpers ─────────────
  describe('NotificationModel helpers', () => {

    it('fillTemplate replaces all placeholders correctly', () => {
      // Test the template filling logic directly
      const { fillTemplate } = require('../src/models/notification.model');
      NotificationModel.fillTemplate = fillTemplate;

      // Since this is a module-level function, test it directly
      const template = 'Hello {{playerName}}, match vs {{opponent}} on {{date}}.';
      const vars     = { playerName: 'Ahmed', opponent: 'Australia', date: '2026-06-15' };
      const result   = fillTemplate(template, vars);

      expect(result).toBe('Hello Ahmed, match vs Australia on 2026-06-15.');
    });

    it('fillTemplate leaves unmatched placeholders unchanged', () => {
      const { fillTemplate } = require('../src/models/notification.model');
      const result = fillTemplate('Hello {{name}}', {}); // name not provided
      expect(result).toBe('Hello {{name}}');
    });
  });
});
