const bcrypt = require('bcryptjs');
const {
  sendSuccess,
  sendCreated,
  sendPaginated,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  getPaginationParams,
  createLogger,
  ROLES,
} = require('@cricket-cms/shared');

const ProfileModel  = require('../models/profile.model');
const MetadataModel = require('../models/metadata.model');

const logger = createLogger('user-controller');
const SALT_ROUNDS = 12;

// ─────────────────────────────────────────
// GET /api/v1/users/profile
// Any logged-in user gets their own profile
// ─────────────────────────────────────────
const getMyProfile = async (req, res, next) => {
  try {
    const { userId, role } = req.user;

    const profile = await ProfileModel.getProfileByUserId(userId);
    if (!profile) throw NotFoundError('Profile not found');

    // If user is a player, attach player-specific details
    let playerDetails = null;
    if (role === ROLES.PLAYER) {
      playerDetails = await ProfileModel.getPlayerByUserId(userId);
    }

    // Attach MongoDB preferences
    const preferences = await MetadataModel.getPreferences(userId);

    return sendSuccess(res, {
      userId:        profile.user_id,
      username:      profile.username,
      email:         profile.email,
      role:          profile.role,
      isActive:      profile.is_active,
      profile: {
        fullName:       profile.full_name,
        contactNumber:  profile.contact_number,
        address:        profile.address,
        dateOfBirth:    profile.date_of_birth,
        profileImage:   profile.profile_image_url,
      },
      playerDetails: playerDetails ? {
        playerId:          playerDetails.id,
        playerRole:        playerDetails.player_role,
        jerseyNumber:      playerDetails.jersey_number,
        fitnessStatus:     playerDetails.fitness_status,
        isAvailable:       playerDetails.is_available,
        contractEndDate:   playerDetails.contract_end_date,
      } : null,
      preferences: preferences.preferences,
    });

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// PUT /api/v1/users/profile
// Any logged-in user updates their own profile
// ─────────────────────────────────────────
const updateMyProfile = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const { fullName, contactNumber, address, dateOfBirth, profileImageUrl } = req.body;

    const updated = await ProfileModel.updateProfile(userId, {
      fullName, contactNumber, address, dateOfBirth, profileImageUrl,
    });

    if (!updated) throw NotFoundError('Profile not found');

    logger.info('Profile updated', { userId });

    return sendSuccess(res, {
      fullName:       updated.full_name,
      contactNumber:  updated.contact_number,
      address:        updated.address,
      dateOfBirth:    updated.date_of_birth,
      profileImage:   updated.profile_image_url,
    }, 'Profile updated successfully');

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// GET /api/v1/users/players
// Coach, Selector, Chairman — list all players with filters
// ─────────────────────────────────────────
const listPlayers = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { playerRole, isAvailable, fitnessStatus } = req.query;

    const { players, total } = await ProfileModel.getAllPlayers({
      playerRole,
      isAvailable: isAvailable !== undefined ? isAvailable === 'true' : undefined,
      fitnessStatus,
      limit,
      offset,
    });

    return sendPaginated(
      res,
      players.map((p) => ({
        playerId:       p.player_id,
        userId:         p.user_id,
        fullName:       p.full_name,
        email:          p.email,
        playerRole:     p.player_role,
        jerseyNumber:   p.jersey_number,
        fitnessStatus:  p.fitness_status,
        isAvailable:    p.is_available,
        profileImage:   p.profile_image_url,
        salary:         p.salary,
        contractEndDate: p.contract_end_date,
      })),
      { page, limit, total }
    );

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// GET /api/v1/users/players/:playerId
// Coach, Selector, Chairman — one player's full details
// ─────────────────────────────────────────
const getPlayer = async (req, res, next) => {
  try {
    const { playerId } = req.params;

    const player = await ProfileModel.getPlayerById(playerId);
    if (!player) throw NotFoundError('Player not found');

    // Fetch MongoDB metadata for players
    const metadata = await MetadataModel.getPlayerMetadata(player.player_id);

    return sendSuccess(res, {
      playerId:          player.player_id,
      userId:            player.user_id,
      username:          player.username,
      email:             player.email,
      isActive:          player.is_active,
      profile: {
        fullName:        player.full_name,
        contactNumber:   player.contact_number,
        address:         player.address,
        dateOfBirth:     player.date_of_birth,
        profileImage:    player.profile_image_url,
      },
      playerDetails: {
        playerRole:       player.player_role,
        jerseyNumber:     player.jersey_number,
        salary:           player.salary,
        contractStart:    player.contract_start_date,
        contractEnd:      player.contract_end_date,
        fitnessStatus:    player.fitness_status,
        isAvailable:      player.is_available,
      },
      metadata: {
        biography:        metadata.biography,
        achievements:     metadata.achievements,
        socialMedia:      metadata.socialMedia,
        emergencyContact: metadata.emergencyContact,
      },
    });

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// POST /api/v1/users/players
// Chairman only — create a player account
// ─────────────────────────────────────────
const createPlayer = async (req, res, next) => {
  try {
    const {
      username, email, password, fullName, contactNumber,
      playerRole, jerseyNumber, salary, contractStartDate, contractEndDate,
    } = req.body;

    // Hash password before storing
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const player = await ProfileModel.createPlayerWithProfile({
      username, email, passwordHash, fullName, contactNumber,
      playerRole, jerseyNumber, salary, contractStartDate, contractEndDate,
    });

    // Create empty MongoDB metadata document for this player
    await MetadataModel.getPlayerMetadata(player.playerId);

    logger.info('Player created', { playerId: player.playerId, createdBy: req.user.userId });

    return sendCreated(res, {
      playerId:   player.playerId,
      userId:     player.userId,
      username:   player.username,
      email:      player.email,
      fullName:   player.fullName,
      playerRole: player.playerRole,
    }, 'Player account created successfully');

  } catch (err) {
    // Jersey number conflict gives postgres unique violation
    if (err.code === '23505' && err.detail?.includes('jersey_number')) {
      return next(ConflictError('This jersey number is already assigned to another player'));
    }
    next(err);
  }
};

// ─────────────────────────────────────────
// PUT /api/v1/users/players/:playerId
// Chairman or Coach — update player details
// ─────────────────────────────────────────
const updatePlayer = async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const updates = req.body;

    const updated = await ProfileModel.updatePlayer(playerId, updates);
    if (!updated) throw NotFoundError('Player not found');

    logger.info('Player updated', { playerId, updatedBy: req.user.userId });

    return sendSuccess(res, {
      playerId:       updated.id,
      playerRole:     updated.player_role,
      jerseyNumber:   updated.jersey_number,
      fitnessStatus:  updated.fitness_status,
      isAvailable:    updated.is_available,
      salary:         updated.salary,
      contractEnd:    updated.contract_end_date,
    }, 'Player updated successfully');

  } catch (err) {
    if (err.code === '23505' && err.detail?.includes('jersey_number')) {
      return next(ConflictError('This jersey number is already taken'));
    }
    next(err);
  }
};

// ─────────────────────────────────────────
// GET /api/v1/users/staff
// Chairman only
// ─────────────────────────────────────────
const listStaff = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { staffType } = req.query;

    const { staff, total } = await ProfileModel.getAllStaff({ staffType, limit, offset });

    return sendPaginated(
      res,
      staff.map((s) => ({
        staffId:        s.staff_id,
        userId:         s.user_id,
        fullName:       s.full_name,
        email:          s.email,
        role:           s.role,
        staffType:      s.staff_type,
        salary:         s.salary,
        hireDate:       s.hire_date,
        specialization: s.specialization,
        isActive:       s.is_active,
      })),
      { page, limit, total }
    );

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// POST /api/v1/users/staff
// Chairman only — create a staff account
// ─────────────────────────────────────────
const createStaff = async (req, res, next) => {
  try {
    const {
      username, email, password, fullName, contactNumber,
      staffType, salary, hireDate, contractEndDate, specialization,
    } = req.body;

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const staff = await ProfileModel.createStaffWithProfile({
      username, email, passwordHash, fullName, contactNumber,
      staffType, salary, hireDate, contractEndDate, specialization,
    });

    logger.info('Staff created', { staffId: staff.staffId, staffType, createdBy: req.user.userId });

    return sendCreated(res, {
      staffId:   staff.staffId,
      userId:    staff.userId,
      username:  staff.username,
      email:     staff.email,
      fullName:  staff.fullName,
      staffType: staff.staffType,
    }, 'Staff member added successfully');

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// PUT /api/v1/users/staff/:staffId
// Chairman only
// ─────────────────────────────────────────
const updateStaff = async (req, res, next) => {
  try {
    const { staffId } = req.params;
    const updates = req.body;

    const updated = await ProfileModel.updateStaff(staffId, updates);
    if (!updated) throw NotFoundError('Staff member not found');

    logger.info('Staff updated', { staffId, updatedBy: req.user.userId });

    return sendSuccess(res, {
      staffId:        updated.staff_id,
      fullName:       updated.full_name,
      staffType:      updated.staff_type,
      salary:         updated.salary,
      specialization: updated.specialization,
      contractEnd:    updated.contract_end_date,
    }, 'Staff updated successfully');

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// DELETE /api/v1/users/staff/:staffId
// Chairman only — soft delete (deactivates account)
// ─────────────────────────────────────────
const deleteStaff = async (req, res, next) => {
  try {
    const { staffId } = req.params;

    // Prevent Chairman from deactivating themselves
    const staffRecord = await ProfileModel.getStaffById(staffId);
    if (!staffRecord) throw NotFoundError('Staff member not found');

    if (staffRecord.user_id === req.user.userId) {
      throw ForbiddenError('You cannot deactivate your own account');
    }

    await ProfileModel.deactivateStaff(staffId);

    logger.info('Staff deactivated', { staffId, deletedBy: req.user.userId });

    return sendSuccess(res, null, 'Staff member removed successfully');

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// GET /api/v1/users/preferences
// ─────────────────────────────────────────
const getPreferences = async (req, res, next) => {
  try {
    const prefs = await MetadataModel.getPreferences(req.user.userId);
    return sendSuccess(res, prefs.preferences);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// PUT /api/v1/users/preferences
// ─────────────────────────────────────────
const updatePreferences = async (req, res, next) => {
  try {
    const { theme, language, notifications, dashboardWidgets } = req.body;

    // Build MongoDB $set paths from provided fields
    const updates = {};
    if (theme)              updates['preferences.theme']              = theme;
    if (language)           updates['preferences.language']           = language;
    if (dashboardWidgets)   updates['preferences.dashboardWidgets']   = dashboardWidgets;
    if (notifications) {
      Object.entries(notifications).forEach(([key, val]) => {
        updates[`preferences.notifications.${key}`] = val;
      });
    }

    const prefs = await MetadataModel.updatePreferences(req.user.userId, updates);

    return sendSuccess(res, prefs.preferences, 'Preferences updated successfully');

  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  listPlayers,
  getPlayer,
  createPlayer,
  updatePlayer,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  getPreferences,
  updatePreferences,
};
