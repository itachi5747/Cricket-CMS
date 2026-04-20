-- ─────────────────────────────────────────
-- PostgreSQL Initialization Script
-- Runs once when container is first created
-- ─────────────────────────────────────────

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create database (already created by POSTGRES_DB env var, but kept for reference)
-- CREATE DATABASE cricket_db;

-- Log
DO $$
BEGIN
  RAISE NOTICE 'Cricket DB initialized with pgcrypto and uuid-ossp extensions';
END $$;
