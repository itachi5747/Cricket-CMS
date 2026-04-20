const {
  sendSuccess,
  sendCreated,
  sendPaginated,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
  getPaginationParams,
  createLogger,
  ROLES,
  SQUAD_STATUS,
  EVENTS,
} = require('@cricket-cms/shared');

const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const TeamModel = require('../models/team.model');

const logger = createLogger('team-controller');

// ─────────────────────────────────────────
// TEAM CONTROLLERS
// ─────────────────────────────────────────

// POST /api/v1/teams — Chairman only
const createTeam = async (req, res, next) => {
  try {
    const { name, description, assignedCoachId } = req.body;

    // Prevent duplicate team names
    const existing = await TeamModel.getTeamByName(name);
    if (existing) throw ConflictError(`A team named "${name}" already exists`);

    const team = await TeamModel.createTeam({
      name, description, assignedCoachId,
      createdBy: req.user.userId,
    });

    logger.info('Team created', { teamId: team.id, name, createdBy: req.user.userId });

    return sendCreated(res, {
      teamId:      team.id,
      name:        team.name,
      description: team.description,
      createdAt:   team.created_at,
    }, 'Team created successfully');

  } catch (err) { next(err); }
};

// GET /api/v1/teams — all authenticated roles
const listTeams = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { teams, total } = await TeamModel.getAllTeams({ limit, offset });

    return sendPaginated(
      res,
      teams.map((t) => ({
        teamId:       t.id,
        name:         t.name,
        description:  t.description,
        playerCount:  parseInt(t.player_count, 10),
        assignedCoach: t.coach_staff_id ? {
          staffId:   t.coach_staff_id,
          fullName:  t.coach_name,
          email:     t.coach_email,
        } : null,
        createdAt: t.created_at,
      })),
      { page, limit, total }
    );

  } catch (err) { next(err); }
};

// GET /api/v1/teams/:teamId — all authenticated roles
const getTeam = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const team = await TeamModel.getTeamById(teamId);
    if (!team) throw NotFoundError('Team not found');

    return sendSuccess(res, {
      teamId:      team.id,
      name:        team.name,
      description: team.description,
      assignedCoach: team.coach_staff_id ? {
        staffId:  team.coach_staff_id,
        fullName: team.coach_name,
        email:    team.coach_email,
      } : null,
      players: team.players.map((p) => ({
        playerId:       p.player_id,
        fullName:       p.full_name,
        playerRole:     p.player_role,
        jerseyNumber:   p.jersey_number,
        position:       p.position,
        isCaptain:      p.is_captain,
        isViceCaptain:  p.is_vice_captain,
        fitnessStatus:  p.fitness_status,
        isAvailable:    p.is_available,
        profileImage:   p.profile_image_url,
      })),
      createdAt: team.created_at,
    });

  } catch (err) { next(err); }
};

// PUT /api/v1/teams/:teamId — Chairman or Coach
const updateTeam = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const { name, description, assignedCoachId } = req.body;

    // Check new name doesn't clash with another team
    if (name) {
      const existing = await TeamModel.getTeamByName(name);
      if (existing && existing.id !== teamId) {
        throw ConflictError(`A team named "${name}" already exists`);
      }
    }

    const updated = await TeamModel.updateTeam(teamId, { name, description, assignedCoachId });
    if (!updated) throw NotFoundError('Team not found');

    logger.info('Team updated', { teamId, updatedBy: req.user.userId });

    return sendSuccess(res, {
      teamId:      updated.id,
      name:        updated.name,
      description: updated.description,
      updatedAt:   updated.updated_at,
    }, 'Team updated successfully');

  } catch (err) { next(err); }
};

