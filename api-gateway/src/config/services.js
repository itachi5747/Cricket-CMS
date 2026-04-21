// ─────────────────────────────────────────
// Service Registry
// All downstream service URLs come from environment
// variables so they work in both local dev (localhost)
// and Docker Compose (container names as hostnames).
//
// In docker-compose.yml the services talk to each other
// by container name, e.g. http://cricket-auth:3001
// In local dev without Docker they use localhost.
// ─────────────────────────────────────────

const SERVICES = {
  auth: {
    name:   'auth-service',
    url:    process.env.AUTH_SERVICE_URL     || 'http://localhost:3001',
    prefix: '/api/v1/auth',
  },
  user: {
    name:   'user-service',
    url:    process.env.USER_SERVICE_URL     || 'http://localhost:3002',
    prefix: '/api/v1/users',
  },
  team: {
    name:   'team-service',
    url:    process.env.TEAM_SERVICE_URL     || 'http://localhost:3003',
    prefix: '/api/v1/teams',
  },
  match: {
    name:   'match-service',
    url:    process.env.MATCH_SERVICE_URL    || 'http://localhost:3004',
    prefix: '/api/v1/matches',
  },
  performance: {
    name:   'performance-service',
    url:    process.env.PERFORMANCE_SERVICE_URL || 'http://localhost:3005',
    prefix: '/api/v1/performance',
  },
  financial: {
    name:   'financial-service',
    url:    process.env.FINANCIAL_SERVICE_URL || 'http://localhost:3006',
    prefix: '/api/v1/financial',
  },
  notification: {
    name:   'notification-service',
    url:    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3007',
    prefix: '/api/v1/notifications',
  },
  file: {
    name:   'file-service',
    url:    process.env.FILE_SERVICE_URL     || 'http://localhost:3008',
    prefix: '/api/v1/files',
  },
  attendance: {
    name:   'attendance-service',
    url:    process.env.ATTENDANCE_SERVICE_URL || 'http://localhost:3009',
    prefix: '/api/v1/attendance',
  },
};

// ─────────────────────────────────────────
// PUBLIC_PATHS
// These routes bypass JWT validation entirely.
// Everything else requires a valid Bearer token.
// ─────────────────────────────────────────
const PUBLIC_PATHS = [
  { method: 'POST', path: '/api/v1/auth/register' },
  { method: 'POST', path: '/api/v1/auth/login' },
  { method: 'POST', path: '/api/v1/auth/refresh' },
  { method: 'POST', path: '/api/v1/auth/forgot-password' },
  { method: 'POST', path: '/api/v1/auth/reset-password' },
];
// const PUBLIC_PATHS = [
//   { method: 'POST', path: '/register' },
//   { method: 'POST', path: '/login' },
//   { method: 'POST', path: '/refresh' },
//   { method: 'POST', path: '/forgot-password' },
//   { method: 'POST', path: '/reset-password' },
// ];
// ─────────────────────────────────────────
// CACHE_CONFIG
// Which GET routes to cache and for how long.
// Only cacheable, read-only data goes here.
// ─────────────────────────────────────────
const CACHE_CONFIG = {
  '/api/v1/teams':        { ttl: 60 },        // 1 minute
  '/api/v1/matches':      { ttl: 30 },        // 30 seconds
  '/api/v1/users/players':{ ttl: 120 },       // 2 minutes
};
const isPublicPath = (method, path) =>
  PUBLIC_PATHS.some(
    (p) => p.method === method && p.path === path
  );
// const isPublicPath = (method, path) =>
//   PUBLIC_PATHS.some(
//     (p) => p.method === method && p.path === path
//   );

module.exports = { SERVICES, PUBLIC_PATHS, CACHE_CONFIG, isPublicPath };
