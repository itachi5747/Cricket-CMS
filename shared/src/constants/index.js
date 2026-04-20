// ─────────────────────────────────────────
// ROLES
// ─────────────────────────────────────────
const ROLES = {
  CHAIRMAN: 'Chairman',
  COACH: 'Coach',
  SELECTOR: 'Selector',
  PLAYER: 'Player',
  ACCOUNTANT: 'Accountant',
};

const ALL_ROLES = Object.values(ROLES);

// ─────────────────────────────────────────
// PLAYER ROLES
// ─────────────────────────────────────────
const PLAYER_ROLES = {
  BATSMAN: 'Batsman',
  BOWLER: 'Bowler',
  ALL_ROUNDER: 'All-rounder',
  WICKET_KEEPER: 'Wicket-keeper',
};

// ─────────────────────────────────────────
// STAFF TYPES
// ─────────────────────────────────────────
const STAFF_TYPES = {
  COACH: 'Coach',
  SELECTOR: 'Selector',
  ACCOUNTANT: 'Accountant',
};

// ─────────────────────────────────────────
// MATCH
// ─────────────────────────────────────────
const MATCH_TYPES = {
  TEST: 'Test',
  ODI: 'ODI',
  T20: 'T20',
  PRACTICE: 'Practice',
};

const MATCH_STATUS = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In_Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const MATCH_RESULTS = {
  WIN: 'Win',
  LOSS: 'Loss',
  TIE: 'Tie',
  NO_RESULT: 'No_Result',
};

// ─────────────────────────────────────────
// SQUAD
// ─────────────────────────────────────────
const SQUAD_STATUS = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending_Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

// ─────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────
const ATTENDANCE_STATUS = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
};

const SESSION_TYPES = {
  BATTING: 'Batting',
  BOWLING: 'Bowling',
  FIELDING: 'Fielding',
  FITNESS: 'Fitness',
};

// ─────────────────────────────────────────
// FINANCIAL
// ─────────────────────────────────────────
const PAYMENT_STATUS = {
  PENDING: 'Pending',
  PROCESSED: 'Processed',
  FAILED: 'Failed',
};

const EXPENSE_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const SPONSORSHIP_STATUS = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  TERMINATED: 'Terminated',
};

const TRANSACTION_TYPES = {
  INCOME: 'Income',
  EXPENSE: 'Expense',
  TRANSFER: 'Transfer',
};

// ─────────────────────────────────────────
// FITNESS STATUS
// ─────────────────────────────────────────
const FITNESS_STATUS = {
  FIT: 'Fit',
  INJURED: 'Injured',
  RECOVERING: 'Recovering',
  SUSPENDED: 'Suspended',
};

// ─────────────────────────────────────────
// NOTIFICATION
// ─────────────────────────────────────────
const NOTIFICATION_TYPES = {
  EMAIL: 'email',
  IN_APP: 'in_app',
  PUSH: 'push',
};

const NOTIFICATION_CATEGORIES = {
  MATCH: 'match',
  PAYMENT: 'payment',
  FEEDBACK: 'feedback',
  SYSTEM: 'system',
  ATTENDANCE: 'attendance',
  SQUAD: 'squad',
};

const NOTIFICATION_PRIORITY = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

// ─────────────────────────────────────────
// FILE
// ─────────────────────────────────────────
const FILE_TYPES = {
  DOCUMENT: 'document',
  IMAGE: 'image',
  REPORT: 'report',
};

const REPORT_TYPES = {
  FINANCIAL: 'financial',
  PERFORMANCE: 'performance',
  ATTENDANCE: 'attendance',
};

const REPORT_STATUS = {
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// ─────────────────────────────────────────
// RABBITMQ EVENTS
// ─────────────────────────────────────────
const EVENTS = {
  // User events
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',

  // Match events
  MATCH_SCHEDULED: 'match.scheduled',
  MATCH_COMPLETED: 'match.completed',
  MATCH_CANCELLED: 'match.cancelled',

  // Squad events
  SQUAD_FINALIZED: 'squad.finalized',
  SQUAD_APPROVED: 'squad.approved',
  SQUAD_REJECTED: 'squad.rejected',

  // Performance events
  PERFORMANCE_RECORDED: 'performance.recorded',
  STATS_UPDATED: 'stats.updated',

  // Financial events
  SALARY_PAID: 'salary.paid',
  EXPENSE_APPROVED: 'expense.approved',
  SPONSORSHIP_ADDED: 'sponsorship.added',

  // Attendance events
  SESSION_CREATED: 'session.created',

  // File events
  REPORT_GENERATED: 'report.generated',
};

// ─────────────────────────────────────────
// RABBITMQ EXCHANGES & QUEUES
// ─────────────────────────────────────────
const EXCHANGES = {
  MAIN_TOPIC: 'main.topic',
  NOTIFICATIONS_FANOUT: 'notifications.fanout',
  DEAD_LETTER: 'dead.letter',
};

const QUEUES = {
  USER_EVENTS: 'user.events',
  MATCH_EVENTS: 'match.events',
  PERFORMANCE_EVENTS: 'performance.events',
  FINANCIAL_EVENTS: 'financial.events',
  SQUAD_EVENTS: 'squad.events',
  ATTENDANCE_EVENTS: 'attendance.events',
  NOTIFICATIONS_ALL: 'notifications.all',
  DEAD_LETTER: 'dead.letter.queue',
};

// ─────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────
const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 10,
  MAX_LIMIT: 100,
};

// ─────────────────────────────────────────
// TOKEN
// ─────────────────────────────────────────
const TOKEN = {
  ACCESS_EXPIRY: '15m',
  REFRESH_EXPIRY: '7d',
  RESET_EXPIRY: '1h',
  RESET_TOKEN_TTL_SECONDS: 3600,
};

module.exports = {
  ROLES,
  ALL_ROLES,
  PLAYER_ROLES,
  STAFF_TYPES,
  MATCH_TYPES,
  MATCH_STATUS,
  MATCH_RESULTS,
  SQUAD_STATUS,
  ATTENDANCE_STATUS,
  SESSION_TYPES,
  PAYMENT_STATUS,
  EXPENSE_STATUS,
  SPONSORSHIP_STATUS,
  TRANSACTION_TYPES,
  FITNESS_STATUS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITY,
  FILE_TYPES,
  REPORT_TYPES,
  REPORT_STATUS,
  EVENTS,
  EXCHANGES,
  QUEUES,
  PAGINATION_DEFAULTS,
  TOKEN,
};
