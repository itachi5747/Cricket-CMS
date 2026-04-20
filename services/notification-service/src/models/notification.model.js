const mongoose = require('mongoose');

// ─────────────────────────────────────────
// SCHEMA 1: notifications
// One document per notification sent to a user.
// TTL index auto-deletes old notifications after 30 days
// so the collection doesn't grow unbounded.
// ─────────────────────────────────────────
const notificationSchema = new mongoose.Schema(
  {
    // userId is a UUID string from PostgreSQL — not a Mongo ObjectId
    userId:   { type: String, required: true, index: true },
    type:     {
      type: String,
      enum: ['email', 'in_app', 'push'],
      required: true,
    },
    category: {
      type: String,
      enum: ['match', 'payment', 'feedback', 'system', 'attendance', 'squad', 'performance'],
      required: true,
    },
    title:    { type: String, required: true, maxlength: 200 },
    message:  { type: String, required: true, maxlength: 2000 },
    priority: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium',
    },
    read:     { type: Boolean, default: false, index: true },
    readAt:   { type: Date },

    // Extra context data for deep-linking in the frontend
    data: {
      matchId:     { type: String },
      squadId:     { type: String },
      expenseId:   { type: String },
      paymentId:   { type: String },
      performanceId:{ type: String },
      link:        { type: String },
    },

    // Email-specific fields
    emailSent:    { type: Boolean, default: false },
    emailSentAt:  { type: Date },
    emailError:   { type: String },

    sentAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'notifications',
  }
);

// Compound index for fast "get my unread notifications" queries
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, category: 1 });
// TTL index — MongoDB auto-deletes documents 30 days after sentAt
notificationSchema.index({ sentAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// ─────────────────────────────────────────
// SCHEMA 2: notification_templates
// Reusable message templates so we don't hardcode
// strings in consumers. Placeholders use {{variableName}} syntax.
// ─────────────────────────────────────────
const notificationTemplateSchema = new mongoose.Schema(
  {
    templateName: { type: String, required: true, unique: true },
    templateType: { type: String, enum: ['email', 'in_app', 'both'], default: 'both' },
    category:     { type: String, required: true },
    subject:      { type: String },  // email subject line
    title:        { type: String, required: true },
    body:         { type: String, required: true },
    // List of variable names used in body/subject e.g. ['playerName', 'matchDate']
    variables:    { type: [String], default: [] },
    priority:     { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    isActive:     { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'notification_templates',
  }
);

const Notification         = mongoose.model('Notification',         notificationSchema);
const NotificationTemplate = mongoose.model('NotificationTemplate', notificationTemplateSchema);

// ─────────────────────────────────────────
// NOTIFICATION QUERIES
// ─────────────────────────────────────────

// Create a single notification
const createNotification = async ({
  userId, type, category, title, message,
  priority = 'medium', data = {}, emailSent = false,
}) => {
  return Notification.create({
    userId, type, category, title, message, priority, data, emailSent,
  });
};

// Create notifications for multiple users at once
// Used when a match is scheduled and we need to notify the whole lineup
const createBulkNotifications = async (notifications) => {
  if (!notifications || notifications.length === 0) return [];
  return Notification.insertMany(notifications, { ordered: false });
};

// Get paginated notifications for a user
const getUserNotifications = async ({ userId, read, category, limit, skip }) => {
  const filter = { userId };
  if (read !== undefined) filter.read = read;
  if (category)           filter.category = category;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, read: false }),
  ]);

  return { notifications, total, unreadCount };
};

// Mark one notification as read
const markAsRead = async (notificationId, userId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { $set: { read: true, readAt: new Date() } },
    { new: true }
  );
};

