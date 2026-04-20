#!/usr/bin/env node
// ─────────────────────────────────────────
// Database Seeder
// Run: node scripts/seed.js
// Creates initial admin user + sample data for development
// ─────────────────────────────────────────

require('dotenv').config({ path: './services/auth-service/.env' });

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SALT_ROUNDS = 12;

const seed = async () => {
  const client = await pool.connect();

  console.log('🏏 Cricket CMS — Database Seeder\n');

  try {
    await client.query('BEGIN');

    // ── 1. Chairman (admin) ──
    const chairmanId = uuidv4();
    const chairmanHash = await bcrypt.hash('Chairman@123!', SALT_ROUNDS);

    await client.query(
      `INSERT INTO users (id, username, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [chairmanId, 'chairman_admin', 'chairman@cricket.com', chairmanHash, 'Chairman']
    );

    await client.query(
      `INSERT INTO profiles (id, user_id, full_name, contact_number)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO NOTHING`,
      [uuidv4(), chairmanId, 'Board Chairman', '+92-300-0000001']
    );
    console.log('  ✅ Chairman: chairman@cricket.com / Chairman@123!');

    // ── 2. Coach ──
    const coachId = uuidv4();
    const coachHash = await bcrypt.hash('Coach@123!', SALT_ROUNDS);

    await client.query(
      `INSERT INTO users (id, username, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [coachId, 'head_coach', 'coach@cricket.com', coachHash, 'Coach']
    );
    await client.query(
      `INSERT INTO profiles (id, user_id, full_name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
      [uuidv4(), coachId, 'Head Coach']
    );
    const coachStaffId = uuidv4();
    await client.query(
      `INSERT INTO staff (id, user_id, staff_type, salary, hire_date, specialization)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO NOTHING`,
      [coachStaffId, coachId, 'Coach', 8000.00, '2024-01-01', 'Head Coach']
    );
    console.log('  ✅ Coach:    coach@cricket.com / Coach@123!');

    // ── 3. Selector ──
    const selectorId = uuidv4();
    const selectorHash = await bcrypt.hash('Selector@123!', SALT_ROUNDS);

    await client.query(
      `INSERT INTO users (id, username, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [selectorId, 'chief_selector', 'selector@cricket.com', selectorHash, 'Selector']
    );
    await client.query(
      `INSERT INTO profiles (id, user_id, full_name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
      [uuidv4(), selectorId, 'Chief Selector']
    );
    await client.query(
      `INSERT INTO staff (id, user_id, staff_type, salary, hire_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO NOTHING`,
      [uuidv4(), selectorId, 'Selector', 6000.00, '2024-01-01']
    );
    console.log('  ✅ Selector: selector@cricket.com / Selector@123!');

    // ── 4. Accountant ──
    const accountantId = uuidv4();
    const accountantHash = await bcrypt.hash('Account@123!', SALT_ROUNDS);

    await client.query(
      `INSERT INTO users (id, username, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [accountantId, 'chief_accountant', 'accountant@cricket.com', accountantHash, 'Accountant']
    );
    await client.query(
      `INSERT INTO profiles (id, user_id, full_name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
      [uuidv4(), accountantId, 'Chief Accountant']
    );
    await client.query(
      `INSERT INTO staff (id, user_id, staff_type, salary, hire_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO NOTHING`,
      [uuidv4(), accountantId, 'Accountant', 5000.00, '2024-01-01']
    );
    console.log('  ✅ Accountant: accountant@cricket.com / Account@123!');

    // ── 5. Sample Players ──
    const playerNames = [
      { name: 'Ahmed Khan',     role: 'Batsman',        jersey: 1  },
      { name: 'Bilal Hassan',   role: 'Bowler',         jersey: 2  },
      { name: 'Kamran Ali',     role: 'All-rounder',    jersey: 3  },
      { name: 'Usman Tariq',    role: 'Wicket-keeper',  jersey: 4  },
      { name: 'Faisal Malik',   role: 'Batsman',        jersey: 5  },
    ];

    for (const p of playerNames) {
      const playerId = uuidv4();
      const playerHash = await bcrypt.hash('Player@123!', SALT_ROUNDS);
      const username = p.name.toLowerCase().replace(' ', '_');

      await client.query(
        `INSERT INTO users (id, username, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [playerId, username, `${username}@cricket.com`, playerHash, 'Player']
      );
      await client.query(
        `INSERT INTO profiles (id, user_id, full_name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
        [uuidv4(), playerId, p.name]
      );
      await client.query(
        `INSERT INTO players (id, user_id, player_role, jersey_number, salary, contract_start_date, contract_end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO NOTHING`,
        [uuidv4(), playerId, p.role, p.jersey, 3500.00, '2025-01-01', '2026-12-31']
      );
      console.log(`  ✅ Player:  ${username}@cricket.com / Player@123!`);
    }

    // ── 6. Initial budget ──
    await client.query(
      `INSERT INTO budgets (id, fiscal_year, total_budget, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [uuidv4(), '2025-2026', 10000000.00, chairmanId]
    ).catch(() => {}); // Ignore if table doesn't exist yet

    await client.query('COMMIT');

    console.log('\n  🎉 Seeding complete!\n');
    console.log('  Quick login credentials:');
    console.log('  ─────────────────────────────────────');
    console.log('  Chairman:   chairman@cricket.com  / Chairman@123!');
    console.log('  Coach:      coach@cricket.com     / Coach@123!');
    console.log('  Selector:   selector@cricket.com  / Selector@123!');
    console.log('  Accountant: accountant@cricket.com / Account@123!');
    console.log('  Players:    ahmed_khan@cricket.com / Player@123!\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n  ❌ Seeding failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

seed().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
