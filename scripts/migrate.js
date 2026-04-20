#!/usr/bin/env node
// ─────────────────────────────────────────
// Database Migration Runner
// Run: node scripts/migrate.js
// Runs all PostgreSQL migrations in order
// ─────────────────────────────────────────

require('dotenv').config({ path: './services/auth-service/.env' });

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIGRATIONS_DIR = path.join(__dirname, '../infra/postgres/migrations');

const run = async () => {
  const client = await pool.connect();

  try {
    console.log('🏏 Cricket CMS — Database Migrations\n');

    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get already-executed migrations
    const { rows: executed } = await client.query(
      'SELECT filename FROM _migrations ORDER BY id'
    );
    const executedSet = new Set(executed.map((r) => r.filename));

    // Get all migration files sorted
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.log('No migrations directory found at', MIGRATIONS_DIR);
      console.log('Create migrations in infra/postgres/migrations/\n');
      return;
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.\n');
      return;
    }

    let ran = 0;
    for (const file of files) {
      if (executedSet.has(file)) {
        console.log(`  ⏭️  Skipped: ${file} (already executed)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✅ Migrated: ${file}`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ Failed: ${file}`);
        console.error(`     ${err.message}`);
        process.exit(1);
      }
    }

    console.log(`\n  Done. ${ran} migration(s) executed.\n`);
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((err) => {
  console.error('Migration runner error:', err.message);
  process.exit(1);
});
