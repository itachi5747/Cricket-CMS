const { query } = require('@cricket-cms/shared').postgres;
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('auth-migrate');

// ─────────────────────────────────────────
// Creates all tables this service owns.
// Called once during server startup BEFORE
// the HTTP server starts accepting requests.
// Uses IF NOT EXISTS so it's safe to run repeatedly.
// ─────────────────────────────────────────
const runMigrations = async () => {
  logger.info('Running auth service migrations...');

  // ── Table 1: users ──
  // Stores login credentials and role.
  // UUID primary key — avoids exposing sequential IDs to clients.
  // role CHECK constraint — only the 5 defined roles are allowed at DB level.
  // is_active — lets us disable accounts without deleting data.
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      username      VARCHAR(50)  UNIQUE NOT NULL,
      email         VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role          VARCHAR(20)  NOT NULL
                    CHECK (role IN ('Chairman','Coach','Selector','Player','Accountant')),
      is_active     BOOLEAN      DEFAULT true,
      created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 2: refresh_tokens ──
  // Stores issued refresh tokens so we can:
  //   1. Validate them on /refresh requests
  //   2. Invalidate ALL tokens for a user (force logout everywhere)
  //   3. Rotate them — each /refresh call replaces the old token with a new one
  await query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      VARCHAR(500) NOT NULL,
      expires_at TIMESTAMP    NOT NULL,
      created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 3: password_reset_tokens ──
  // Stores short-lived tokens emailed to users for password reset.
  // is_used flag ensures each reset link works exactly once.
  await query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      VARCHAR(255) NOT NULL UNIQUE,
      expires_at TIMESTAMP    NOT NULL,
      is_used    BOOLEAN      DEFAULT false,
      created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Indexes ──
  // Make lookups fast. Without these, every query does a full table scan.
  await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token)`);

  logger.info('Auth service migrations completed');
};

module.exports = { runMigrations };
