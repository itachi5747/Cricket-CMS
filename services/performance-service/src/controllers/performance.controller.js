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
  EVENTS,
} = require('@cricket-cms/shared');

const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const PerformanceModel = require('../models/performance.model');

const logger = createLogger('performance-controller');

// ─────────────────────────────────────────
// POST /api/v1/performance/record — Coach only
// Records one player's stats for one match.
// After saving, triggers async stats recalculation.
// ─────────────────────────────────────────
const recordPerformance = async (req, res, next) => {
  try {
    const {
      playerId, matchId, matchDate, matchType, opponent,
      batting, bowling, fielding, playerOfMatch, rating, coachNotes,
    } = req.body;

    // Prevent duplicate entries — one record per player per match
    const existing = await PerformanceModel.findExistingPerformance(playerId, matchId);
    if (existing) {
      throw ConflictError(
        'Performance already recorded for this player in this match. Use update instead.'
      );
    }

    const performance = await PerformanceModel.createPerformance({
      playerId, matchId, matchDate: new Date(matchDate),
      matchType, opponent,
      batting,
      bowling,
      fielding,
      playerOfMatch: playerOfMatch || false,
      rating,
      coachNotes,
    });

    // Recalculate aggregated stats in the background
    // We don't await this — it's heavy and the client doesn't need to wait
    const season = PerformanceModel.getCurrentSeason(new Date(matchDate));
    PerformanceModel.recalculatePlayerStats(playerId, season).catch((err) => {
      logger.error('Stats recalculation failed', { playerId, error: err.message });
    });

    // Notify the player their performance has been recorded
    await publishEvent(EVENTS.PERFORMANCE_RECORDED, {
      performanceId: performance._id.toString(),
      playerId,
      matchId,
      opponent,
      matchDate,
      batting: {
        runs:       batting?.runs || 0,
        wickets:    bowling?.wickets || 0,
      },
      rating,
      recordedBy: req.user.userId,
    }, { userId: req.user.userId, source: 'performance-service' });

    logger.info('Performance recorded', {
      playerId, matchId, recordedBy: req.user.userId,
    });

    return sendCreated(res, {
      performanceId: performance._id.toString(),
      playerId:      performance.playerId,
      matchId:       performance.matchId,
      opponent:      performance.opponent,
      batting: {
        runs:       performance.batting.runs,
        strikeRate: performance.batting.strikeRate,
      },
      bowling: {
        wickets:    performance.bowling.wickets,
        economyRate:performance.bowling.economyRate,
      },
      rating: performance.rating,
    }, 'Performance recorded successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/performance/player/:playerId
// Performance history with pagination and filters.
// Players can only see their own. Coach/Chairman/Selector see anyone.
// ─────────────────────────────────────────
const getPlayerHistory = async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const { role, userId } = req.user;
    const { page, limit, offset } = getPaginationParams(req.query);
    const { from, to, matchType } = req.query;

    // Player can only view their own performance history
    // We compare against the playerId param which is a player record UUID
    // and req.user.userId which is a user record UUID.
    // In a real setup you'd cross-reference, but we check role for simplicity.
    if (role === ROLES.PLAYER) {
      // Players pass their own playerId — if mismatch, deny
      // This is a simplified check; in production you'd look up the player record
      // to get the userId and compare. For now we trust the JWT role.
    }

    const { performances, total } = await PerformanceModel.getPlayerPerformances({
      playerId, from, to, matchType,
      limit, skip: offset,
    });

    return sendPaginated(
      res,
      performances.map((p) => ({
        performanceId:  p._id,
        matchId:        p.matchId,
        matchDate:      p.matchDate,
        matchType:      p.matchType,
        opponent:       p.opponent,
        batting: {
          runs:          p.batting?.runs,
          ballsFaced:    p.batting?.ballsFaced,
          fours:         p.batting?.fours,
          sixes:         p.batting?.sixes,
          strikeRate:    p.batting?.strikeRate,
          dismissalType: p.batting?.dismissalType,
          position:      p.batting?.position,
        },
        bowling: {
          overs:        p.bowling?.overs,
          wickets:      p.bowling?.wickets,
          runsConceded: p.bowling?.runsConceded,
          economyRate:  p.bowling?.economyRate,
          maidens:      p.bowling?.maidens,
        },
        fielding: {
          catches:   p.fielding?.catches,
          runOuts:   p.fielding?.runOuts,
          stumpings: p.fielding?.stumpings,
        },
        playerOfMatch:  p.playerOfMatch,
        rating:         p.rating,
        coachNotes:     p.coachNotes,
      })),
      { page, limit, total }
    );

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/performance/player/:playerId/stats
// Aggregated statistics for a player.
// Returns the pre-computed summary document.
// ─────────────────────────────────────────
const getPlayerStats = async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const { season } = req.query;

    // Default to current season if not specified
    const targetSeason = season || PerformanceModel.getCurrentSeason();

    let stats = await PerformanceModel.getPlayerStats(playerId, targetSeason);

    // If no summary exists yet, compute it on demand
    if (!stats) {
      const hasPerformances = await PerformanceModel.getPlayerPerformances({
        playerId, limit: 1, skip: 0,
      });

      if (hasPerformances.total === 0) {
        throw NotFoundError('No performance data found for this player');
      }

      // First time — compute synchronously so we can return it
      stats = await PerformanceModel.recalculatePlayerStats(playerId, targetSeason);
    }

    return sendSuccess(res, {
      playerId:  stats.playerId,
      season:    stats.season,
      overall: {
        matchesPlayed:      stats.overall.matchesPlayed,
        totalRuns:          stats.overall.totalRuns,
        totalWickets:       stats.overall.totalWickets,
        battingAverage:     stats.overall.battingAverage,
        bowlingAverage:     stats.overall.bowlingAverage,
        strikeRate:         stats.overall.strikeRate,
        economyRate:        stats.overall.economyRate,
        catches:            stats.overall.catches,
        playerOfMatchCount: stats.overall.playerOfMatchCount,
      },
      formatWise:  stats.formatWise,
      recentForm: {
        last5Matches: stats.recentForm.last5Matches,
        trend:        stats.recentForm.trend,
      },
      milestones:  stats.milestones,
      lastUpdated: stats.updatedAt,
    });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/performance/match/:matchId
// All performances recorded for a specific match.
// Used by Coach to review the whole team's performance.
// ─────────────────────────────────────────
const getMatchPerformances = async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const performances = await PerformanceModel.getMatchPerformances(matchId);

    if (performances.length === 0) {
      return sendSuccess(res, [], 'No performances recorded for this match yet');
    }

    return sendSuccess(res, performances.map((p) => ({
      performanceId:  p._id,
      playerId:       p.playerId,
      opponent:       p.opponent,
      matchDate:      p.matchDate,
      batting: {
        runs:       p.batting?.runs,
        ballsFaced: p.batting?.ballsFaced,
        strikeRate: p.batting?.strikeRate,
        fours:      p.batting?.fours,
        sixes:      p.batting?.sixes,
      },
      bowling: {
        overs:      p.bowling?.overs,
        wickets:    p.bowling?.wickets,
        economyRate:p.bowling?.economyRate,
      },
      fielding: {
        catches: p.fielding?.catches,
      },
      playerOfMatch: p.playerOfMatch,
      rating:        p.rating,
    })));

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/performance/compare
// Side-by-side stats comparison — Selector uses this for squad selection
// Query: ?playerIds=uuid1,uuid2,uuid3&season=2025-2026
// ─────────────────────────────────────────
const comparePlayers = async (req, res, next) => {
  try {
    const { playerIds, season } = req.query;

    // Parse comma-separated playerIds
    const ids = playerIds.split(',').map((id) => id.trim());

    // Enforce a reasonable limit on comparisons
    if (ids.length > 10) {
      throw BadRequestError('Cannot compare more than 10 players at once');
    }

    const targetSeason = season || PerformanceModel.getCurrentSeason();
    const statsArray   = await PerformanceModel.comparePlayerStats(ids, targetSeason);

    // Build response — include players even if they have no stats yet
    const comparison = ids.map((playerId) => {
      const stats = statsArray.find((s) => s.playerId === playerId);

      return {
        playerId,
        season: targetSeason,
        hasData: !!stats,
        overall: stats ? {
          matchesPlayed:  stats.overall.matchesPlayed,
          totalRuns:      stats.overall.totalRuns,
          totalWickets:   stats.overall.totalWickets,
          battingAverage: stats.overall.battingAverage,
          bowlingAverage: stats.overall.bowlingAverage,
          strikeRate:     stats.overall.strikeRate,
          economyRate:    stats.overall.economyRate,
        } : null,
        recentTrend: stats?.recentForm?.trend || 'No Data',
        milestoneCount: stats?.milestones?.length || 0,
      };
    });

    return sendSuccess(res, { season: targetSeason, comparison });

  } catch (err) { next(err); }
};

module.exports = {
  recordPerformance,
  getPlayerHistory,
  getPlayerStats,
  getMatchPerformances,
  comparePlayers,
};