// Mark ALL unread notifications for a user as read
const markAllAsRead = async (userId) => {
  const result = await Notification.updateMany(
    { userId, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
  return result.modifiedCount;
};

// ─────────────────────────────────────────
// TEMPLATE QUERIES
// ─────────────────────────────────────────

// Seed default templates into MongoDB on service startup
const seedTemplates = async () => {
  const templates = [
    {
      templateName: 'match_scheduled',
      category: 'match',
      subject: 'Match Scheduled: {{opponentTeam}} on {{matchDate}}',
      title: 'New Match Scheduled',
      body: 'You have been selected for the match against {{opponentTeam}} on {{matchDate}} at {{venue}}.',
      variables: ['opponentTeam', 'matchDate', 'venue'],
      priority: 'high',
    },
    {
      templateName: 'match_completed',
      category: 'match',
      title: 'Match Result: {{result}} vs {{opponentTeam}}',
      body: 'The match against {{opponentTeam}} has concluded. Result: {{result}}. Score: {{ourScore}} vs {{opponentScore}}.',
      variables: ['opponentTeam', 'result', 'ourScore', 'opponentScore'],
      priority: 'medium',
    },
    {
      templateName: 'match_cancelled',
      category: 'match',
      subject: 'Match Cancelled: {{opponentTeam}} on {{matchDate}}',
      title: 'Match Cancelled',
      body: 'The match against {{opponentTeam}} scheduled for {{matchDate}} has been cancelled.',
      variables: ['opponentTeam', 'matchDate'],
      priority: 'high',
    },
    {
      templateName: 'squad_finalized',
      category: 'squad',
      title: 'Squad Awaiting Approval',
      body: 'The squad "{{squadName}}" has been finalized and is awaiting your approval.',
      variables: ['squadName'],
      priority: 'high',
    },
    {
      templateName: 'squad_approved',
      category: 'squad',
      title: 'Squad Approved: {{squadName}}',
      body: 'Great news! The squad "{{squadName}}" for {{tournamentName}} has been approved.',
      variables: ['squadName', 'tournamentName'],
      priority: 'high',
    },
    {
      templateName: 'squad_rejected',
      category: 'squad',
      title: 'Squad Rejected: {{squadName}}',
      body: 'The squad "{{squadName}}" has been rejected. Reason: {{rejectionReason}}. Please revise and resubmit.',
      variables: ['squadName', 'rejectionReason'],
      priority: 'high',
    },
    {
      templateName: 'salary_paid',
      category: 'payment',
      subject: 'Salary Processed for {{paymentMonth}}',
      title: 'Salary Payment Processed',
      body: 'Your salary of {{currency}}{{amount}} for {{paymentMonth}} has been processed via {{paymentMethod}}.',
      variables: ['amount', 'paymentMonth', 'paymentMethod', 'currency'],
      priority: 'high',
    },
    {
      templateName: 'expense_approved',
      category: 'payment',
      title: 'Expense {{decision}}: {{category}}',
      body: 'Your {{category}} expense of {{currency}}{{amount}} has been {{decision}}.',
      variables: ['category', 'amount', 'decision', 'currency'],
      priority: 'medium',
    },
    {
      templateName: 'performance_recorded',
      category: 'performance',
      title: 'Performance Recorded',
      body: 'Your performance for the match against {{opponent}} has been recorded. Runs: {{runs}}, Wickets: {{wickets}}, Rating: {{rating}}/10.',
      variables: ['opponent', 'runs', 'wickets', 'rating'],
      priority: 'low',
    },
    {
      templateName: 'session_created',
      category: 'attendance',
      title: 'Training Session: {{sessionName}}',
      body: 'A {{sessionType}} training session "{{sessionName}}" has been scheduled for {{sessionDate}} at {{venue}}.',
      variables: ['sessionName', 'sessionType', 'sessionDate', 'venue'],
      priority: 'medium',
    },
  ];

  for (const template of templates) {
    await NotificationTemplate.findOneAndUpdate(
      { templateName: template.templateName },
      { $setOnInsert: template },
      { upsert: true }
    );
  }
};

// Get a template by name
const getTemplate = async (templateName) => {
  return NotificationTemplate.findOne({ templateName, isActive: true }).lean();
};

// Fill template placeholders with actual values
// e.g. "Hello {{playerName}}" + { playerName: "Ahmed" } → "Hello Ahmed"
const fillTemplate = (text, variables = {}) => {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
};

module.exports = {
  createNotification,
  createBulkNotifications,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  seedTemplates,
  getTemplate,
  fillTemplate,
};
