const {
  sendSuccess,
  sendCreated,
  sendPaginated,
  NotFoundError,
  BadRequestError,
  ForbiddenError,
  getPaginationParams,
  createLogger,
  ROLES,
  MATCH_STATUS,
  EVENTS,
} = require('@cricket-cms/shared');

const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const MatchModel = require('../models/match.model');

const logger = createLogger('match-controller');

// ─────────────────────────────────────────
// Helper — shapes a match row for API responses
// Keeps response format consistent across all endpoints
// ─────────────────────────────────────────
const formatMatch = (m) => ({
  matchId:       m.id,
  opponentTeam:  m.opponent_team,
  matchDate:     m.match_date,
  matchTime:     m.match_time,
  venue:         m.venue,
  matchType:     m.match_type,
  status:        m.status,
  result:        m.result,
  ourScore:      m.our_score,
  opponentScore: m.opponent_score,
  notes:         m.notes,
  createdBy:     m.created_by_name || m.created_by,
  approvedBy:    m.approved_by_name || null,
  createdAt:     m.created_at,
  updatedAt:     m.updated_at,
});

// ─────────────────────────────────────────
// POST /api/v1/matches — Coach or Chairman
// ─────────────────────────────────────────
const createMatch = async (req, res, next) => {
  try {
    const { opponentTeam, matchDate, matchTime, venue, matchType, notes } = req.body;

    const match = await MatchModel.createMatch({
      opponentTeam, matchDate, matchTime, venue, matchType, notes,
      createdBy: req.user.userId,
    });

    // Notify players a match has been scheduled
    // Performance and Notification services listen for this event
    await publishEvent(EVENTS.MATCH_SCHEDULED, {
      matchId:      match.id,
      opponentTeam: match.opponent_team,
      matchDate:    match.match_date,
      matchTime:    match.match_time,
      venue:        match.venue,
      matchType:    match.match_type,
      scheduledBy:  req.user.userId,
    }, { userId: req.user.userId, source: 'match-service' });

    logger.info('Match scheduled', {
      matchId: match.id, opponentTeam, matchDate, createdBy: req.user.userId,
    });

    return sendCreated(res, formatMatch(match), 'Match scheduled successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/matches — all authenticated roles
// ─────────────────────────────────────────
const listMatches = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status, matchType, from, to } = req.query;

    const { matches, total } = await MatchModel.getAllMatches({
      status, matchType, from, to, limit, offset,
    });

    return sendPaginated(res, matches.map(formatMatch), { page, limit, total });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/matches/:matchId — all roles
// Returns match + its lineup + logistics
// ─────────────────────────────────────────
const getMatch = async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const match = await MatchModel.getMatchById(matchId);
    if (!match) throw NotFoundError('Match not found');

    // Fetch lineup and logistics in parallel for speed
    const [lineup, logistics] = await Promise.all([
      MatchModel.getLineupByMatchId(matchId),
      MatchModel.getLogisticsByMatchId(matchId),
    ]);

    return sendSuccess(res, {
      ...formatMatch(match),
      lineup: lineup.map((p) => ({
        lineupId:         p.lineup_id,
        playerId:         p.player_id,
        fullName:         p.full_name,
        playerRole:       p.player_role,
        jerseyNumber:     p.jersey_number,
        battingOrder:     p.batting_order,
        bowlingOrder:     p.bowling_order,
        fieldingPosition: p.fielding_position,
        profileImage:     p.profile_image_url,
      })),
      logistics: logistics ? {
        travelDetails:      logistics.travel_details,
        accommodation:      logistics.accommodation,
        equipmentChecklist: logistics.equipment_checklist,
        notes:              logistics.notes,
      } : null,
    });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// PUT /api/v1/matches/:matchId — Coach or Chairman
// Can only update while match is Scheduled
// ─────────────────────────────────────────
const updateMatch = async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const existing = await MatchModel.getMatchById(matchId);
    if (!existing) throw NotFoundError('Match not found');

    // Prevent editing a match that has already started or finished
    if (existing.status !== MATCH_STATUS.SCHEDULED) {
      throw BadRequestError(
        `Match cannot be edited. Current status: ${existing.status}`
      );
    }

    const updated = await MatchModel.updateMatch(matchId, req.body);

    logger.info('Match updated', { matchId, updatedBy: req.user.userId });

    return sendSuccess(res, formatMatch(updated), 'Match updated successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// DELETE /api/v1/matches/:matchId — Chairman only
// Only allowed if match is still Scheduled
// Publishes cancellation event
// ─────────────────────────────────────────
const deleteMatch = async (req, res, next) => {
  try {
    const { matchId } = req.params;

    // Get match before deleting so we have data for the event
    const match = await MatchModel.getMatchById(matchId);
    if (!match) throw NotFoundError('Match not found');

    if (match.status !== MATCH_STATUS.SCHEDULED) {
      throw BadRequestError(
        `Only scheduled matches can be cancelled. Current status: ${match.status}`
      );
    }

    // deleteMatch only deletes if status = Scheduled (double safety at DB level)
    const deleted = await MatchModel.deleteMatch(matchId);
    if (!deleted) throw BadRequestError('Match could not be cancelled');

    // Notify players the match is off
    await publishEvent(EVENTS.MATCH_CANCELLED, {
      matchId:      match.id,
      opponentTeam: match.opponent_team,
      matchDate:    match.match_date,
      venue:        match.venue,
      cancelledBy:  req.user.userId,
    }, { userId: req.user.userId, source: 'match-service' });

    logger.info('Match cancelled', { matchId, cancelledBy: req.user.userId });

    return sendSuccess(res, null, 'Match cancelled successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// POST /api/v1/matches/:matchId/lineup — Coach only
// Replaces the entire lineup (not partial update)
// ─────────────────────────────────────────
const setLineup = async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { players } = req.body;

    const match = await MatchModel.getMatchById(matchId);
    if (!match) throw NotFoundError('Match not found');

    // Can set lineup for Scheduled or In_Progress matches only
    if (match.status === MATCH_STATUS.COMPLETED || match.status === MATCH_STATUS.CANCELLED) {
      throw BadRequestError(
        `Cannot set lineup for a ${match.status.toLowerCase()} match`
      );
    }

    // Validate no duplicate batting orders
    const battingOrders = players
      .map((p) => p.battingOrder)
      .filter((o) => o !== null && o !== undefined);
    if (new Set(battingOrders).size !== battingOrders.length) {
      throw BadRequestError('Duplicate batting orders are not allowed');
    }

    // Validate no duplicate bowling orders
    const bowlingOrders = players
      .map((p) => p.bowlingOrder)
      .filter((o) => o !== null && o !== undefined);
    if (new Set(bowlingOrders).size !== bowlingOrders.length) {
      throw BadRequestError('Duplicate bowling orders are not allowed');
    }

    const count = await MatchModel.setLineup(matchId, players);

    logger.info('Lineup set', { matchId, playerCount: count, setBy: req.user.userId });

    return sendSuccess(res, {
      matchId,
      playerCount: count,
    }, 'Match lineup set successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/matches/:matchId/lineup — all roles
// ─────────────────────────────────────────
const getLineup = async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const match = await MatchModel.getMatchById(matchId);
    if (!match) throw NotFoundError('Match not found');

    const lineup = await MatchModel.getLineupByMatchId(matchId);

    return sendSuccess(res, {
      matchId,
      opponentTeam:  match.opponent_team,
      matchDate:     match.match_date,
      players: lineup.map((p) => ({
        lineupId:         p.lineup_id,
        playerId:         p.player_id,
        fullName:         p.full_name,
        playerRole:       p.player_role,
        jerseyNumber:     p.jersey_number,
        battingOrder:     p.batting_order,
        bowlingOrder:     p.bowling_order,
        fieldingPosition: p.fielding_position,
        profileImage:     p.profile_image_url,
      })),
    });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// PUT /api/v1/matches/:matchId/result — Coach only
// Records final score and result
// Publishes match.completed event for downstream services
// ─────────────────────────────────────────
const updateResult = async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { status, result, ourScore, opponentScore } = req.body;

    const match = await MatchModel.getMatchById(matchId);
    if (!match) throw NotFoundError('Match not found');

    // Can't update result of a cancelled match
    if (match.status === MATCH_STATUS.CANCELLED) {
      throw BadRequestError('Cannot update result of a cancelled match');
    }

    // Can't mark a completed match as in-progress again
    if (match.status === MATCH_STATUS.COMPLETED && status === MATCH_STATUS.IN_PROGRESS) {
      throw BadRequestError('Cannot revert a completed match to In_Progress');
    }

    const updated = await MatchModel.updateMatchStatus(matchId, {
      status, result, ourScore, opponentScore,
    });

    // When match completes, trigger downstream updates:
    // → Performance Service: prompt coach to record player stats
    // → Notification Service: notify all players in lineup
    if (status === MATCH_STATUS.COMPLETED) {
      const lineupPlayerIds = await MatchModel.getLineupPlayerIds(matchId);

      await publishEvent(EVENTS.MATCH_COMPLETED, {
        matchId:        match.id,
        opponentTeam:   match.opponent_team,
        matchDate:      match.match_date,
        matchType:      match.match_type,
        result,
        ourScore,
        opponentScore,
        lineupPlayerIds,
        completedBy:    req.user.userId,
      }, { userId: req.user.userId, source: 'match-service' });

      logger.info('Match completed', {
        matchId, result, ourScore, opponentScore, completedBy: req.user.userId,
      });
    }

    return sendSuccess(res, {
      matchId:       updated.id,
      status:        updated.status,
      result:        updated.result,
      ourScore:      updated.our_score,
      opponentScore: updated.opponent_score,
    }, 'Match result updated successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// POST /api/v1/matches/:matchId/logistics — Coach or Chairman
// ─────────────────────────────────────────
const upsertLogistics = async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { travelDetails, accommodation, equipmentChecklist, notes } = req.body;

    const match = await MatchModel.getMatchById(matchId);
    if (!match) throw NotFoundError('Match not found');

    const logistics = await MatchModel.upsertLogistics(matchId, {
      travelDetails, accommodation, equipmentChecklist, notes,
    });

    logger.info('Logistics updated', { matchId, updatedBy: req.user.userId });

    return sendSuccess(res, {
      matchId,
      travelDetails:      logistics.travel_details,
      accommodation:      logistics.accommodation,
      equipmentChecklist: logistics.equipment_checklist,
      notes:              logistics.notes,
    }, 'Logistics updated successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/matches/:matchId/logistics — all roles
// ─────────────────────────────────────────
const getLogistics = async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const match = await MatchModel.getMatchById(matchId);
    if (!match) throw NotFoundError('Match not found');

    const logistics = await MatchModel.getLogisticsByMatchId(matchId);

    return sendSuccess(res, logistics ? {
      matchId,
      travelDetails:      logistics.travel_details,
      accommodation:      logistics.accommodation,
      equipmentChecklist: logistics.equipment_checklist,
      notes:              logistics.notes,
      updatedAt:          logistics.updated_at,
    } : { matchId, message: 'No logistics recorded yet' });

  } catch (err) { next(err); }
};

module.exports = {
  createMatch,
  listMatches,
  getMatch,
  updateMatch,
  deleteMatch,
  setLineup,
  getLineup,
  updateResult,
  upsertLogistics,
  getLogistics,
};
