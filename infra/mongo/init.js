// ─────────────────────────────────────────
// MongoDB Initialization Script
// Runs once when container is first created
// ─────────────────────────────────────────

db = db.getSiblingDB('cricket_db');

// ── Create collections with validation ──

db.createCollection('notifications', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'type', 'category', 'title', 'message'],
      properties: {
        userId: { bsonType: 'string' },
        type: { enum: ['email', 'in_app', 'push'] },
        category: { enum: ['match', 'payment', 'feedback', 'system', 'attendance', 'squad'] },
        read: { bsonType: 'bool' },
      },
    },
  },
});

db.createCollection('notification_templates');
db.createCollection('user_preferences');
db.createCollection('player_metadata');
db.createCollection('player_performance');
db.createCollection('player_statistics_summary');
db.createCollection('files');
db.createCollection('generated_reports');

// ── Create indexes ──

// Notifications
db.notifications.createIndex({ userId: 1, read: 1 });
db.notifications.createIndex({ userId: 1, createdAt: -1 });
db.notifications.createIndex({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // TTL: 30 days

// User preferences
db.user_preferences.createIndex({ userId: 1 }, { unique: true });

// Player metadata
db.player_metadata.createIndex({ playerId: 1 }, { unique: true });

// Player performance
db.player_performance.createIndex({ playerId: 1, matchDate: -1 });
db.player_performance.createIndex({ matchId: 1 });
db.player_performance.createIndex({ playerId: 1, 'batting.runs': -1 });

// Player stats summary
db.player_statistics_summary.createIndex({ playerId: 1, season: 1 }, { unique: true });

// Files
db.files.createIndex({ uploadedBy: 1 });
db.files.createIndex({ 'relatedTo.entityType': 1, 'relatedTo.entityId': 1 });

// Generated reports
db.generated_reports.createIndex({ generatedBy: 1 });
db.generated_reports.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

print('MongoDB cricket_db initialized with collections and indexes');
