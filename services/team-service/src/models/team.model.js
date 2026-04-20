const { query, transaction } = require('@cricket-cms/shared').postgres;

// ─────────────────────────────────────────
// TEAM QUERIES
// ─────────────────────────────────────────

// Get all teams — with coach name and player count
const getAllTeams = async ({ limit, offset }) => {
  const countResult = await query(`SELECT COUNT(*) FROM teams`);
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query(
    `SELECT
       t.id,
       t.name,
       t.description,
       t.created_at,
       t.updated_at,
       s.id          AS coach_staff_id,
       p.full_name   AS coach_name,
       u.email       AS coach_email,
       COUNT(tp.id)  AS player_count
     FROM teams t
     LEFT JOIN staff s     ON s.id = t.assigned_coach_id
     LEFT JOIN profiles p  ON p.user_id = s.user_id
     LEFT JOIN users u     ON u.id = s.user_id
     LEFT JOIN team_players tp ON tp.team_id = t.id
     GROUP BY t.id, s.id, p.full_name, u.email
     ORDER BY t.name ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return { teams: result.rows, total };
};

// Get one team with its full player roster
const getTeamById = async (teamId) => {
  // Team details + coach
  const teamResult = await query(
    `SELECT
       t.id,
       t.name,
       t.description,
       t.created_at,
       t.updated_at,
       s.id          AS coach_staff_id,
       p.full_name   AS coach_name,
       u.email       AS coach_email,
       u.id          AS coach_user_id
     FROM teams t
     LEFT JOIN staff s    ON s.id = t.assigned_coach_id
     LEFT JOIN profiles p ON p.user_id = s.user_id
     LEFT JOIN users u    ON u.id = s.user_id
     WHERE t.id = $1`,
    [teamId]
  );

  if (!teamResult.rows[0]) return null;

  // Players in this team
  const playersResult = await query(
    `SELECT
       tp.id             AS team_player_id,
       tp.position,
       tp.is_captain,
       tp.is_vice_captain,
       tp.added_at,
       pl.id             AS player_id,
       pr.full_name,
       pr.profile_image_url,
       pl.player_role,
       pl.jersey_number,
       pl.fitness_status,
       pl.is_available
     FROM team_players tp
     JOIN players pl  ON pl.id = tp.player_id
     JOIN profiles pr ON pr.user_id = pl.user_id
     WHERE tp.team_id = $1
     ORDER BY tp.is_captain DESC, tp.is_vice_captain DESC, pr.full_name ASC`,
    [teamId]
  );

  return {
    ...teamResult.rows[0],
    players: playersResult.rows,
  };
};

// Get team by name — used for duplicate check
const getTeamByName = async (name) => {
  const result = await query(
    `SELECT id FROM teams WHERE LOWER(name) = LOWER($1)`,
    [name]
  );
  return result.rows[0] || null;
};

// Create team
const createTeam = async ({ name, description, assignedCoachId, createdBy }) => {
  const result = await query(
    `INSERT INTO teams (name, description, assigned_coach_id, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name, description || null, assignedCoachId || null, createdBy]
  );
  return result.rows[0];
};

// Update team
const updateTeam = async (teamId, { name, description, assignedCoachId }) => {
  const result = await query(
    `UPDATE teams SET
       name              = COALESCE($1, name),
       description       = COALESCE($2, description),
       assigned_coach_id = COALESCE($3, assigned_coach_id),
       updated_at        = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING *`,
    [name, description, assignedCoachId, teamId]
  );
  return result.rows[0] || null;
};

// Delete team — cascades to team_players automatically
const deleteTeam = async (teamId) => {
  const result = await query(
    `DELETE FROM teams WHERE id = $1 RETURNING id`,
    [teamId]
  );
  return result.rows[0] || null;
};

// ─────────────────────────────────────────
// TEAM PLAYER QUERIES
// ─────────────────────────────────────────

// Check if a player is already in a team
const isPlayerInTeam = async (teamId, playerId) => {
  const result = await query(
    `SELECT id FROM team_players WHERE team_id = $1 AND player_id = $2`,
    [teamId, playerId]
  );
  return !!result.rows[0];
};

// Add multiple players to a team in one transaction
// positions is array of: { playerId, position, isCaptain, isViceCaptain }
const addPlayersToTeam = async (teamId, positions) => {
  return transaction(async (client) => {
    // If any player is being set as captain, clear existing captain first
    const hasCaptain = positions.some((p) => p.isCaptain);
    const hasViceCaptain = positions.some((p) => p.isViceCaptain);

    if (hasCaptain) {
      await client.query(
        `UPDATE team_players SET is_captain = false WHERE team_id = $1`,
        [teamId]
      );
    }
    if (hasViceCaptain) {
      await client.query(
        `UPDATE team_players SET is_vice_captain = false WHERE team_id = $1`,
        [teamId]
      );
    }

    // Insert each player — ON CONFLICT updates their position/captain status
    for (const p of positions) {
      await client.query(
        `INSERT INTO team_players (team_id, player_id, position, is_captain, is_vice_captain)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (team_id, player_id)
         DO UPDATE SET
           position        = EXCLUDED.position,
           is_captain      = EXCLUDED.is_captain,
           is_vice_captain = EXCLUDED.is_vice_captain`,
        [teamId, p.playerId, p.position || null, p.isCaptain || false, p.isViceCaptain || false]
      );
    }

    return positions.length;
  });
};