// DELETE /api/v1/teams/:teamId — Chairman only
const deleteTeam = async (req, res, next) => {
  try {
    const { teamId } = req.params;

    const deleted = await TeamModel.deleteTeam(teamId);
    if (!deleted) throw NotFoundError('Team not found');

    logger.info('Team deleted', { teamId, deletedBy: req.user.userId });

    return sendSuccess(res, null, 'Team deleted successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// TEAM PLAYER CONTROLLERS
// ─────────────────────────────────────────

// POST /api/v1/teams/:teamId/players — Chairman or Coach
const addPlayersToTeam = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const { positions } = req.body;

    // Confirm team exists
    const team = await TeamModel.getTeamById(teamId);
    if (!team) throw NotFoundError('Team not found');

    // Validate: only one captain and one vice-captain allowed
    const captainCount = positions.filter((p) => p.isCaptain).length;
    const vcCount = positions.filter((p) => p.isViceCaptain).length;
    if (captainCount > 1) throw BadRequestError('Only one captain can be assigned');
    if (vcCount > 1) throw BadRequestError('Only one vice-captain can be assigned');

    const addedCount = await TeamModel.addPlayersToTeam(teamId, positions);

    logger.info('Players added to team', { teamId, count: addedCount, addedBy: req.user.userId });

    return sendSuccess(res, {
      teamId,
      addedPlayers: addedCount,
    }, 'Players added to team successfully');

  } catch (err) { next(err); }
};

// DELETE /api/v1/teams/:teamId/players/:playerId — Chairman or Coach
const removePlayerFromTeam = async (req, res, next) => {
  try {
    const { teamId, playerId } = req.params;

    const removed = await TeamModel.removePlayerFromTeam(teamId, playerId);
    if (!removed) throw NotFoundError('Player not found in this team');

    logger.info('Player removed from team', { teamId, playerId, removedBy: req.user.userId });

    return sendSuccess(res, null, 'Player removed from team');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// SQUAD CONTROLLERS
// ─────────────────────────────────────────

// POST /api/v1/teams/squads — Selector only
const createSquad = async (req, res, next) => {
  try {
    const { name, tournamentName, teamId, players } = req.body;

    // Map request format to model format
    const playerPriorities = players.map((p) => ({
      playerId: p.playerId,
      priority: p.priority || 1,
    }));

    const squad = await TeamModel.createSquad({
      name, tournamentName, teamId,
      selectedBy: req.user.userId,
      playerPriorities,
    });

    logger.info('Squad created', { squadId: squad.id, name, createdBy: req.user.userId });

    return sendCreated(res, {
      squadId:        squad.id,
      name:           squad.name,
      tournamentName: squad.tournament_name,
      status:         squad.status,
      playerCount:    players.length,
    }, 'Squad created successfully');

  } catch (err) { next(err); }
};

// GET /api/v1/teams/squads — all authenticated roles
const listSquads = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status, teamId } = req.query;

    const { squads, total } = await TeamModel.getAllSquads({ status, teamId, limit, offset });

    return sendPaginated(
      res,
      squads.map((s) => ({
        squadId:        s.id,
        name:           s.name,
        tournamentName: s.tournament_name,
        status:         s.status,
        playerCount:    parseInt(s.player_count, 10),
        team: s.team_id ? { teamId: s.team_id, name: s.team_name } : null,
        selectedBy:     s.selected_by_name,
        approvedBy:     s.approved_by_name,
        createdAt:      s.created_at,
      })),
      { page, limit, total }
    );

  } catch (err) { next(err); }
};

// GET /api/v1/teams/squads/:squadId — all authenticated roles
const getSquad = async (req, res, next) => {
  try {
    const { squadId } = req.params;
    const squad = await TeamModel.getSquadById(squadId);
    if (!squad) throw NotFoundError('Squad not found');

    return sendSuccess(res, {
      squadId:         squad.id,
      name:            squad.name,
      tournamentName:  squad.tournament_name,
      status:          squad.status,
      rejectionReason: squad.rejection_reason,
      team: squad.team_id ? { teamId: squad.team_id, name: squad.team_name } : null,
      selectedBy: { userId: squad.selected_by, fullName: squad.selected_by_name },
      approvedBy: squad.approved_by
        ? { userId: squad.approved_by, fullName: squad.approved_by_name }
        : null,
      players: squad.players.map((p) => ({
        playerId:          p.player_id,
        fullName:          p.full_name,
        playerRole:        p.player_role,
        jerseyNumber:      p.jersey_number,
        selectionPriority: p.selection_priority,
        fitnessStatus:     p.fitness_status,
        isAvailable:       p.is_available,
        profileImage:      p.profile_image_url,
      })),
      createdAt: squad.created_at,
    });

  } catch (err) { next(err); }
};

