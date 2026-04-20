const mongoose = require('mongoose');

// ─────────────────────────────────────────
// SCHEMA 1: player_performance
// One document per player per match.
// Stores the raw stats as recorded by the coach right after the match.
// playerId and matchId are UUIDs from PostgreSQL — strings here, not ObjectIds.
// ─────────────────────────────────────────
const playerPerformanceSchema = new mongoose.Schema(
  {
    playerId:  { type: String, required: true, index: true },
    matchId:   { type: String, required: true, index: true },
    matchDate: { type: Date,   required: true },
    matchType: { type: String, enum: ['Test', 'ODI', 'T20', 'Practice'] },
    opponent:  { type: String, required: true },

    batting: {
      runs:         { type: Number, default: 0, min: 0 },
      ballsFaced:   { type: Number, default: 0, min: 0 },
      fours:        { type: Number, default: 0, min: 0 },
      sixes:        { type: Number, default: 0, min: 0 },
      strikeRate:   { type: Number, default: 0 },
      dismissalType:{ type: String }, // 'Caught', 'Bowled', 'LBW', 'Run Out', 'Not Out' etc.
      position:     { type: Number, min: 1, max: 11 },
      didBat:       { type: Boolean, default: true },
    },

    bowling: {
      overs:        { type: Number, default: 0, min: 0 },
      maidens:      { type: Number, default: 0, min: 0 },
      runsConceded: { type: Number, default: 0, min: 0 },
      wickets:      { type: Number, default: 0, min: 0 },
      economyRate:  { type: Number, default: 0 },
      dotBalls:     { type: Number, default: 0, min: 0 },
      didBowl:      { type: Boolean, default: false },
    },

    fielding: {
      catches:   { type: Number, default: 0, min: 0 },
      runOuts:   { type: Number, default: 0, min: 0 },
      stumpings: { type: Number, default: 0, min: 0 },
    },

    playerOfMatch: { type: Boolean, default: false },
    // Coach rating for this performance: 1–10
    rating:        { type: Number, min: 1, max: 10 },
    coachNotes:    { type: String, maxlength: 1000 },
  },
  {
    timestamps: true,
    collection: 'player_performance',
  }
);

// Compound index — ensures each player has only one record per match
playerPerformanceSchema.index({ playerId: 1, matchId: 1 }, { unique: true });
// For date-range queries and recent form calculation
playerPerformanceSchema.index({ playerId: 1, matchDate: -1 });

// ─────────────────────────────────────────
// SCHEMA 2: player_statistics_summary
// One document per player per season.
// This is a COMPUTED document — recalculated every time a new
// performance is recorded. Never manually written by users.
// ─────────────────────────────────────────
const playerStatsSummarySchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true },
    // Season format: "2025-2026"
    season:   { type: String, required: true },

    overall: {
      matchesPlayed:  { type: Number, default: 0 },
      totalRuns:      { type: Number, default: 0 },
      totalWickets:   { type: Number, default: 0 },
      battingAverage: { type: Number, default: 0 },
      bowlingAverage: { type: Number, default: 0 },
      strikeRate:     { type: Number, default: 0 },
      economyRate:    { type: Number, default: 0 },
      catches:        { type: Number, default: 0 },
      playerOfMatchCount: { type: Number, default: 0 },
    },

    // Stats broken down by match format
    formatWise: {
      test: { matchesPlayed: Number, totalRuns: Number, totalWickets: Number, battingAverage: Number },
      odi:  { matchesPlayed: Number, totalRuns: Number, totalWickets: Number, battingAverage: Number },
      t20:  { matchesPlayed: Number, totalRuns: Number, totalWickets: Number, battingAverage: Number },
    },

    // Last 5 matches — used to show recent form trend
    recentForm: {
      last5Matches: [
        {
          matchId:  String,
          date:     Date,
          opponent: String,
          runs:     Number,
          wickets:  Number,
          rating:   Number,
        },
      ],
      // 'Improving', 'Declining', 'Stable' — calculated from last 5 ratings
      trend: { type: String, enum: ['Improving', 'Declining', 'Stable'], default: 'Stable' },
    },

    // Career milestones
    milestones: [
      {
        type:    String, // 'Century', 'Half-Century', 'Five-wicket haul', 'Duck'
        date:    Date,
        matchId: String,
        value:   Number, // the actual run/wicket count that triggered this milestone
      },
    ],
  },
  {
    timestamps: true,
    collection: 'player_statistics_summary',
  }
);

playerStatsSummarySchema.index({ playerId: 1, season: 1 }, { unique: true });

const PlayerPerformance     = mongoose.model('PlayerPerformance',    playerPerformanceSchema);
const PlayerStatsSummary    = mongoose.model('PlayerStatsSummary',   playerStatsSummarySchema);

