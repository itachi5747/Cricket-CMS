const { query, transaction } = require('@cricket-cms/shared').postgres;

// ─────────────────────────────────────────
// TRAINING SESSION QUERIES
// ─────────────────────────────────────────

// Get all sessions with coach name and attendance summary counts
const getAllSessions = async ({ sessionType, from, to, limit, offset }) => {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (sessionType) { conditions.push(`ts.session_type = $${idx++}`); params.push(sessionType); }
  if (from)        { conditions.push(`ts.session_date >= $${idx++}`); params.push(from); }
  if (to)          { conditions.push(`ts.session_date <= $${idx++}`); params.push(to); }

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM training_sessions ts WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query(
    `SELECT
       ts.id,
       ts.session_name,
       ts.session_type,
       ts.session_date,
       ts.start_time,
       ts.end_time,
       ts.venue,
       ts.notes,
       ts.created_at,
       pr.full_name   AS coach_name,
       s.id           AS coach_staff_id,
       -- Count attendance records for this session
       COUNT(ar.id)                                          AS total_marked,
       COUNT(ar.id) FILTER (WHERE ar.status = 'Present')    AS present_count,
       COUNT(ar.id) FILTER (WHERE ar.status = 'Absent')     AS absent_count,
       COUNT(ar.id) FILTER (WHERE ar.status = 'Late')       AS late_count
     FROM training_sessions ts
     LEFT JOIN staff s     ON s.id = ts.coach_id
     LEFT JOIN profiles pr ON pr.user_id = s.user_id
     LEFT JOIN attendance_records ar ON ar.session_id = ts.id
     WHERE ${whereClause}
     GROUP BY ts.id, pr.full_name, s.id
     ORDER BY ts.session_date DESC, ts.start_time DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return { sessions: result.rows, total };
};

// Get a single session by ID — no attendance records here
const getSessionById = async (sessionId) => {
  const result = await query(
    `SELECT
       ts.*,
       pr.full_name  AS coach_name,
       s.id          AS coach_staff_id
     FROM training_sessions ts
     LEFT JOIN staff s     ON s.id = ts.coach_id
     LEFT JOIN profiles pr ON pr.user_id = s.user_id
     WHERE ts.id = $1`,
    [sessionId]
  );
  return result.rows[0] || null;
};

// Create a training session
const createSession = async ({
  sessionName, sessionType, sessionDate, startTime, endTime,
  venue, coachId, notes, createdBy,
}) => {
  const result = await query(
    `INSERT INTO training_sessions
       (session_name, session_type, session_date, start_time, end_time, venue, coach_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      sessionName, sessionType, sessionDate,
      startTime, endTime, venue || null,
      coachId || null, notes || null, createdBy,
    ]
  );
  return result.rows[0];
};

// Update session details — only before attendance has been marked
const updateSession = async (sessionId, { sessionName, sessionType, sessionDate, startTime, endTime, venue, notes }) => {
  const result = await query(
    `UPDATE training_sessions SET
       session_name = COALESCE($1, session_name),
       session_type = COALESCE($2, session_type),
       session_date = COALESCE($3, session_date),
       start_time   = COALESCE($4, start_time),
       end_time     = COALESCE($5, end_time),
       venue        = COALESCE($6, venue),
       notes        = COALESCE($7, notes),
       updated_at   = CURRENT_TIMESTAMP
     WHERE id = $8
     RETURNING *`,
    [sessionName, sessionType, sessionDate, startTime, endTime, venue, notes, sessionId]
  );
  return result.rows[0] || null;
};

// ─────────────────────────────────────────
// ATTENDANCE RECORD QUERIES
// ─────────────────────────────────────────

// Get attendance records for a session with player details
const getSessionAttendance = async (sessionId) => {
  const result = await query(
    `SELECT
       ar.id         AS record_id,
       ar.status,
       ar.arrival_time,
       ar.notes,
       ar.created_at,
       ar.updated_at,
       pl.id         AS player_id,
       pr.full_name,
       pr.profile_image_url,
       pl.player_role,
       pl.jersey_number
     FROM attendance_records ar
     JOIN players pl  ON pl.id = ar.player_id
     JOIN profiles pr ON pr.user_id = pl.user_id
     WHERE ar.session_id = $1
     ORDER BY pr.full_name ASC`,
    [sessionId]
  );

  // Also get summary counts
  const summaryResult = await query(
    `SELECT
       COUNT(*)                                             AS total,
       COUNT(*) FILTER (WHERE status = 'Present')          AS present,
       COUNT(*) FILTER (WHERE status = 'Absent')           AS absent,
       COUNT(*) FILTER (WHERE status = 'Late')             AS late,
       COUNT(*) FILTER (WHERE status = 'Excused')          AS excused
     FROM attendance_records
     WHERE session_id = $1`,
    [sessionId]
  );

  return {
    records: result.rows,
    summary: summaryResult.rows[0],
  };
};

