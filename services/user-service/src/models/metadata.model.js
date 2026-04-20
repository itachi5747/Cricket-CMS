const mongoose = require('mongoose');

// ─────────────────────────────────────────
// SCHEMA: user_preferences
// Stores UI/notification preferences per user.
// userId is a string (UUID from PostgreSQL) — not a Mongo ObjectId.
// ─────────────────────────────────────────
const userPreferencesSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    preferences: {
      theme: { type: String, default: 'light', enum: ['light', 'dark'] },
      language: { type: String, default: 'en' },
      notifications: {
        email: { type: Boolean, default: true },
        push:  { type: Boolean, default: true },
        sms:   { type: Boolean, default: false },
        // Per-category toggles
        match:      { type: Boolean, default: true },
        payment:    { type: Boolean, default: true },
        feedback:   { type: Boolean, default: true },
        attendance: { type: Boolean, default: true },
        squad:      { type: Boolean, default: true },
        system:     { type: Boolean, default: false },
      },
      dashboardWidgets: {
        type: [String],
        default: ['matches', 'stats', 'calendar'],
      },
    },
    metadata: {
      lastLogin:  { type: Date },
      loginCount: { type: Number, default: 0 },
      deviceInfo: { type: String },
    },
  },
  { timestamps: true, collection: 'user_preferences' }
);

// ─────────────────────────────────────────
// SCHEMA: player_metadata
// Stores rich biographical/social data for players.
// This data changes infrequently but has a very flexible structure —
// perfect for MongoDB (would be messy to model in PostgreSQL).
// ─────────────────────────────────────────
const playerMetadataSchema = new mongoose.Schema(
  {
    playerId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    biography:    { type: String, default: '' },
    achievements: { type: [String], default: [] },
    socialMedia: {
      twitter:   { type: String },
      instagram: { type: String },
      facebook:  { type: String },
    },
    emergencyContact: {
      name:         { type: String },
      relationship: { type: String },
      phone:        { type: String },
    },
    medicalHistory: [
      {
        condition:      { type: String },
        diagnosedDate:  { type: Date },
        resolvedDate:   { type: Date },
        notes:          { type: String },
      },
    ],
  },
  { timestamps: true, collection: 'player_metadata' }
);

const UserPreferences = mongoose.model('UserPreferences', userPreferencesSchema);
const PlayerMetadata  = mongoose.model('PlayerMetadata',  playerMetadataSchema);

// ─────────────────────────────────────────
// PREFERENCE QUERIES
// ─────────────────────────────────────────

// Get preferences — returns defaults if not set yet
const getPreferences = async (userId) => {
  let prefs = await UserPreferences.findOne({ userId });
  if (!prefs) {
    // Auto-create with defaults on first access
    prefs = await UserPreferences.create({ userId });
  }
  return prefs;
};

// Update preferences — merge with existing (don't overwrite whole document)
const updatePreferences = async (userId, updates) => {
  const prefs = await UserPreferences.findOneAndUpdate(
    { userId },
    { $set: updates },
    { new: true, upsert: true, runValidators: true }
  );
  return prefs;
};

// Update last login metadata
const recordLogin = async (userId, deviceInfo) => {
  await UserPreferences.findOneAndUpdate(
    { userId },
    {
      $set:  { 'metadata.lastLogin': new Date(), 'metadata.deviceInfo': deviceInfo },
      $inc:  { 'metadata.loginCount': 1 },
    },
    { upsert: true }
  );
};

// ─────────────────────────────────────────
// PLAYER METADATA QUERIES
// ─────────────────────────────────────────

// Get player metadata — creates empty doc if first time
const getPlayerMetadata = async (playerId) => {
  let meta = await PlayerMetadata.findOne({ playerId });
  if (!meta) {
    meta = await PlayerMetadata.create({ playerId });
  }
  return meta;
};

// Update player metadata — partial update
const updatePlayerMetadata = async (playerId, updates) => {
  const meta = await PlayerMetadata.findOneAndUpdate(
    { playerId },
    { $set: updates },
    { new: true, upsert: true, runValidators: true }
  );
  return meta;
};

module.exports = {
  // Preferences
  getPreferences,
  updatePreferences,
  recordLogin,
  // Player metadata
  getPlayerMetadata,
  updatePlayerMetadata,
};
