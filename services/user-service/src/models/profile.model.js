const { query, transaction } = require('@cricket-cms/shared').postgres;

// ─────────────────────────────────────────
// PROFILE QUERIES
// ─────────────────────────────────────────

// Get a user's full profile — joins users + profiles tables
// Returns combined data in one object so controllers don't need to join manually
const getProfileByUserId = async (userId) => {
  const result = await query(
    `SELECT
       u.id          AS user_id,
       u.username,
       u.email,
       u.role,
       u.is_active,
       u.created_at  AS account_created_at,
       p.id          AS profile_id,
       p.full_name,
       p.contact_number,
       p.address,
       p.date_of_birth,
       p.profile_image_url,
       p.updated_at  AS profile_updated_at
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  return result.rows[0] || null;
};

// Create profile row — called right after a user is registered
const createProfile = async ({ userId, fullName, contactNumber }) => {
  const result = await query(
    `INSERT INTO profiles (user_id, full_name, contact_number)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, fullName, contactNumber || null]
  );
  return result.rows[0];
};

// Update profile — only updates fields that are provided (COALESCE keeps old value if null passed)
const updateProfile = async (userId, { fullName, contactNumber, address, dateOfBirth, profileImageUrl }) => {
  const result = await query(
    `UPDATE profiles SET
       full_name         = COALESCE($1, full_name),
       contact_number    = COALESCE($2, contact_number),
       address           = COALESCE($3, address),
       date_of_birth     = COALESCE($4, date_of_birth),
       profile_image_url = COALESCE($5, profile_image_url),
       updated_at        = CURRENT_TIMESTAMP
     WHERE user_id = $6
     RETURNING *`,
    [fullName, contactNumber, address, dateOfBirth, profileImageUrl, userId]
  );
  return result.rows[0] || null;
};

// ─────────────────────────────────────────
// PLAYER QUERIES
// ─────────────────────────────────────────