// ─────────────────────────────────────────
// PERFORMANCE QUERIES
// ─────────────────────────────────────────

// Save a new performance record
const createPerformance = async (data) => {
  // Auto-calculate derived stats before saving
  const perf = { ...data };

  // Strike rate = (runs / balls faced) * 100
  if (perf.batting?.ballsFaced > 0) {
    perf.batting.strikeRate = parseFloat(
      ((perf.batting.runs / perf.batting.ballsFaced) * 100).toFixed(2)
    );
  }

  // Economy rate = runs conceded / overs bowled
  if (perf.bowling?.overs > 0) {
    perf.bowling.economyRate = parseFloat(
      (perf.bowling.runsConceded / perf.bowling.overs).toFixed(2)
    );
    perf.bowling.didBowl = true;
  }

  const performance = await PlayerPerformance.create(perf);
  return performance;
};

// Get performance history for a player — paginated with optional filters
const getPlayerPerformances = async ({ playerId, from, to, matchType, limit, skip }) => {
  const filter = { playerId };
  if (matchType) filter.matchType = matchType;
  if (from || to) {
    filter.matchDate = {};
    if (from) filter.matchDate.$gte = new Date(from);
    if (to)   filter.matchDate.$lte = new Date(to);
  }

  const [performances, total] = await Promise.all([
    PlayerPerformance.find(filter)
      .sort({ matchDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PlayerPerformance.countDocuments(filter),
  ]);

  return { performances, total };
};

// Get all performance records for a specific match
const getMatchPerformances = async (matchId) => {
  return PlayerPerformance.find({ matchId }).sort({ 'batting.runs': -1 }).lean();
};

// Check if a performance already exists for this player+match
const findExistingPerformance = async (playerId, matchId) => {
  return PlayerPerformance.findOne({ playerId, matchId }).lean();
};

// ─────────────────────────────────────────
// STATS SUMMARY QUERIES
// ─────────────────────────────────────────

// Get aggregated stats for a player for a given season
const getPlayerStats = async (playerId, season) => {
  return PlayerStatsSummary.findOne({ playerId, season }).lean();
};

// ─────────────────────────────────────────
// AGGREGATION — Recalculate player stats
// Called after every new performance is recorded.
// Uses MongoDB aggregation pipeline to compute everything from scratch
// (prevents drift from manual corrections).
// ─────────────────────────────────────────
const recalculatePlayerStats = async (playerId, season) => {
  // Determine date range for the season
  // Season "2025-2026" covers July 2025 – June 2026
  const [startYear] = season.split('-').map(Number);
  const seasonStart = new Date(`${startYear}-07-01`);
  const seasonEnd   = new Date(`${startYear + 1}-06-30`);

  // ── Step 1: Aggregate overall stats using MongoDB pipeline ──
  const overallAgg = await PlayerPerformance.aggregate([
    {
      $match: {
        playerId,
        matchDate: { $gte: seasonStart, $lte: seasonEnd },
        matchType: { $ne: 'Practice' }, // exclude practice matches from official stats
      },
    },
    {
      $group: {
        _id: null,
        matchesPlayed:      { $sum: 1 },
        totalRuns:          { $sum: '$batting.runs' },
        totalWickets:       { $sum: '$bowling.wickets' },
        totalBallsFaced:    { $sum: '$batting.ballsFaced' },
        totalOversBowled:   { $sum: '$bowling.overs' },
        totalRunsConceded:  { $sum: '$bowling.runsConceded' },
        totalCatches:       { $sum: '$fielding.catches' },
        playerOfMatchCount: { $sum: { $cond: ['$playerOfMatch', 1, 0] } },
        dismissals:         {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$batting.dismissalType', 'Not Out'] },
                { $ne: ['$batting.dismissalType', null] },
                { $gt:  ['$batting.runs', -1] },
              ]},
              1, 0,
            ],
          },
        },
      },
    },
  ]);

  const overall = overallAgg[0] || {};

  // Batting average = total runs / number of dismissals
  const battingAverage = overall.dismissals > 0
    ? parseFloat((overall.totalRuns / overall.dismissals).toFixed(2))
    : overall.totalRuns || 0;

  // Bowling average = runs conceded / wickets taken
  const bowlingAverage = overall.totalWickets > 0
    ? parseFloat((overall.totalRunsConceded / overall.totalWickets).toFixed(2))
    : 0;

  // Overall strike rate = (total runs / total balls) * 100
  const strikeRate = overall.totalBallsFaced > 0
    ? parseFloat(((overall.totalRuns / overall.totalBallsFaced) * 100).toFixed(2))
    : 0;

  // Economy rate = runs conceded / overs bowled
  const economyRate = overall.totalOversBowled > 0
    ? parseFloat((overall.totalRunsConceded / overall.totalOversBowled).toFixed(2))
    : 0;

  // ── Step 2: Format-wise breakdown ──
  const formatAgg = await PlayerPerformance.aggregate([
    {
      $match: {
        playerId,
        matchDate: { $gte: seasonStart, $lte: seasonEnd },
        matchType: { $in: ['Test', 'ODI', 'T20'] },
      },
    },
    {
      $group: {
        _id:           '$matchType',
        matchesPlayed: { $sum: 1 },
        totalRuns:     { $sum: '$batting.runs' },
        totalWickets:  { $sum: '$bowling.wickets' },
        totalBallsFaced: { $sum: '$batting.ballsFaced' },
        dismissals: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$batting.dismissalType', 'Not Out'] },
                { $ne: ['$batting.dismissalType', null] },
              ]},
              1, 0,
            ],
          },
        },
      },
    },
  ]);

  const formatWise = { test: {}, odi: {}, t20: {} };
  for (const f of formatAgg) {
    const key = f._id.toLowerCase();
    const avg = f.dismissals > 0
      ? parseFloat((f.totalRuns / f.dismissals).toFixed(2))
      : f.totalRuns;
    formatWise[key] = {
      matchesPlayed:  f.matchesPlayed,
      totalRuns:      f.totalRuns,
      totalWickets:   f.totalWickets,
      battingAverage: avg,
    };
  }

  // ── Step 3: Recent form (last 5 matches) ──
  const recentPerfs = await PlayerPerformance.find({ playerId })
    .sort({ matchDate: -1 })
    .limit(5)
    .lean();

  const last5Matches = recentPerfs.map((p) => ({
    matchId:  p.matchId,
    date:     p.matchDate,
    opponent: p.opponent,
    runs:     p.batting?.runs || 0,
    wickets:  p.bowling?.wickets || 0,
    rating:   p.rating || 0,
  }));

  // Trend: compare avg rating of last 2 matches vs previous 3
  let trend = 'Stable';
  if (last5Matches.length >= 4) {
    const recent2Avg = (last5Matches[0].rating + last5Matches[1].rating) / 2;
    const prev3Avg   = (last5Matches[2].rating + last5Matches[3].rating) / 2;
    if (recent2Avg > prev3Avg + 0.5) trend = 'Improving';
    else if (recent2Avg < prev3Avg - 0.5) trend = 'Declining';
  }

  // ── Step 4: Detect milestones in all time performances ──
  const allPerfs = await PlayerPerformance.find({ playerId }).lean();
  const milestones = [];
  for (const p of allPerfs) {
    const runs    = p.batting?.runs    || 0;
    const wickets = p.bowling?.wickets || 0;

    if (runs >= 100) milestones.push({ type: 'Century',         date: p.matchDate, matchId: p.matchId, value: runs });
    else if (runs >= 50) milestones.push({ type: 'Half-Century', date: p.matchDate, matchId: p.matchId, value: runs });
    if (runs === 0 && p.batting?.dismissalType && p.batting.dismissalType !== 'Not Out')
      milestones.push({ type: 'Duck', date: p.matchDate, matchId: p.matchId, value: 0 });
    if (wickets >= 5) milestones.push({ type: 'Five-wicket haul', date: p.matchDate, matchId: p.matchId, value: wickets });
  }

  // ── Step 5: Upsert the summary document ──
  const summary = await PlayerStatsSummary.findOneAndUpdate(
    { playerId, season },
    {
      $set: {
        overall: {
          matchesPlayed:      overall.matchesPlayed      || 0,
          totalRuns:          overall.totalRuns          || 0,
          totalWickets:       overall.totalWickets       || 0,
          battingAverage,
          bowlingAverage,
          strikeRate,
          economyRate,
          catches:            overall.totalCatches       || 0,
          playerOfMatchCount: overall.playerOfMatchCount || 0,
        },
        formatWise,
        recentForm: { last5Matches, trend },
        milestones,
      },
    },
    { new: true, upsert: true }
  );

  return summary;
};

// ─────────────────────────────────────────
// COMPARISON QUERY
// Get stats for multiple players side by side — used by Selector
// ─────────────────────────────────────────
const comparePlayerStats = async (playerIds, season) => {
  return PlayerStatsSummary.find({
    playerId: { $in: playerIds },
    season,
  }).lean();
};

// Helper — determine current season string from a date
const getCurrentSeason = (date = new Date()) => {
  const year  = date.getFullYear();
  const month = date.getMonth() + 1; // 0-indexed
  // Cricket season: July–June. If before July, we're in previous year's season.
  return month >= 7
    ? `${year}-${year + 1}`
    : `${year - 1}-${year}`;
};

module.exports = {
  createPerformance,
  getPlayerPerformances,
  getMatchPerformances,
  findExistingPerformance,
  getPlayerStats,
  recalculatePlayerStats,
  comparePlayerStats,
  getCurrentSeason,
};
