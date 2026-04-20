require('dotenv').config({ path: `${__dirname}/../.env` });
const request = require('supertest');
const jwt     = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_key_minimum_32_chars_long!!';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV   = 'test';

const makeToken = (overrides = {}) =>
  jwt.sign(
    { userId: 'user-uuid-1', username: 'coach', email: 'coach@c.com', role: 'Coach', ...overrides },
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
      connectRabbitMQ:        jest.fn().mockResolvedValue(true),
      testRabbitMQConnection: jest.fn().mockResolvedValue(true),
      closeRabbitMQ:          jest.fn(),
      publishEvent:           jest.fn().mockResolvedValue('event-id'),
    },
  };
});

jest.mock('../src/models/attendance.model');
jest.mock('../src/config/migrate', () => ({ runMigrations: jest.fn().mockResolvedValue(true) }));

const AttendanceModel = require('../src/models/attendance.model');
const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const { createApp, notFoundHandler, errorHandler } = require('@cricket-cms/shared');
const attendanceRoutes = require('../src/routes/attendance.routes');

const buildApp = () => {
  const app = createApp('attendance-test');
  app.use('/api/v1/attendance', attendanceRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// Reusable mock session
const mockSession = {
  id: 'session-uuid-1',
  session_name: 'Morning Batting Practice',
  session_type: 'Batting',
  session_date: '2026-03-20',
  start_time: '09:00:00',
  end_time: '12:00:00',
  venue: 'National Cricket Academy',
  notes: null,
  coach_staff_id: 'staff-1',
  coach_name: 'Head Coach',
  created_at: new Date(),
};

// ─────────────────────────────────────────
describe('Attendance Service — All Endpoints', () => {
  let app;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => jest.clearAllMocks());

  // ─── POST /sessions ──────────────────────
  describe('POST /api/v1/attendance/sessions', () => {

    it('201 — Coach creates session and event published', async () => {
      const token = makeToken({ role: 'Coach' });
      AttendanceModel.createSession.mockResolvedValue(mockSession);

      const res = await request(app)
        .post('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sessionName: 'Morning Batting Practice',
          sessionType: 'Batting',
          sessionDate: '2026-03-20',
          startTime:   '09:00',
          endTime:     '12:00',
          venue:       'National Cricket Academy',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.sessionName).toBe('Morning Batting Practice');
      // session.created event must fire to notify players
      expect(publishEvent).toHaveBeenCalledWith(
        'session.created',
        expect.objectContaining({ sessionId: 'session-uuid-1' }),
        expect.any(Object)
      );
    });

    it('400 — end time before start time', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sessionName: 'Evening Practice',
          sessionType: 'Batting',
          sessionDate: '2026-03-20',
          startTime:   '18:00',
          endTime:     '09:00', // before start!
        });

      expect(res.status).toBe(400);
    });

    it('403 — Player cannot create session', async () => {
      const token = makeToken({ role: 'Player' });
      const res = await request(app)
        .post('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sessionName: 'Test', sessionType: 'Batting',
          sessionDate: '2026-03-20', startTime: '09:00', endTime: '12:00',
        });
      expect(res.status).toBe(403);
    });

    it('422 — invalid session type', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sessionName: 'Test', sessionType: 'Swimming', // invalid
          sessionDate: '2026-03-20', startTime: '09:00', endTime: '12:00',
        });
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /sessions ───────────────────────
  describe('GET /api/v1/attendance/sessions', () => {

    it('200 — any authenticated user can list sessions', async () => {
      const token = makeToken({ role: 'Player' });
      AttendanceModel.getAllSessions.mockResolvedValue({
        sessions: [{
          ...mockSession,
          total_marked: '12', present_count: '10',
          absent_count: '1', late_count: '1',
        }],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/attendance/sessions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].sessionName).toBe('Morning Batting Practice');
      expect(res.body.data[0].attendance.presentCount).toBe(10);
    });

    it('200 — supports sessionType filter', async () => {
      const token = makeToken({ role: 'Coach' });
      AttendanceModel.getAllSessions.mockResolvedValue({ sessions: [], total: 0 });

      await request(app)
        .get('/api/v1/attendance/sessions?sessionType=Batting')
        .set('Authorization', `Bearer ${token}`);

      expect(AttendanceModel.getAllSessions).toHaveBeenCalledWith(
        expect.objectContaining({ sessionType: 'Batting' })
      );
    });
  });

  // ─── POST /sessions/:id/mark ─────────────
  describe('POST /api/v1/attendance/sessions/:sessionId/mark', () => {

    const sessionId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('200 — Coach marks attendance for multiple players', async () => {
      const token = makeToken({ role: 'Coach' });
      AttendanceModel.getSessionById.mockResolvedValue({
        ...mockSession,
        id: sessionId,
        session_date: '2026-03-20',
      });
      AttendanceModel.markAttendance.mockResolvedValue([
        { id: 'r1', status: 'Present' },
        { id: 'r2', status: 'Late' },
        { id: 'r3', status: 'Absent' },
      ]);
      AttendanceModel.recalculateMonthlySummary.mockResolvedValue();

      const res = await request(app)
        .post(`/api/v1/attendance/sessions/${sessionId}/mark`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          attendanceRecords: [
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'Present', arrivalTime: '09:00' },
            { playerId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'Late',    arrivalTime: '09:15' },
            { playerId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'Absent' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.markedCount).toBe(3);
    });

    it('400 — duplicate player IDs in request', async () => {
      const token = makeToken({ role: 'Coach' });
      AttendanceModel.getSessionById.mockResolvedValue({ ...mockSession, id: sessionId, session_date: '2026-03-20' });

      const res = await request(app)
        .post(`/api/v1/attendance/sessions/${sessionId}/mark`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          attendanceRecords: [
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'Present', arrivalTime: '09:00' },
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'Absent' }, // duplicate!
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Duplicate');
    });

    it('400 — Late status without arrival time', async () => {
      const token = makeToken({ role: 'Coach' });
      AttendanceModel.getSessionById.mockResolvedValue({
        ...mockSession, id: sessionId, session_date: '2026-03-20',
      });

      const res = await request(app)
        .post(`/api/v1/attendance/sessions/${sessionId}/mark`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          attendanceRecords: [
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'Late' }, // no arrivalTime!
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Arrival time');
    });

    it('403 — Chairman cannot mark attendance', async () => {
      const token = makeToken({ role: 'Chairman' });
      const res = await request(app)
        .post(`/api/v1/attendance/sessions/${sessionId}/mark`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          attendanceRecords: [
            { playerId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', status: 'Present', arrivalTime: '09:00' },
          ],
        });
      expect(res.status).toBe(403);
    });
  });

  // ─── PUT /sessions/:sessionId ────────────
  describe('PUT /api/v1/attendance/sessions/:sessionId', () => {
    const sessionId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('200 — Coach updates session before attendance is marked', async () => {
      const token = makeToken({ role: 'Coach' });
      AttendanceModel.getSessionById.mockResolvedValue({ ...mockSession, id: sessionId });
      AttendanceModel.sessionHasAttendance.mockResolvedValue(false);
      AttendanceModel.updateSession.mockResolvedValue({
        ...mockSession, id: sessionId, venue: 'Gaddafi Stadium',
      });

      const res = await request(app)
        .put(`/api/v1/attendance/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ venue: 'Gaddafi Stadium' });

      expect(res.status).toBe(200);
    });

    it('400 — cannot edit session with existing attendance records', async () => {
      const token = makeToken({ role: 'Coach' });
      AttendanceModel.getSessionById.mockResolvedValue({ ...mockSession, id: sessionId });
      AttendanceModel.sessionHasAttendance.mockResolvedValue(true); // has records!

      const res = await request(app)
        .put(`/api/v1/attendance/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ venue: 'New Venue' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('attendance records');
    });
  });

  // ─── GET /summary ────────────────────────
  describe('GET /api/v1/attendance/summary', () => {

    it('200 — Coach views monthly summary', async () => {
      const token = makeToken({ role: 'Coach' });
      AttendanceModel.getMonthlySummary.mockResolvedValue({
        summaries: [
          {
            player_id: 'p1', full_name: 'Ahmed Khan',
            player_role: 'Batsman', jersey_number: 1,
            month: '2026-03', total_sessions: 10,
            present_count: 9, absent_count: 1,
            late_count: 0, excused_count: 0,
            attendance_percentage: '90.00',
          },
        ],
        total: 1,
      });

      const res = await request(app)
        .get('/api/v1/attendance/summary?month=2026-03')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].attendancePercentage).toBe(90);
      expect(res.body.data[0].presentCount).toBe(9);
    });

    it('422 — missing month parameter', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .get('/api/v1/attendance/summary')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(422);
    });

    it('403 — Player cannot view summary', async () => {
      const token = makeToken({ role: 'Player' });
      const res = await request(app)
        .get('/api/v1/attendance/summary?month=2026-03')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ─── GET /player/:playerId ───────────────
  describe('GET /api/v1/attendance/player/:playerId', () => {

    it('200 — Coach views player attendance history', async () => {
      const token = makeToken({ role: 'Coach' });
      AttendanceModel.getPlayerAttendanceHistory.mockResolvedValue({
        records: [{
          record_id: 'r1', session_id: 'session-uuid-1',
          session_name: 'Morning Batting', session_type: 'Batting',
          session_date: '2026-03-20', start_time: '09:00', end_time: '12:00',
          venue: 'NCA', status: 'Present', arrival_time: '09:00', notes: null,
        }],
        total: 1,
        overallStats: {
          total_sessions: '10', present_count: '9', absent_count: '1',
          late_count: '0', excused_count: '0', attendance_percentage: '90.00',
        },
      });

      const res = await request(app)
        .get('/api/v1/attendance/player/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].status).toBe('Present');
    });

    it('200 — Player views own history', async () => {
      const token = makeToken({ role: 'Player' });
      AttendanceModel.getPlayerAttendanceHistory.mockResolvedValue({
        records: [], total: 0,
        overallStats: {
          total_sessions: '0', present_count: '0', absent_count: '0',
          late_count: '0', excused_count: '0', attendance_percentage: '0',
        },
      });

      const res = await request(app)
        .get('/api/v1/attendance/player/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('403 — Accountant cannot view attendance history', async () => {
      const token = makeToken({ role: 'Accountant' });
      const res = await request(app)
        .get('/api/v1/attendance/player/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });
});