// Get all players — joins users + profiles + players
// Supports optional filters: playerRole, isAvailable, fitnessStatus
const getAllPlayers = async ({ playerRole, isAvailable, fitnessStatus, limit, offset }) => {
  // Build WHERE clauses dynamically based on which filters are provided
  const conditions = [`u.role = 'Player'`];
  const params = [];
  let paramIndex = 1;

  if (playerRole) {
    conditions.push(`pl.player_role = $${paramIndex++}`);
    params.push(playerRole);
  }
  if (isAvailable !== undefined) {
    conditions.push(`pl.is_available = $${paramIndex++}`);
    params.push(isAvailable);
  }
  if (fitnessStatus) {
    conditions.push(`pl.fitness_status = $${paramIndex++}`);
    params.push(fitnessStatus);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count for pagination
  const countResult = await query(
    `SELECT COUNT(*) FROM users u
     JOIN players pl ON pl.user_id = u.id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Get paginated results
  const dataResult = await query(
    `SELECT
       u.id          AS user_id,
       u.username,
       u.email,
       u.is_active,
       p.full_name,
       p.contact_number,
       p.profile_image_url,
       pl.id         AS player_id,
       pl.player_role,
       pl.jersey_number,
       pl.salary,
       pl.contract_start_date,
       pl.contract_end_date,
       pl.fitness_status,
       pl.is_available
     FROM users u
     JOIN profiles p  ON p.user_id  = u.id
     JOIN players pl  ON pl.user_id = u.id
     WHERE ${whereClause}
     ORDER BY p.full_name ASC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return { players: dataResult.rows, total };
};

// Get one player by their player record ID
const getPlayerById = async (playerId) => {
  const result = await query(
    `SELECT
       u.id          AS user_id,
       u.username,
       u.email,
       u.role,
       u.is_active,
       p.full_name,
       p.contact_number,
       p.address,
       p.date_of_birth,
       p.profile_image_url,
       pl.id         AS player_id,
       pl.player_role,
       pl.jersey_number,
       pl.salary,
       pl.contract_start_date,
       pl.contract_end_date,
       pl.fitness_status,
       pl.is_available
     FROM users u
     JOIN profiles p  ON p.user_id  = u.id
     JOIN players pl  ON pl.user_id = u.id
     WHERE pl.id = $1`,
    [playerId]
  );
  return result.rows[0] || null;
};

// Get player by user_id — used when checking if a user IS a player
const getPlayerByUserId = async (userId) => {
  const result = await query(
    `SELECT * FROM players WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
};

// Create player record — called by Chairman when adding a player account
// Uses a transaction because we need to create: user + profile + player atomically
const createPlayerWithProfile = async ({ username, email, passwordHash, fullName, contactNumber, playerRole, jerseyNumber, salary, contractStartDate, contractEndDate }) => {
  return transaction(async (client) => {
    // 1. Create user account
    const userResult = await client.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'Player')
       RETURNING id, username, email, role`,
      [username.toLowerCase(), email.toLowerCase(), passwordHash]
    );
    const user = userResult.rows[0];

    // 2. Create profile
    await client.query(
      `INSERT INTO profiles (user_id, full_name, contact_number)
       VALUES ($1, $2, $3)`,
      [user.id, fullName, contactNumber || null]
    );

    // 3. Create player record
    const playerResult = await client.query(
      `INSERT INTO players (user_id, player_role, jersey_number, salary, contract_start_date, contract_end_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [user.id, playerRole, jerseyNumber || null, salary || null, contractStartDate || null, contractEndDate || null]
    );

    return {
      userId:   user.id,
      playerId: playerResult.rows[0].id,
      username: user.username,
      email:    user.email,
      role:     user.role,
      fullName,
      playerRole,
    };
  });
};

// Update player details — Chairman or Coach
const updatePlayer = async (playerId, { playerRole, jerseyNumber, salary, contractStartDate, contractEndDate, fitnessStatus, isAvailable }) => {
  const result = await query(
    `UPDATE players SET
       player_role         = COALESCE($1, player_role),
       jersey_number       = COALESCE($2, jersey_number),
       salary              = COALESCE($3, salary),
       contract_start_date = COALESCE($4, contract_start_date),
       contract_end_date   = COALESCE($5, contract_end_date),
       fitness_status      = COALESCE($6, fitness_status),
       is_available        = COALESCE($7, is_available),
       updated_at          = CURRENT_TIMESTAMP
     WHERE id = $8
     RETURNING *`,
    [playerRole, jerseyNumber, salary, contractStartDate, contractEndDate, fitnessStatus, isAvailable, playerId]
  );
  return result.rows[0] || null;
};

// ─────────────────────────────────────────
// STAFF QUERIES
// ─────────────────────────────────────────

// Get all staff — joins users + profiles + staff
const getAllStaff = async ({ staffType, limit, offset }) => {
  const conditions = [`u.role IN ('Coach','Selector','Accountant')`];
  const params = [];
  let paramIndex = 1;

  if (staffType) {
    conditions.push(`s.staff_type = $${paramIndex++}`);
    params.push(staffType);
  }

  const whereClause = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) FROM users u
     JOIN staff s ON s.user_id = u.id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const dataResult = await query(
    `SELECT
       u.id          AS user_id,
       u.username,
       u.email,
       u.role,
       u.is_active,
       p.full_name,
       p.contact_number,
       p.profile_image_url,
       s.id          AS staff_id,
       s.staff_type,
       s.salary,
       s.hire_date,
       s.contract_end_date,
       s.specialization
     FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN staff s    ON s.user_id = u.id
     WHERE ${whereClause}
     ORDER BY p.full_name ASC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return { staff: dataResult.rows, total };
};

// Get one staff member by staff record ID
const getStaffById = async (staffId) => {
  const result = await query(
    `SELECT
       u.id          AS user_id,
       u.username,
       u.email,
       u.role,
       u.is_active,
       p.full_name,
       p.contact_number,
       p.address,
       p.profile_image_url,
       s.id          AS staff_id,
       s.staff_type,
       s.salary,
       s.hire_date,
       s.contract_end_date,
       s.specialization
     FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN staff s    ON s.user_id = u.id
     WHERE s.id = $1`,
    [staffId]
  );
  return result.rows[0] || null;
};

// Create staff member — Chairman adds Coach/Selector/Accountant
// Transaction: creates user + profile + staff atomically
const createStaffWithProfile = async ({ username, email, passwordHash, fullName, contactNumber, staffType, salary, hireDate, contractEndDate, specialization }) => {
  return transaction(async (client) => {
    const userResult = await client.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, role`,
      [username.toLowerCase(), email.toLowerCase(), passwordHash, staffType]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO profiles (user_id, full_name, contact_number)
       VALUES ($1, $2, $3)`,
      [user.id, fullName, contactNumber || null]
    );

    const staffResult = await client.query(
      `INSERT INTO staff (user_id, staff_type, salary, hire_date, contract_end_date, specialization)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [user.id, staffType, salary || null, hireDate || null, contractEndDate || null, specialization || null]
    );

    return {
      staffId:  staffResult.rows[0].id,
      userId:   user.id,
      username: user.username,
      email:    user.email,
      role:     user.role,
      fullName,
      staffType,
    };
  });
};

// Update staff member details
const updateStaff = async (staffId, { salary, hireDate, contractEndDate, specialization, contactNumber }) => {
  // Update staff table
  const staffResult = await query(
    `UPDATE staff SET
       salary            = COALESCE($1, salary),
       hire_date         = COALESCE($2, hire_date),
       contract_end_date = COALESCE($3, contract_end_date),
       specialization    = COALESCE($4, specialization),
       updated_at        = CURRENT_TIMESTAMP
     WHERE id = $5
     RETURNING user_id`,
    [salary, hireDate, contractEndDate, specialization, staffId]
  );

  if (!staffResult.rows[0]) return null;
  const { user_id } = staffResult.rows[0];

  // Update contact number in profiles if provided
  if (contactNumber) {
    await query(
      `UPDATE profiles SET contact_number = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [contactNumber, user_id]
    );
  }

  return getStaffById(staffId);
};

// Soft-delete staff — deactivate the user account
// We don't hard delete to preserve audit history
const deactivateStaff = async (staffId) => {
  const result = await query(
    `UPDATE users u SET is_active = false
     FROM staff s
     WHERE s.user_id = u.id AND s.id = $1
     RETURNING u.id`,
    [staffId]
  );
  return result.rows[0] || null;
};

module.exports = {
  // Profile
  getProfileByUserId,
  createProfile,
  updateProfile,
  // Players
  getAllPlayers,
  getPlayerById,
  getPlayerByUserId,
  createPlayerWithProfile,
  updatePlayer,
  // Staff
  getAllStaff,
  getStaffById,
  createStaffWithProfile,
  updateStaff,
  deactivateStaff,
};
