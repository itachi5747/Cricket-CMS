# 🏏 Cricket CMS — Local Setup Guide

Complete step-by-step instructions to get the backend running locally.

---

## Prerequisites

Before starting, make sure you have these installed:

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 18 or 20 | `node --version` |
| npm | 9+ | `npm --version` |
| Docker Desktop | Latest | `docker --version` |
| Git | Any | `git --version` |

---

## Step 1 — Clone and Install

```bash
# Clone the repository
git clone <your-repo-url> cricket-cms
cd cricket-cms

# Install all dependencies for all services in one command
# npm workspaces handles this automatically
npm install
```

You should see npm install packages for all 10 services + the shared library simultaneously.

---

## Step 2 — Create Environment Files

Every service needs a `.env` file. We provide `.env.example` templates:

```bash
# Run this block to copy all templates at once
cp services/auth-service/.env.example         services/auth-service/.env
cp services/user-service/.env.example         services/user-service/.env
cp services/team-service/.env.example         services/team-service/.env
cp services/match-service/.env.example        services/match-service/.env
cp services/performance-service/.env.example  services/performance-service/.env
cp services/financial-service/.env.example    services/financial-service/.env
cp services/notification-service/.env.example services/notification-service/.env
cp services/file-service/.env.example         services/file-service/.env
cp services/attendance-service/.env.example   services/attendance-service/.env
cp api-gateway/.env.example                   api-gateway/.env
```

The default values work out of the box for local development. The only thing you might want to change is `JWT_SECRET` — make it something unique.

---

## Step 3 — Validate Environment

```bash
npm run validate
```

This checks every `.env` file and tells you exactly what's missing. All 10 services should show ✅.

---

## Step 4 — Start Infrastructure

```bash
npm run dev:infra
```

This starts 5 Docker containers:
- **PostgreSQL** on port 5432
- **MongoDB** on port 27017
- **Redis** on port 6379
- **RabbitMQ** on port 5672 (management UI: http://localhost:15672)
- **MinIO** on port 9000 (console: http://localhost:9001)

Wait about 30 seconds for all containers to become healthy. Check with:

```bash
docker-compose ps
```

All 5 should show `Up (healthy)`.

---

## Step 5 — Run Migrations

```bash
npm run migrate
```

Creates all PostgreSQL tables in the correct dependency order:
1. `users`, `refresh_tokens`, `password_reset_tokens` (auth-service)
2. `profiles`, `staff`, `players` (user-service)
3. `teams`, `team_players`, `squads`, `squad_players` (team-service)
4. `matches`, `match_lineups`, `match_logistics` (match-service)
5. `budgets`, `sponsorships`, `salary_payments`, `expenses`, `transactions` (financial-service)
6. `training_sessions`, `attendance_records`, `attendance_summary` (attendance-service)

MongoDB collections are created automatically when services first start.

---

## Step 6 — Seed Test Data

```bash
npm run seed
```

Creates:
- 1 Chairman, 1 Coach, 1 Selector, 1 Accountant
- 5 Players with different roles and jersey numbers
- 1 Team with all 5 players (first player is captain)
- 1 Scheduled match (vs Australia, 30 days from now)
- 1 Training session (3 days from now)
- 1 Budget ($10,000,000 for current fiscal year)

---

## Step 7 — Start the Services

**Option A — Start everything at once:**
```bash
npm run dev
```

This starts all 9 services + the gateway in the correct order, waiting for each to become healthy before starting the next.

**Option B — Start services individually** (easier for debugging):
```bash
# Open separate terminal tabs for each service
cd services/auth-service && npm run dev         # Tab 1
cd services/user-service && npm run dev         # Tab 2
cd services/team-service && npm run dev         # Tab 3
cd services/match-service && npm run dev        # Tab 4
cd services/performance-service && npm run dev  # Tab 5
cd services/financial-service && npm run dev    # Tab 6
cd services/notification-service && npm run dev # Tab 7
cd services/file-service && npm run dev         # Tab 8
cd services/attendance-service && npm run dev   # Tab 9
cd api-gateway && npm run dev                   # Tab 10
```

---

## Step 8 — Verify Everything Works

```bash
# Check the gateway is up
curl http://localhost:8000/health

# Check all services are healthy
curl http://localhost:8000/health/services

# Quick smoke test — try to login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"chairman@cricket.com","password":"Chairman@123!"}'
```

---

## Infrastructure Management

| Command | What it does |
|---------|-------------|
| `npm run dev:infra` | Start all Docker containers |
| `npm run dev:down` | Stop containers (keep data) |
| `npm run dev:clean` | Stop containers AND delete all data (fresh start) |
| `docker-compose logs postgres` | View PostgreSQL logs |
| `docker-compose logs rabbitmq` | View RabbitMQ logs |

---

## Useful URLs

| Service | URL | Credentials |
|---------|-----|-------------|
| API Gateway | http://localhost:8000 | — |
| RabbitMQ UI | http://localhost:15672 | admin / admin123 |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin123 |

---

## Test Credentials (after seeding)

| Role | Email | Password |
|------|-------|----------|
| Chairman | chairman@cricket.com | Chairman@123! |
| Coach | coach@cricket.com | Coach@123! |
| Selector | selector@cricket.com | Selector@123! |
| Accountant | accountant@cricket.com | Account@123! |
| Player | ahmed@cricket.com | Player@123! |

---

## Running Tests

```bash
# Run all tests
npm test

# Run tests for a specific service
npm run test:auth
npm run test:match
npm run test:gateway

# Run with coverage report
npm run test:coverage
```

---

## Common Problems

**`ECONNREFUSED 127.0.0.1:5432`**
PostgreSQL isn't running. Run `npm run dev:infra` first.

**`Cannot find module '@cricket-cms/shared'`**
Run `npm install` from the project root (not inside a service folder).

**`Port already in use`**
Another process is using that port. Find and kill it:
```bash
lsof -ti:3001 | xargs kill   # kills whatever is on port 3001
```

**`Migration failed: relation "users" does not exist`**
You ran a service migration before auth-service migration. Always use `npm run migrate` which runs them in the correct order.

**RabbitMQ consumers not receiving events**
Check the RabbitMQ Management UI at http://localhost:15672 → Queues tab. All queues should be listed. If not, restart the notification service — it creates the queues on startup.
