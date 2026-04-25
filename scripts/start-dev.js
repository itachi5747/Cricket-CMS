#!/usr/bin/env node
// ─────────────────────────────────────────
// Development Startup Orchestrator
// Run: node scripts/start-dev.js
//
// Starts all 9 services + the API gateway in the
// correct order, with health-check waiting between
// dependent services.
//
// Boot order:
//   1. auth-service      (others need JWT_SECRET but no direct dependency)
//   2. user-service      (team/match need players/staff tables)
//   3. team-service
//   4. match-service
//   5. performance-service
//   6. financial-service
//   7. notification-service
//   8. file-service
//   9. attendance-service
//  10. api-gateway        (starts last — proxies to all others)
// ─────────────────────────────────────────

const { spawn } = require('child_process');
const http      = require('http');
const path      = require('path');

const SERVICES = [
  { name: 'auth-service',         dir: 'services/auth-service',         port: 3001, color: '\x1b[33m' },
  { name: 'user-service',         dir: 'services/user-service',         port: 3002, color: '\x1b[36m' },
  { name: 'team-service',         dir: 'services/team-service',         port: 3003, color: '\x1b[35m' },
  { name: 'match-service',        dir: 'services/match-service',        port: 3004, color: '\x1b[32m' },
  { name: 'performance-service',  dir: 'services/performance-service',  port: 3005, color: '\x1b[34m' },
  { name: 'financial-service',    dir: 'services/financial-service',    port: 3006, color: '\x1b[31m' },
  { name: 'notification-service', dir: 'services/notification-service', port: 3007, color: '\x1b[37m' },
  { name: 'file-service',         dir: 'services/file-service',         port: 3008, color: '\x1b[33m' },
  { name: 'attendance-service',   dir: 'services/attendance-service',   port: 3009, color: '\x1b[36m' },
  { name: 'api-gateway',          dir: 'api-gateway',                   port: 8000, color: '\x1b[32m' },
];

const RESET = '\x1b[0m';

// ─────────────────────────────────────────
// waitForHealth
// Polls a service's /health endpoint until it responds
// with 200 or the timeout is reached.
// ─────────────────────────────────────────
const waitForHealth = (port, serviceName, timeoutMs = 30000) => {
  return new Promise((resolve, reject) => {
    const start    = Date.now();
    const interval = setInterval(() => {
      const req = http.get(
        { hostname: 'localhost', port, path: '/health', timeout: 2000 },
        (res) => {
          if (res.statusCode === 200) {
            clearInterval(interval);
            resolve();
          }
        }
      );
      req.on('error', () => {}); // expected while service is starting
      req.on('timeout', () => req.destroy());

      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`${serviceName} did not become healthy within ${timeoutMs / 1000}s`));
      }
    }, 500);
  });
};

// ─────────────────────────────────────────
// startService
// Spawns a service process and prefixes its stdout/stderr
// with the service name in color.
// ─────────────────────────────────────────
const startService = (service) => {
  return new Promise((resolve, reject) => {
    const cwd  = path.resolve(service.dir);
    const proc = spawn('npm', ['run', 'dev'], {
      cwd,
      env:   { ...process.env, PORT: String(service.port) },
      shell: true,
    });

    const prefix = `${service.color}[${service.name}]${RESET}`;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line) => console.log(`${prefix} ${line}`));
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line) => console.error(`${prefix} ${line}`));
    });

    proc.on('error', (err) => {
      console.error(`${prefix} Failed to start: ${err.message}`);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`${prefix} Exited with code ${code}`);
      }
    });

    // Resolve once the process has started (not necessarily healthy yet)
    setTimeout(() => resolve(proc), 500);
  });
};

// ─────────────────────────────────────────
// Main
// ─────────────────────────────────────────
const run = async () => {
  console.log('\n🏏 Cricket CMS — Development Startup');
  console.log('═'.repeat(50));
  console.log('Starting all services...\n');
  console.log('Tip: Make sure infra is running first:');
  console.log('  npm run dev:infra\n');
  console.log('═'.repeat(50));
  console.log();

  const processes = [];

  // Handle graceful shutdown of all child processes
  const shutdown = () => {
    console.log('\n\nShutting down all services...');
    processes.forEach((p) => p.kill('SIGTERM'));
    setTimeout(() => process.exit(0), 3000);
  };

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  for (const service of SERVICES) {
    process.stdout.write(`Starting ${service.name} (port ${service.port})... `);

    try {
      const proc = await startService(service);
      processes.push(proc);

      // Wait for health check before starting next service
      // Gateway waits longest since all services must be up first
      const timeout = service.name === 'api-gateway' ? 60000 : 30000;
      await waitForHealth(service.port, service.name, timeout);

      console.log(`✅ healthy`);
    } catch (err) {
      console.log(`⚠️  ${err.message} (continuing anyway)`);
    }
  }

  console.log();
  console.log('═'.repeat(50));
  console.log('\n  🎉 All services started!\n');
  console.log('  API Gateway: http://localhost:8000');
  console.log('  Health:      http://localhost:8000/health');
  console.log('  All services: http://localhost:8000/health/services\n');
  console.log('  Press Ctrl+C to stop all services.\n');
};

run().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
