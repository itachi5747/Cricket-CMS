const { query } = require('@cricket-cms/shared').postgres;
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('attendance-migrate');

// ─────────────────────────────────────────
// Depends on:
//   - users table   (auth-service)
//   - staff table   (user-service)
//   - players table (user-service)
// ─────────────────────────────────────────
const runMigrations = async () => {
  logger.info('Running attendance service migrations...');

  // ── Table 1: training_sessions ──
  // Each session has a type (Batting/Bowling/Fielding/Fitness),
  // a date + time window, venue, and the coach who runs it.
  // coach_id is nullable — session can exist before coach assignment.
  await query(`
    CREATE TABLE IF NOT EXISTS training_sessions (
      id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      session_name VARCHAR(100) NOT NULL,
      session_type VARCHAR(30)  NOT NULL
                   CHECK (session_type IN ('Batting','Bowling','Fielding','Fitness','General')),
      session_date DATE         NOT NULL,
      start_time   TIME         NOT NULL,
      end_time     TIME         NOT NULL,
      venue        VARCHAR(200),
      coach_id     UUID         REFERENCES staff(id) ON DELETE SET NULL,
      notes        TEXT,
      created_by   UUID         NOT NULL REFERENCES users(id),
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 2: attendance_records ──
  // One row per player per session.
  // UNIQUE(session_id, player_id) — can't mark same player twice for same session.
  // marked_by is the coach who recorded the attendance.
  await query(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id   UUID        NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
      player_id    UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      status       VARCHAR(20) NOT NULL
                   CHECK (status IN ('Present','Absent','Late','Excused')),
      arrival_time TIME,
      notes        TEXT,
      marked_by    UUID        NOT NULL REFERENCES users(id),
      created_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, player_id)
    )
  `);

  // ── Table 3: attendance_summary ──
  // Pre-computed monthly rollup per player.
  // Updated after every attendance marking.
  // UNIQUE(player_id, month) — one summary row per player per month.
  // month format: "2026-03" (YYYY-MM).
  await query(`
    CREATE TABLE IF NOT EXISTS attendance_summary (
      id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      player_id             UUID          NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      month                 VARCHAR(7)    NOT NULL,
      total_sessions        INTEGER       DEFAULT 0,
      present_count         INTEGER       DEFAULT 0,
      absent_count          INTEGER       DEFAULT 0,
      late_count            INTEGER       DEFAULT 0,
      excused_count         INTEGER       DEFAULT 0,
      attendance_percentage DECIMAL(5,2)  DEFAULT 0,
      updated_at            TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(player_id, month)
    )
  `);

  // ── Indexes ──
  await query(`CREATE INDEX IF NOT EXISTS idx_sessions_date    ON training_sessions(session_date)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sessions_type    ON training_sessions(session_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sessions_coach   ON training_sessions(coach_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_records_session  ON attendance_records(session_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_records_player   ON attendance_records(player_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_records_status   ON attendance_records(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_summary_player   ON attendance_summary(player_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_summary_month    ON attendance_summary(month)`);

  logger.info('Attendance service migrations completed');
};

module.exports = { runMigrations };
