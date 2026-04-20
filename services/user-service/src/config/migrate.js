const { query } = require('@cricket-cms/shared').postgres;
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('user-migrate');

// ─────────────────────────────────────────
// IMPORTANT: This service does NOT create the
// `users` table — that belongs to auth-service.
// This service creates tables that REFERENCE users(id).
//
// For this to work, auth-service migrations must
// have run first (users table must exist).
// In production, services start in dependency order.
// ─────────────────────────────────────────
const runMigrations = async () => {
  logger.info('Running user service migrations...');

  // ── Table 1: profiles ──
  // Every user gets exactly one profile row.
  // Stores the human-readable info about a person.
  // user_id references the users table in auth-service
  // (same PostgreSQL database, different logical service boundary).
  await query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           UUID         UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name         VARCHAR(255) NOT NULL,
      contact_number    VARCHAR(20),
      address           TEXT,
      date_of_birth     DATE,
      profile_image_url TEXT,
      created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 2: staff ──
  // Created for users with role IN ('Coach','Selector','Accountant').
  // Stores employment details.
  await query(`
    CREATE TABLE IF NOT EXISTS staff (
      id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           UUID           UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      staff_type        VARCHAR(20)    NOT NULL
                        CHECK (staff_type IN ('Coach','Selector','Accountant')),
      salary            DECIMAL(10,2),
      hire_date         DATE,
      contract_end_date DATE,
      specialization    VARCHAR(100),
      created_at        TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 3: players ──
  // Created for users with role = 'Player'.
  // Stores cricket-specific player details.
  // jersey_number is unique — no two players share a jersey.
  await query(`
    CREATE TABLE IF NOT EXISTS players (
      id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID          UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      player_role         VARCHAR(30)   NOT NULL
                          CHECK (player_role IN ('Batsman','Bowler','All-rounder','Wicket-keeper')),
      jersey_number       INTEGER       UNIQUE,
      salary              DECIMAL(10,2),
      contract_start_date DATE,
      contract_end_date   DATE,
      fitness_status      VARCHAR(20)   DEFAULT 'Fit'
                          CHECK (fitness_status IN ('Fit','Injured','Recovering','Suspended')),
      is_available        BOOLEAN       DEFAULT true,
      created_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Indexes ──
  await query(`CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_staff_type ON staff(staff_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_players_role ON players(player_role)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_players_available ON players(is_available)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_players_fitness ON players(fitness_status)`);

  logger.info('User service migrations completed');
};

module.exports = { runMigrations };
