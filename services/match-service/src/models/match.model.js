const { query, transaction } = require('@cricket-cms/shared').postgres;

// ─────────────────────────────────────────
// MATCH QUERIES
// ─────────────────────────────────────────

// Get all matches with optional filters and pagination
const getAllMatches = async ({ status, matchType, from, to, limit, offset }) => {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (status)    { conditions.push(`m.status = $${idx++}`);     params.push(status); }
  if (matchType) { conditions.push(`m.match_type = $${idx++}`); params.push(matchType); }
  if (from)      { conditions.push(`m.match_date >= $${idx++}`);params.push(from); }
  if (to)        { conditions.push(`m.match_date <= $${idx++}`);params.push(to); }

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM matches m WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query(
    `SELECT
       m.id,
       m.opponent_team,
       m.match_date,
       m.match_time,
       m.venue,
       m.match_type,
       m.status,
       m.result,
       m.our_score,
       m.opponent_score,
       m.notes,
       m.created_at,
       m.updated_at,
       pr.full_name AS created_by_name
     FROM matches m
     LEFT JOIN users u  ON u.id = m.created_by
     LEFT JOIN profiles pr ON pr.user_id = u.id
     WHERE ${whereClause}
     ORDER BY m.match_date DESC, m.match_time DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return { matches: result.rows, total };
};

// Get one match — base details only (no lineup/logistics)
const getMatchById = async (matchId) => {
  const result = await query(
    `SELECT
       m.id,
       m.opponent_team,
       m.match_date,
       m.match_time,
       m.venue,
       m.match_type,
       m.status,
       m.result,
       m.our_score,
       m.opponent_score,
       m.notes,
       m.created_at,
       m.updated_at,
       m.created_by,
       pr.full_name AS created_by_name,
       ab.full_name AS approved_by_name
     FROM matches m
     LEFT JOIN users u     ON u.id = m.created_by
     LEFT JOIN profiles pr ON pr.user_id = u.id
     LEFT JOIN users ua    ON ua.id = m.approved_by
     LEFT JOIN profiles ab ON ab.user_id = ua.id
     WHERE m.id = $1`,
    [matchId]
  );
  return result.rows[0] || null;
};

// Create a new match
const createMatch = async ({
  opponentTeam, matchDate, matchTime, venue,
  matchType, notes, createdBy,
}) => {
  const result = await query(
    `INSERT INTO matches
       (opponent_team, match_date, match_time, venue, match_type, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [opponentTeam, matchDate, matchTime || null, venue, matchType, notes || null, createdBy]
  );
  return result.rows[0];
};

// Update match details — only allowed while Scheduled
const updateMatch = async (matchId, { opponentTeam, matchDate, matchTime, venue, matchType, notes }) => {
  const result = await query(
    `UPDATE matches SET
       opponent_team = COALESCE($1, opponent_team),
       match_date    = COALESCE($2, match_date),
       match_time    = COALESCE($3, match_time),
       venue         = COALESCE($4, venue),
       match_type    = COALESCE($5, match_type),
       notes         = COALESCE($6, notes),
       updated_at    = CURRENT_TIMESTAMP
     WHERE id = $7
     RETURNING *`,
    [opponentTeam, matchDate, matchTime, venue, matchType, notes, matchId]
  );
  return result.rows[0] || null;
};

// Update match status — used for In_Progress, Completed, Cancelled
const updateMatchStatus = async (matchId, { status, result, ourScore, opponentScore, approvedBy }) => {
  const res = await query(
    `UPDATE matches SET
       status         = $1,
       result         = COALESCE($2, result),
       our_score      = COALESCE($3, our_score),
       opponent_score = COALESCE($4, opponent_score),
       approved_by    = COALESCE($5, approved_by),
       updated_at     = CURRENT_TIMESTAMP
     WHERE id = $6
     RETURNING *`,
    [status, result || null, ourScore || null, opponentScore || null, approvedBy || null, matchId]
  );
  return res.rows[0] || null;
};

// Delete match — only allowed if Scheduled (not started yet)
const deleteMatch = async (matchId) => {
  const result = await query(
    `DELETE FROM matches WHERE id = $1 AND status = 'Scheduled'
     RETURNING id`,
    [matchId]
  );
  return result.rows[0] || null;
};

// ─────────────────────────────────────────
// LINEUP QUERIES
// ─────────────────────────────────────────

// Get full lineup for a match — joins player and profile data
const getLineupByMatchId = async (matchId) => {
  const result = await query(
    `SELECT
       ml.id             AS lineup_id,
       ml.batting_order,
       ml.bowling_order,
       ml.fielding_position,
       pl.id             AS player_id,
       pr.full_name,
       pr.profile_image_url,
       pl.player_role,
       pl.jersey_number
     FROM match_lineups ml
     JOIN players pl  ON pl.id = ml.player_id
     JOIN profiles pr ON pr.user_id = pl.user_id
     WHERE ml.match_id = $1
     ORDER BY
       COALESCE(ml.batting_order, 999) ASC,
       pr.full_name ASC`,
    [matchId]
  );
  return result.rows;
};

// Set (replace) lineup for a match
// Uses transaction: clears old lineup, inserts new one atomically
const setLineup = async (matchId, players) => {
  return transaction(async (client) => {
    // Remove existing lineup entries for this match
    await client.query(
      `DELETE FROM match_lineups WHERE match_id = $1`,
      [matchId]
    );

    // Insert all new lineup entries
    for (const p of players) {
      await client.query(
        `INSERT INTO match_lineups
           (match_id, player_id, batting_order, bowling_order, fielding_position)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          matchId,
          p.playerId,
          p.battingOrder  || null,
          p.bowlingOrder  || null,
          p.fieldingPosition || null,
        ]
      );
    }

    return players.length;
  });
};

// ─────────────────────────────────────────
// LOGISTICS QUERIES
// ─────────────────────────────────────────

// Get logistics for a match
const getLogisticsByMatchId = async (matchId) => {
  const result = await query(
    `SELECT * FROM match_logistics WHERE match_id = $1`,
    [matchId]
  );
  return result.rows[0] || null;
};

// Upsert logistics — create if not exists, update if exists
const upsertLogistics = async (matchId, { travelDetails, accommodation, equipmentChecklist, notes }) => {
  const result = await query(
    `INSERT INTO match_logistics
       (match_id, travel_details, accommodation, equipment_checklist, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (match_id)
     DO UPDATE SET
       travel_details      = COALESCE(EXCLUDED.travel_details, match_logistics.travel_details),
       accommodation       = COALESCE(EXCLUDED.accommodation, match_logistics.accommodation),
       equipment_checklist = COALESCE(EXCLUDED.equipment_checklist, match_logistics.equipment_checklist),
       notes               = COALESCE(EXCLUDED.notes, match_logistics.notes),
       updated_at          = CURRENT_TIMESTAMP
     RETURNING *`,
    [matchId, travelDetails || null, accommodation || null, equipmentChecklist || null, notes || null]
  );
  return result.rows[0];
};

// Get player IDs from a match lineup — used when publishing match events
// so the Notification Service knows who to notify
const getLineupPlayerIds = async (matchId) => {
  const result = await query(
    `SELECT pl.user_id
     FROM match_lineups ml
     JOIN players pl ON pl.id = ml.player_id
     WHERE ml.match_id = $1`,
    [matchId]
  );
  return result.rows.map((r) => r.user_id);
};

module.exports = {
  getAllMatches,
  getMatchById,
  createMatch,
  updateMatch,
  updateMatchStatus,
  deleteMatch,
  getLineupByMatchId,
  setLineup,
  getLogisticsByMatchId,
  upsertLogistics,
  getLineupPlayerIds,
};
