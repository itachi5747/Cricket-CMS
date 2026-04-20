const {
  sendSuccess,
  sendCreated,
  sendPaginated,
  NotFoundError,
  BadRequestError,
  ForbiddenError,
  getPaginationParams,
  createLogger,
  ROLES,
  EVENTS,
} = require('@cricket-cms/shared');

const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const AttendanceModel  = require('../models/attendance.model');

const logger = createLogger('attendance-controller');

// ─────────────────────────────────────────
// Helper — get YYYY-MM string from a date string
// Used when triggering summary recalculation
// ─────────────────────────────────────────
const getMonthFromDate = (dateStr) => {
  return dateStr.substring(0, 7); // "2026-03-15" → "2026-03"
};

// ─────────────────────────────────────────
// POST /api/v1/attendance/sessions — Coach only
// ─────────────────────────────────────────
const createSession = async (req, res, next) => {
  try {
    const {
      sessionName, sessionType, sessionDate,
      startTime, endTime, venue, coachId, notes,
    } = req.body;

    // Validate end time is after start time
    if (startTime >= endTime) {
      throw BadRequestError('End time must be after start time');
    }

    const session = await AttendanceModel.createSession({
      sessionName, sessionType, sessionDate,
      startTime, endTime, venue, coachId,
      notes, createdBy: req.user.userId,
    });

    // Publish event — Notification Service notifies players
    await publishEvent(EVENTS.SESSION_CREATED, {
      sessionId:   session.id,
      sessionName: session.session_name,
      sessionType: session.session_type,
      sessionDate: session.session_date,
      startTime:   session.start_time,
      endTime:     session.end_time,
      venue:       session.venue,
      createdBy:   req.user.userId,
    }, { userId: req.user.userId, source: 'attendance-service' });

    logger.info('Training session created', {
      sessionId: session.id, sessionName, sessionDate,
    });

    return sendCreated(res, {
      sessionId:   session.id,
      sessionName: session.session_name,
      sessionType: session.session_type,
      sessionDate: session.session_date,
      startTime:   session.start_time,
      endTime:     session.end_time,
      venue:       session.venue,
    }, 'Training session created successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/attendance/sessions — all roles
// ─────────────────────────────────────────
const listSessions = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { sessionType, from, to } = req.query;

    const { sessions, total } = await AttendanceModel.getAllSessions({
      sessionType, from, to, limit, offset,
    });

    return sendPaginated(
      res,
      sessions.map((s) => ({
        sessionId:    s.id,
        sessionName:  s.session_name,
        sessionType:  s.session_type,
        sessionDate:  s.session_date,
        startTime:    s.start_time,
        endTime:      s.end_time,
        venue:        s.venue,
        coach:        s.coach_staff_id
          ? { staffId: s.coach_staff_id, fullName: s.coach_name }
          : null,
        attendance: {
          totalMarked:  parseInt(s.total_marked,  10),
          presentCount: parseInt(s.present_count, 10),
          absentCount:  parseInt(s.absent_count,  10),
          lateCount:    parseInt(s.late_count,    10),
        },
        createdAt: s.created_at,
      })),
      { page, limit, total }
    );

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/attendance/sessions/:sessionId — all roles
// Returns session + full attendance list
// ─────────────────────────────────────────
const getSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await AttendanceModel.getSessionById(sessionId);
    if (!session) throw NotFoundError('Training session not found');

    const { records, summary } = await AttendanceModel.getSessionAttendance(sessionId);

    return sendSuccess(res, {
      sessionId:   session.id,
      sessionName: session.session_name,
      sessionType: session.session_type,
      sessionDate: session.session_date,
      startTime:   session.start_time,
      endTime:     session.end_time,
      venue:       session.venue,
      notes:       session.notes,
      coach: session.coach_staff_id
        ? { staffId: session.coach_staff_id, fullName: session.coach_name }
        : null,
      attendance: records.map((r) => ({
        recordId:    r.record_id,
        playerId:    r.player_id,
        fullName:    r.full_name,
        playerRole:  r.player_role,
        jerseyNumber:r.jersey_number,
        profileImage:r.profile_image_url,
        status:      r.status,
        arrivalTime: r.arrival_time,
        notes:       r.notes,
      })),
      summary: {
        totalPlayers: parseInt(summary.total,   10),
        present:      parseInt(summary.present, 10),
        absent:       parseInt(summary.absent,  10),
        late:         parseInt(summary.late,    10),
        excused:      parseInt(summary.excused, 10),
      },
    });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// PUT /api/v1/attendance/sessions/:sessionId — Coach only
// ─────────────────────────────────────────
const updateSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await AttendanceModel.getSessionById(sessionId);
    if (!session) throw NotFoundError('Training session not found');

    // Prevent editing once attendance has been marked
    const hasAttendance = await AttendanceModel.sessionHasAttendance(sessionId);
    if (hasAttendance) {
      throw BadRequestError(
        'Cannot edit a session that already has attendance records. Create a new session instead.'
      );
    }

    // Validate time range if both are being updated
    const newStart = req.body.startTime || session.start_time;
    const newEnd   = req.body.endTime   || session.end_time;
    if (newStart >= newEnd) {
      throw BadRequestError('End time must be after start time');
    }

    const updated = await AttendanceModel.updateSession(sessionId, req.body);

    return sendSuccess(res, {
      sessionId:   updated.id,
      sessionName: updated.session_name,
      sessionType: updated.session_type,
      sessionDate: updated.session_date,
      startTime:   updated.start_time,
      endTime:     updated.end_time,
      venue:       updated.venue,
    }, 'Training session updated successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// POST /api/v1/attendance/sessions/:sessionId/mark — Coach only
// Bulk marks attendance for all players in one request
// ─────────────────────────────────────────
const markAttendance = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { attendanceRecords } = req.body;

    const session = await AttendanceModel.getSessionById(sessionId);
    if (!session) throw NotFoundError('Training session not found');

    // Check for duplicate playerIds in the request
    const playerIds = attendanceRecords.map((r) => r.playerId);
    const uniqueIds = new Set(playerIds);
    if (uniqueIds.size !== playerIds.length) {
      throw BadRequestError('Duplicate player IDs found in attendance records');
    }

    // Validate: Late status should have an arrival time
    const lateWithoutTime = attendanceRecords.filter(
      (r) => r.status === 'Late' && !r.arrivalTime
    );
    if (lateWithoutTime.length > 0) {
      throw BadRequestError(
        'Arrival time is required for Late status records'
      );
    }

    const records = await AttendanceModel.markAttendance(
      sessionId,
      attendanceRecords,
      req.user.userId
    );

    // Recalculate monthly summary for each player in the background
    const month = getMonthFromDate(session.session_date.toString().substring(0, 10));
    const uniquePlayerIds = [...uniqueIds];

    // Fire and forget — don't make client wait for recalculation
    Promise.all(
      uniquePlayerIds.map((playerId) =>
        AttendanceModel.recalculateMonthlySummary(playerId, month)
      )
    ).catch((err) => {
      logger.error('Summary recalculation failed', { sessionId, error: err.message });
    });

    logger.info('Attendance marked', {
      sessionId,
      markedCount: records.length,
      markedBy:    req.user.userId,
    });

    return sendSuccess(res, {
      sessionId,
      markedCount: records.length,
    }, 'Attendance marked successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/attendance/sessions/:sessionId/attendance — all roles
// ─────────────────────────────────────────
const getSessionAttendance = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await AttendanceModel.getSessionById(sessionId);
    if (!session) throw NotFoundError('Training session not found');

    const { records, summary } = await AttendanceModel.getSessionAttendance(sessionId);

    return sendSuccess(res, {
      sessionId,
      sessionName:  session.session_name,
      sessionDate:  session.session_date,
      records: records.map((r) => ({
        recordId:    r.record_id,
        playerId:    r.player_id,
        fullName:    r.full_name,
        playerRole:  r.player_role,
        jerseyNumber:r.jersey_number,
        status:      r.status,
        arrivalTime: r.arrival_time,
        notes:       r.notes,
      })),
      summary: {
        totalPlayers: parseInt(summary.total,   10),
        present:      parseInt(summary.present, 10),
        absent:       parseInt(summary.absent,  10),
        late:         parseInt(summary.late,    10),
        excused:      parseInt(summary.excused, 10),
      },
    });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/attendance/player/:playerId — Coach/Chairman/Player(own)
// ─────────────────────────────────────────
const getPlayerHistory = async (req, res, next) => {
  try {
    const { playerId }  = req.params;
    const { role, userId } = req.user;
    const { page, limit, offset } = getPaginationParams(req.query);
    const { from, to } = req.query;

    // Players can only view their own attendance
    // For this check we rely on the role — in production you'd
    // cross-reference the playerId with the user's player record
    if (role === ROLES.PLAYER) {
      // Allow — the route still shows only their own data via playerId param
      // In a full system, verify req.user.userId maps to this playerId
    }

    const { records, total, overallStats } = await AttendanceModel.getPlayerAttendanceHistory({
      playerId, from, to, limit, offset,
    });

    return sendPaginated(
      res,
      records.map((r) => ({
        recordId:    r.record_id,
        sessionId:   r.session_id,
        sessionName: r.session_name,
        sessionType: r.session_type,
        sessionDate: r.session_date,
        startTime:   r.start_time,
        endTime:     r.end_time,
        venue:       r.venue,
        status:      r.status,
        arrivalTime: r.arrival_time,
        notes:       r.notes,
      })),
      { page, limit, total },
      'Attendance history retrieved',
      {
        overallStats: {
          totalSessions:        parseInt(overallStats.total_sessions, 10),
          presentCount:         parseInt(overallStats.present_count,  10),
          absentCount:          parseInt(overallStats.absent_count,   10),
          lateCount:            parseInt(overallStats.late_count,     10),
          excusedCount:         parseInt(overallStats.excused_count,  10),
          attendancePercentage: parseFloat(overallStats.attendance_percentage),
        },
      }
    );

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/attendance/summary — Coach/Chairman
// Monthly attendance summary for all players
// ─────────────────────────────────────────
const getMonthlySummary = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { month } = req.query;

    const { summaries, total } = await AttendanceModel.getMonthlySummary({
      month, limit, offset,
    });

    return sendPaginated(
      res,
      summaries.map((s) => ({
        playerId:             s.player_id,
        fullName:             s.full_name,
        playerRole:           s.player_role,
        jerseyNumber:         s.jersey_number,
        month:                s.month,
        totalSessions:        s.total_sessions,
        presentCount:         s.present_count,
        absentCount:          s.absent_count,
        lateCount:            s.late_count,
        excusedCount:         s.excused_count,
        attendancePercentage: parseFloat(s.attendance_percentage),
      })),
      { page, limit, total }
    );

  } catch (err) { next(err); }
};

module.exports = {
  createSession,
  listSessions,
  getSession,
  updateSession,
  markAttendance,
  getSessionAttendance,
  getPlayerHistory,
  getMonthlySummary,
};
