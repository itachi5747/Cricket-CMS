#!/usr/bin/env node
// ─────────────────────────────────────────
// Health Check Script
// Run: node scripts/health-check.js
// Pings all microservices and infra components
// ─────────────────────────────────────────

const http = require('http');

const SERVICES = [
  { name: 'API Gateway',           url: 'http://localhost:8000/health' },
  { name: 'Auth Service',          url: 'http://localhost:3001/health' },
  { name: 'User Service',          url: 'http://localhost:3002/health' },
  { name: 'Team Service',          url: 'http://localhost:3003/health' },
  { name: 'Match Service',         url: 'http://localhost:3004/health' },
  { name: 'Performance Service',   url: 'http://localhost:3005/health' },
  { name: 'Financial Service',     url: 'http://localhost:3006/health' },
  { name: 'Notification Service',  url: 'http://localhost:3007/health' },
  { name: 'File Service',          url: 'http://localhost:3008/health' },
  { name: 'Attendance Service',    url: 'http://localhost:3009/health' },
];

const checkService = (service) => {
  return new Promise((resolve) => {
    const req = http.get(service.url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const status = res.statusCode === 200 ? '✅ UP' : `⚠️  HTTP ${res.statusCode}`;
        resolve({ name: service.name, status, statusCode: res.statusCode });
      });
    });

    req.on('error', () => {
      resolve({ name: service.name, status: '❌ DOWN', statusCode: 0 });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ name: service.name, status: '⏱️  TIMEOUT', statusCode: 0 });
    });
  });
};

const run = async () => {
  console.log('\n🏏 Cricket CMS — Service Health Check');
  console.log('═'.repeat(50));
  console.log(`Checking at: ${new Date().toLocaleString()}\n`);

  const results = await Promise.all(SERVICES.map(checkService));

  const maxLen = Math.max(...results.map((r) => r.name.length));

  results.forEach(({ name, status }) => {
    console.log(`  ${name.padEnd(maxLen + 2)} ${status}`);
  });

  const upCount = results.filter((r) => r.statusCode === 200).length;
  const total = results.length;

  console.log('\n' + '═'.repeat(50));
  console.log(`  Summary: ${upCount}/${total} services healthy`);

  if (upCount < total) {
    console.log('\n  ⚠️  Some services are not running.');
    console.log('  Run: npm run dev:infra (for infra only)');
    console.log('  Run: npm run dev (for all services)\n');
    process.exit(1);
  } else {
    console.log('\n  🎉 All services are healthy!\n');
  }
};

run().catch((err) => {
  console.error('Health check failed:', err.message);
  process.exit(1);
});
