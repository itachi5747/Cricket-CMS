const { query, transaction } = require('@cricket-cms/shared').postgres;

// ─────────────────────────────────────────
// This is the ONLY file in the auth service
// that writes SQL. Controllers never touch
// the database directly — they call these
// functions. This makes the code testable
// and keeps SQL in one place.
// ─────────────────────────────────────────

// ── USER QUERIES ──────────────────────────

// Used during login — needs password_hash for bcrypt comparison
const findUserByEmail = async (email) => {
  const result = await query(
    `SELECT id, username, email, password_hash, role, is_active
     FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );
  return result.rows[0] || null;
};

// Used when validating tokens — confirms user still exists and is active
const findUserById = async (id) => {
  const result = await query(
    `SELECT id, username, email, role, is_active FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

// Used during registration — checks username isn't already taken
const findUserByUsername = async (username) => {
  const result = await query(
    `SELECT id FROM users WHERE username = $1`,
    [username.toLowerCase()]
  );
  return result.rows[0] || null;
};

// Used during registration — inserts new user row
// Returns the new user WITHOUT password_hash (never send hash to client)
const createUser = async ({ username, email, passwordHash, role }) => {
  const result = await query(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, email, role, is_active, created_at`,
    [username.toLowerCase(), email.toLowerCase(), passwordHash, role]
  );
  return result.rows[0];
};

// Used during password reset — replaces old hash with new one
const updateUserPassword = async (userId, newPasswordHash) => {
  await query(
    `UPDATE users
     SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [newPasswordHash, userId]
  );
};

// ── REFRESH TOKEN QUERIES ─────────────────

// Stores a refresh token after successful login
const saveRefreshToken = async (userId, token, expiresAt) => {
  const result = await query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3) RETURNING id`,
    [userId, token, expiresAt]
  );
  return result.rows[0];
};

// Finds a valid (non-expired) refresh token and JOINs user data
// Returns null if token doesn't exist or is expired
const findRefreshToken = async (token) => {
  const result = await query(
    `SELECT rt.id, rt.user_id, rt.expires_at,
            u.email, u.role, u.username, u.is_active
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token = $1
       AND rt.expires_at > CURRENT_TIMESTAMP`,
    [token]
  );
  return result.rows[0] || null;
};

// Deletes one token — used on normal logout (single device)
const deleteRefreshToken = async (token) => {
  await query(`DELETE FROM refresh_tokens WHERE token = $1`, [token]);
};

// Deletes ALL tokens for a user — used for "logout everywhere" or when
// password is reset (invalidate all active sessions)
const deleteAllRefreshTokensForUser = async (userId) => {
  await query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
};

// Atomically swaps old refresh token for new one.
// MUST be a transaction — if delete succeeds but insert fails,
// the user would be locked out. Both must succeed or both must roll back.
const rotateRefreshToken = async (oldToken, userId, newToken, expiresAt) => {
  return transaction(async (client) => {
    await client.query(`DELETE FROM refresh_tokens WHERE token = $1`, [oldToken]);
    const result = await client.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, newToken, expiresAt]
    );
    return result.rows[0];
  });
};

// ── PASSWORD RESET TOKEN QUERIES ──────────

// Saves a reset token and invalidates any previous unused tokens for this user
// (so requesting reset twice doesn't leave two valid reset links floating around)
const saveResetToken = async (userId, token, expiresAt) => {
  await query(
    `UPDATE password_reset_tokens SET is_used = true
     WHERE user_id = $1 AND is_used = false`,
    [userId]
  );
  const result = await query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3) RETURNING id`,
    [userId, token, expiresAt]
  );
  return result.rows[0];
};

// Finds a token that is: not used + not expired
const findResetToken = async (token) => {
  const result = await query(
    `SELECT prt.id, prt.user_id, prt.expires_at, u.email, u.username
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token = $1
       AND prt.is_used = false
       AND prt.expires_at > CURRENT_TIMESTAMP`,
    [token]
  );
  return result.rows[0] || null;
};

// Marks token as used — called immediately after password is changed
// so the reset link can never be reused
const markResetTokenUsed = async (tokenId) => {
  await query(
    `UPDATE password_reset_tokens SET is_used = true WHERE id = $1`,
    [tokenId]
  );
};

module.exports = {
  findUserByEmail,
  findUserById,
  findUserByUsername,
  createUser,
  updateUserPassword,
  saveRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
  deleteAllRefreshTokensForUser,
  rotateRefreshToken,
  saveResetToken,
  findResetToken,
  markResetTokenUsed,
};