// Bulk mark attendance for a session
// Uses a transaction — all records saved or none are
const markAttendance = async (sessionId, records, markedBy) => {
  return transaction(async (client) => {
    const results = [];

    for (const record of records) {
      const { playerId, status, arrivalTime, notes } = record;

      // Upsert — update if exists, insert if new
      const result = await client.query(
        `INSERT INTO attendance_records
           (session_id, player_id, status, arrival_time, notes, marked_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (session_id, player_id)
         DO UPDATE SET
           status       = EXCLUDED.status,
           arrival_time = EXCLUDED.arrival_time,
           notes        = EXCLUDED.notes,
           marked_by    = EXCLUDED.marked_by,
           updated_at   = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          sessionId, playerId, status,
          arrivalTime || null, notes || null, markedBy,
        ]
      );
      results.push(result.rows[0]);
    }

    return results;
  });
};

// ─────────────────────────────────────────
// PLAYER ATTENDANCE HISTORY
// ─────────────────────────────────────────

// Get a player's attendance history across all sessions
const getPlayerAttendanceHistory = async ({ playerId, from, to, limit, offset }) => {
  const conditions = ['ar.player_id = $1'];
  const params     = [playerId];
  let idx = 2;

  if (from) { conditions.push(`ts.session_date >= $${idx++}`); params.push(from); }
  if (to)   { conditions.push(`ts.session_date <= $${idx++}`); params.push(to); }

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*)
     FROM attendance_records ar
     JOIN training_sessions ts ON ts.id = ar.session_id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query(
    `SELECT
       ar.id          AS record_id,
       ar.status,
       ar.arrival_time,
       ar.notes,
       ts.id          AS session_id,
       ts.session_name,
       ts.session_type,
       ts.session_date,
       ts.start_time,
       ts.end_time,
       ts.venue
     FROM attendance_records ar
     JOIN training_sessions ts ON ts.id = ar.session_id
     WHERE ${whereClause}
     ORDER BY ts.session_date DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  // Calculate overall stats for this player
  const statsResult = await query(
    `SELECT
       COUNT(*)                                             AS total_sessions,
       COUNT(*) FILTER (WHERE ar.status = 'Present')       AS present_count,
       COUNT(*) FILTER (WHERE ar.status = 'Absent')        AS absent_count,
       COUNT(*) FILTER (WHERE ar.status = 'Late')          AS late_count,
       COUNT(*) FILTER (WHERE ar.status = 'Excused')       AS excused_count,
       CASE WHEN COUNT(*) > 0
         THEN ROUND(
           (COUNT(*) FILTER (WHERE ar.status IN ('Present','Late'))::NUMERIC / COUNT(*) * 100), 2
         )
         ELSE 0
       END AS attendance_percentage
     FROM attendance_records ar
     JOIN training_sessions ts ON ts.id = ar.session_id
     WHERE ar.player_id = $1`,
    [playerId]
  );

  return {
    records: result.rows,
    total,
    overallStats: statsResult.rows[0],
  };
};

// ─────────────────────────────────────────
// ATTENDANCE SUMMARY
// ─────────────────────────────────────────

// Get monthly attendance summary for all players
const getMonthlySummary = async ({ month, limit, offset }) => {
  const countResult = await query(
    `SELECT COUNT(DISTINCT player_id) FROM attendance_summary WHERE month = $1`,
    [month]
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query(
    `SELECT
       ats.*,
       pr.full_name,
       pl.player_role,
       pl.jersey_number
     FROM attendance_summary ats
     JOIN players pl  ON pl.id = ats.player_id
     JOIN profiles pr ON pr.user_id = pl.user_id
     WHERE ats.month = $1
     ORDER BY ats.attendance_percentage DESC, pr.full_name ASC
     LIMIT $2 OFFSET $3`,
    [month, limit, offset]
  );

  return { summaries: result.rows, total };
};

// Recalculate monthly summary for a player after attendance is marked.
// Called after every markAttendance — keeps the summary table in sync.
const recalculateMonthlySummary = async (playerId, month) => {
  await query(
    `INSERT INTO attendance_summary
       (player_id, month, total_sessions, present_count, absent_count,
        late_count, excused_count, attendance_percentage)
     SELECT
       ar.player_id,
       TO_CHAR(ts.session_date, 'YYYY-MM') AS month,
       COUNT(*)                                                    AS total_sessions,
       COUNT(*) FILTER (WHERE ar.status = 'Present')              AS present_count,
       COUNT(*) FILTER (WHERE ar.status = 'Absent')               AS absent_count,
       COUNT(*) FILTER (WHERE ar.status = 'Late')                 AS late_count,
       COUNT(*) FILTER (WHERE ar.status = 'Excused')              AS excused_count,
       CASE WHEN COUNT(*) > 0
         THEN ROUND(
           (COUNT(*) FILTER (WHERE ar.status IN ('Present','Late'))::NUMERIC / COUNT(*) * 100), 2
         )
         ELSE 0
       END AS attendance_percentage
     FROM attendance_records ar
     JOIN training_sessions ts ON ts.id = ar.session_id
     WHERE ar.player_id = $1
       AND TO_CHAR(ts.session_date, 'YYYY-MM') = $2
     GROUP BY ar.player_id, TO_CHAR(ts.session_date, 'YYYY-MM')
     ON CONFLICT (player_id, month)
     DO UPDATE SET
       total_sessions        = EXCLUDED.total_sessions,
       present_count         = EXCLUDED.present_count,
       absent_count          = EXCLUDED.absent_count,
       late_count            = EXCLUDED.late_count,
       excused_count         = EXCLUDED.excused_count,
       attendance_percentage = EXCLUDED.attendance_percentage,
       updated_at            = CURRENT_TIMESTAMP`,
    [playerId, month]
  );
};

// Check if a session already has attendance marked
// Used to prevent editing a session after records exist
const sessionHasAttendance = async (sessionId) => {
  const result = await query(
    `SELECT COUNT(*) FROM attendance_records WHERE session_id = $1`,
    [sessionId]
  );
  return parseInt(result.rows[0].count, 10) > 0;
};

module.exports = {
  getAllSessions,
  getSessionById,
  createSession,
  updateSession,
  getSessionAttendance,
  markAttendance,
  getPlayerAttendanceHistory,
  getMonthlySummary,
  recalculateMonthlySummary,
  sessionHasAttendance,
};