// PUT /api/v1/teams/squads/:squadId/finalize — Selector only
// Moves squad from Draft → Pending_Approval and notifies Chairman
const finalizeSquad = async (req, res, next) => {
  try {
    const { squadId } = req.params;

    // Fetch squad to validate current state
    const squad = await TeamModel.getSquadById(squadId);
    if (!squad) throw NotFoundError('Squad not found');

    // Only the Selector who created this squad can finalize it
    const isOwner = await TeamModel.isSquadOwnedBy(squadId, req.user.userId);
    if (!isOwner) {
      throw ForbiddenError('You can only finalize squads you created');
    }

    // Can only finalize from Draft status
    if (squad.status !== SQUAD_STATUS.DRAFT) {
      throw BadRequestError(
        `Squad cannot be finalized. Current status: ${squad.status}`
      );
    }

    // Must have at least one player
    if (squad.players.length === 0) {
      throw BadRequestError('Squad must have at least one player before finalizing');
    }

    const updated = await TeamModel.updateSquadStatus(squadId, {
      status: SQUAD_STATUS.PENDING_APPROVAL,
    });

    // Publish event → Notification Service will notify Chairman
    await publishEvent(EVENTS.SQUAD_FINALIZED, {
      squadId:   squad.id,
      squadName: squad.name,
      selectedBy: req.user.userId,
      playerCount: squad.players.length,
    }, { userId: req.user.userId, source: 'team-service' });

    logger.info('Squad finalized', { squadId, finalizedBy: req.user.userId });

    return sendSuccess(res, {
      squadId: updated.id,
      status:  updated.status,
    }, 'Squad finalized and sent for approval');

  } catch (err) { next(err); }
};

// PUT /api/v1/teams/squads/:squadId/approve — Chairman only
const approveSquad = async (req, res, next) => {
  try {
    const { squadId } = req.params;
    const { approved, rejectionReason } = req.body;

    const squad = await TeamModel.getSquadById(squadId);
    if (!squad) throw NotFoundError('Squad not found');

    // Can only approve/reject from Pending_Approval status
    if (squad.status !== SQUAD_STATUS.PENDING_APPROVAL) {
      throw BadRequestError(
        `Squad is not pending approval. Current status: ${squad.status}`
      );
    }

    // If rejecting, a reason must be provided
    if (!approved && !rejectionReason) {
      throw BadRequestError('A rejection reason is required when rejecting a squad');
    }

    const newStatus = approved ? SQUAD_STATUS.APPROVED : SQUAD_STATUS.REJECTED;

    const updated = await TeamModel.updateSquadStatus(squadId, {
      status:          newStatus,
      approvedBy:      req.user.userId,
      rejectionReason: approved ? null : rejectionReason,
    });

    // Publish event → Notification Service notifies Selector + players
    const eventType = approved ? EVENTS.SQUAD_APPROVED : EVENTS.SQUAD_REJECTED;
    await publishEvent(eventType, {
      squadId:         squad.id,
      squadName:       squad.name,
      status:          newStatus,
      approvedBy:      req.user.userId,
      selectedBy:      squad.selected_by,
      rejectionReason: rejectionReason || null,
      playerCount:     squad.players.length,
    }, { userId: req.user.userId, source: 'team-service' });

    logger.info('Squad decision made', {
      squadId, decision: newStatus, decidedBy: req.user.userId,
    });

    return sendSuccess(res, {
      squadId: updated.id,
      status:  updated.status,
    }, `Squad ${approved ? 'approved' : 'rejected'} successfully`);

  } catch (err) { next(err); }
};

module.exports = {
  createTeam,
  listTeams,
  getTeam,
  updateTeam,
  deleteTeam,
  addPlayersToTeam,
  removePlayerFromTeam,
  createSquad,
  listSquads,
  getSquad,
  finalizeSquad,
  approveSquad,
};