// Remove a player from a team
const removePlayerFromTeam = async (teamId, playerId) => {
  const result = await query(
    `DELETE FROM team_players
     WHERE team_id = $1 AND player_id = $2
     RETURNING id`,
    [teamId, playerId]
  );
  return result.rows[0] || null;
};

// ─────────────────────────────────────────
// SQUAD QUERIES
// ─────────────────────────────────────────

// Get all squads with player count
const getAllSquads = async ({ status, teamId, limit, offset }) => {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (status) { conditions.push(`s.status = $${idx++}`); params.push(status); }
  if (teamId) { conditions.push(`s.team_id = $${idx++}`); params.push(teamId); }

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM squads s WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query(
    `SELECT
       s.id,
       s.name,
       s.tournament_name,
       s.status,
       s.created_at,
       s.updated_at,
       t.id    AS team_id,
       t.name  AS team_name,
       pr.full_name  AS selected_by_name,
       apr.full_name AS approved_by_name,
       COUNT(sp.id)  AS player_count
     FROM squads s
     LEFT JOIN teams t         ON t.id = s.team_id
     LEFT JOIN users su        ON su.id = s.selected_by
     LEFT JOIN profiles pr     ON pr.user_id = su.id
     LEFT JOIN users au        ON au.id = s.approved_by
     LEFT JOIN profiles apr    ON apr.user_id = au.id
     LEFT JOIN squad_players sp ON sp.squad_id = s.id
     WHERE ${whereClause}
     GROUP BY s.id, t.id, t.name, pr.full_name, apr.full_name
     ORDER BY s.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return { squads: result.rows, total };
};

// Get one squad with its full player list
const getSquadById = async (squadId) => {
  const squadResult = await query(
    `SELECT
       s.id,
       s.name,
       s.tournament_name,
       s.status,
       s.rejection_reason,
       s.created_at,
       s.updated_at,
       t.id    AS team_id,
       t.name  AS team_name,
       s.selected_by,
       pr.full_name  AS selected_by_name,
       s.approved_by,
       apr.full_name AS approved_by_name
     FROM squads s
     LEFT JOIN teams t         ON t.id = s.team_id
     LEFT JOIN users su        ON su.id = s.selected_by
     LEFT JOIN profiles pr     ON pr.user_id = su.id
     LEFT JOIN users au        ON au.id = s.approved_by
     LEFT JOIN profiles apr    ON apr.user_id = au.id
     WHERE s.id = $1`,
    [squadId]
  );

  if (!squadResult.rows[0]) return null;

  const playersResult = await query(
    `SELECT
       sp.selection_priority,
       pl.id          AS player_id,
       pr.full_name,
       pr.profile_image_url,
       pl.player_role,
       pl.jersey_number,
       pl.fitness_status,
       pl.is_available
     FROM squad_players sp
     JOIN players pl  ON pl.id = sp.player_id
     JOIN profiles pr ON pr.user_id = pl.user_id
     WHERE sp.squad_id = $1
     ORDER BY sp.selection_priority ASC, pr.full_name ASC`,
    [squadId]
  );

  return {
    ...squadResult.rows[0],
    players: playersResult.rows,
  };
};

// Create squad with players — all in one transaction
const createSquad = async ({ name, tournamentName, teamId, selectedBy, playerPriorities }) => {
  return transaction(async (client) => {
    // Insert squad
    const squadResult = await client.query(
      `INSERT INTO squads (name, tournament_name, team_id, selected_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, tournamentName || null, teamId || null, selectedBy]
    );
    const squad = squadResult.rows[0];

    // Insert all squad players with their priorities
    for (const { playerId, priority } of playerPriorities) {
      await client.query(
        `INSERT INTO squad_players (squad_id, player_id, selection_priority)
         VALUES ($1, $2, $3)`,
        [squad.id, playerId, priority || 1]
      );
    }

    return squad;
  });
};

// Update squad status — used for finalize and approve/reject
const updateSquadStatus = async (squadId, { status, approvedBy, rejectionReason }) => {
  const result = await query(
    `UPDATE squads SET
       status           = $1,
       approved_by      = COALESCE($2, approved_by),
       rejection_reason = COALESCE($3, rejection_reason),
       updated_at       = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING *`,
    [status, approvedBy || null, rejectionReason || null, squadId]
  );
  return result.rows[0] || null;
};

// Add players to existing squad
const addPlayersToSquad = async (squadId, playerPriorities) => {
  return transaction(async (client) => {
    for (const { playerId, priority } of playerPriorities) {
      await client.query(
        `INSERT INTO squad_players (squad_id, player_id, selection_priority)
         VALUES ($1, $2, $3)
         ON CONFLICT (squad_id, player_id)
         DO UPDATE SET selection_priority = EXCLUDED.selection_priority`,
        [squadId, playerId, priority || 1]
      );
    }
    return playerPriorities.length;
  });
};

// Check if squad belongs to a specific user
const isSquadOwnedBy = async (squadId, userId) => {
  const result = await query(
    `SELECT id FROM squads WHERE id = $1 AND selected_by = $2`,
    [squadId, userId]
  );
  return !!result.rows[0];
};

module.exports = {
  // Teams
  getAllTeams,
  getTeamById,
  getTeamByName,
  createTeam,
  updateTeam,
  deleteTeam,
  // Team players
  isPlayerInTeam,
  addPlayersToTeam,
  removePlayerFromTeam,
  // Squads
  getAllSquads,
  getSquadById,
  createSquad,
  updateSquadStatus,
  addPlayersToSquad,
  isSquadOwnedBy,
};
