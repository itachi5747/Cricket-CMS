const { query } = require('@cricket-cms/shared').postgres;
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('match-migrate');

// ─────────────────────────────────────────
// Depends on:
//   - users table   (auth-service)
//   - players table (user-service)
// ─────────────────────────────────────────
const runMigrations = async () => {
  logger.info('Running match service migrations...');

  // ── Table 1: matches ──
  // Core match record. approved_by is NULL until Chairman confirms.
  // our_score / opponent_score stored as VARCHAR because cricket
  // scores have complex formats like "325/7" or "298 all out".
  await query(`
    CREATE TABLE IF NOT EXISTS matches (
      id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      opponent_team   VARCHAR(100)  NOT NULL,
      match_date      DATE          NOT NULL,
      match_time      TIME,
      venue           VARCHAR(200)  NOT NULL,
      match_type      VARCHAR(20)   NOT NULL
                      CHECK (match_type IN ('Test','ODI','T20','Practice')),
      status          VARCHAR(20)   DEFAULT 'Scheduled'
                      CHECK (status IN ('Scheduled','In_Progress','Completed','Cancelled')),
      result          VARCHAR(20)
                      CHECK (result IN ('Win','Loss','Tie','No_Result') OR result IS NULL),
      our_score       VARCHAR(50),
      opponent_score  VARCHAR(50),
      notes           TEXT,
      created_by      UUID          NOT NULL REFERENCES users(id),
      approved_by     UUID          REFERENCES users(id),
      created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 2: match_lineups ──
  // Which players are selected for which match.
  // batting_order and bowling_order are nullable —
  // a fielder might not have a batting/bowling slot.
  // UNIQUE(match_id, player_id) — same player can't appear twice.
  await query(`
    CREATE TABLE IF NOT EXISTS match_lineups (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      match_id          UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      player_id         UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      batting_order     INTEGER,
      bowling_order     INTEGER,
      fielding_position VARCHAR(50),
      created_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(match_id, player_id)
    )
  `);

  // ── Table 3: match_logistics ──
  // One logistics record per match.
  // ON DELETE CASCADE — if match is deleted, logistics go too.
  await query(`
    CREATE TABLE IF NOT EXISTS match_logistics (
      id                   UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
      match_id             UUID      UNIQUE NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      travel_details       TEXT,
      accommodation        TEXT,
      equipment_checklist  TEXT,
      notes                TEXT,
      created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Indexes ──
  await query(`CREATE INDEX IF NOT EXISTS idx_matches_date       ON matches(match_date)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_matches_status     ON matches(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_matches_type       ON matches(match_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_matches_created_by ON matches(created_by)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_lineup_match       ON match_lineups(match_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_lineup_player      ON match_lineups(player_id)`);

  logger.info('Match service migrations completed');
};

module.exports = { runMigrations };
