const { query } = require('@cricket-cms/shared').postgres;
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('team-migrate');

// ─────────────────────────────────────────
// This service depends on:
//   - users table      (auth-service)
//   - staff table      (user-service)
//   - players table    (user-service)
// Those migrations must have run first.
// ─────────────────────────────────────────
const runMigrations = async () => {
  logger.info('Running team service migrations...');

  // ── Table 1: teams ──
  // A team is a named group with an assigned coach.
  // One coach can manage one team (assigned_coach_id).
  await query(`
    CREATE TABLE IF NOT EXISTS teams (
      id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      name             VARCHAR(100) UNIQUE NOT NULL,
      description      TEXT,
      assigned_coach_id UUID        REFERENCES staff(id) ON DELETE SET NULL,
      created_by       UUID         NOT NULL REFERENCES users(id),
      created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 2: team_players ──
  // Many-to-many: a player can be in multiple teams,
  // a team has multiple players.
  // UNIQUE(team_id, player_id) — same player can't be added twice.
  // Only one captain and one vice-captain allowed per team
  // (enforced at application level in the controller).
  await query(`
    CREATE TABLE IF NOT EXISTS team_players (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id       UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      player_id     UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      position      VARCHAR(50),
      is_captain    BOOLEAN     DEFAULT false,
      is_vice_captain BOOLEAN   DEFAULT false,
      added_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, player_id)
    )
  `);

  // ── Table 3: squads ──
  // A squad is a tournament-specific selection from a team.
  // Goes through Draft → Pending_Approval → Approved/Rejected.
  // selected_by = the Selector who created it.
  // approved_by = the Chairman who approved/rejected it.
  await query(`
    CREATE TABLE IF NOT EXISTS squads (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(100) NOT NULL,
      tournament_name VARCHAR(150),
      team_id         UUID         REFERENCES teams(id) ON DELETE SET NULL,
      selected_by     UUID         NOT NULL REFERENCES users(id),
      approved_by     UUID         REFERENCES users(id),
      status          VARCHAR(20)  DEFAULT 'Draft'
                      CHECK (status IN ('Draft','Pending_Approval','Approved','Rejected')),
      rejection_reason TEXT,
      created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Table 4: squad_players ──
  // Which players are selected in which squad.
  // selection_priority: 1 = starting XI, 2 = reserve etc.
  await query(`
    CREATE TABLE IF NOT EXISTS squad_players (
      id                 UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
      squad_id           UUID      NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
      player_id          UUID      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      selection_priority INTEGER   DEFAULT 1,
      added_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(squad_id, player_id)
    )
  `);

  // ── Indexes ──
  await query(`CREATE INDEX IF NOT EXISTS idx_teams_coach     ON teams(assigned_coach_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_team_players_team   ON team_players(team_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_team_players_player ON team_players(player_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_squads_status    ON squads(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_squads_team      ON squads(team_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_squad_players_squad  ON squad_players(squad_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_squad_players_player ON squad_players(player_id)`);

  logger.info('Team service migrations completed');
};

module.exports = { runMigrations };
