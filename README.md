# 🏏 Cricket Management System — Backend

A microservice backend built with Node.js, Express, PostgreSQL, MongoDB, RabbitMQ, and Redis.

---

## Architecture

```
┌─────────────────────────────────────────┐
│           API Gateway (:8000)           │
│   Auth · Rate Limiting · Routing        │
└──────────────────┬──────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
┌────────┐  ┌──────────┐  ┌──────────┐
│  Auth  │  │  Users   │  │  Teams   │  ...9 services total
│ :3001  │  │  :3002   │  │  :3003   │
└────────┘  └──────────┘  └──────────┘
                   │
            ┌──────▼──────┐
            │  RabbitMQ   │
            └──────┬──────┘
         ┌─────────┴─────────┐
         ▼                   ▼
   ┌──────────┐        ┌──────────┐
   │PostgreSQL│        │ MongoDB  │
   └──────────┘        └──────────┘
```

## Services

| Service | Port | Database |
|---------|------|----------|
| API Gateway | 8000 | Redis |
| Auth Service | 3001 | PostgreSQL + Redis |
| User Management | 3002 | PostgreSQL + MongoDB |
| Team Management | 3003 | PostgreSQL |
| Match Management | 3004 | PostgreSQL |
| Performance Tracking | 3005 | MongoDB |
| Financial Service | 3006 | PostgreSQL |
| Notification Service | 3007 | MongoDB |
| File Management | 3008 | MongoDB + MinIO |
| Attendance Service | 3009 | PostgreSQL |

## Roles & Permissions

- **Chairman** — Full system access, approvals, staff management
- **Coach** — Match scheduling, lineups, attendance, performance recording
- **Selector** — Squad creation and finalization
- **Player** — Own profile, stats, salary, attendance
- **Accountant** — Financial management, salary processing

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+

### 1. Clone and setup environment files
```bash
# Copy .env.example for each service
cp services/auth-service/.env.example services/auth-service/.env
cp services/user-service/.env.example services/user-service/.env
# ... repeat for all services
cp api-gateway/.env.example api-gateway/.env
```

### 2. Start infrastructure only
```bash
npm run dev:infra
```

This starts: PostgreSQL, MongoDB, Redis, RabbitMQ, MinIO

### 3. Run database migrations
```bash
npm run migrate
```

### 4. Seed development data
```bash
npm run seed
```

### 5. Start all services
```bash
npm run dev
```

### 6. Check health
```bash
npm run health
```

---

## Infrastructure URLs (Development)

| Service | URL | Credentials |
|---------|-----|-------------|
| API Gateway | http://localhost:8000 | — |
| RabbitMQ UI | http://localhost:15672 | admin / admin123 |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin123 |
| PostgreSQL | localhost:5432 | admin / admin123 |
| MongoDB | localhost:27017 | admin / admin123 |
| Redis | localhost:6379 | password: redis123 |

---

## Development Credentials (after seeding)

| Role | Email | Password |
|------|-------|----------|
| Chairman | chairman@cricket.com | Chairman@123! |
| Coach | coach@cricket.com | Coach@123! |
| Selector | selector@cricket.com | Selector@123! |
| Accountant | accountant@cricket.com | Account@123! |
| Player | ahmed_khan@cricket.com | Player@123! |

---

## Project Structure

```
cricket-cms/
├── shared/                    # Shared library (@cricket-cms/shared)
│   └── src/
│       ├── config/            # DB connections, app factory
│       │   ├── createApp.js   # Express app factory + graceful shutdown
│       │   ├── postgres.js    # PostgreSQL pool
│       │   ├── mongodb.js     # Mongoose connection
│       │   ├── redis.js       # Redis client + helpers
│       │   └── rabbitmq.js    # RabbitMQ publisher/consumer
│       ├── constants/         # ROLES, EVENTS, QUEUES, all enums
│       ├── middleware/        # auth, errorHandler, validate, requestLogger
│       ├── utils/             # logger, response helpers, AppError
│       └── validators/        # Reusable Joi schemas
│
├── services/
│   ├── auth-service/          # JWT, login, password reset
│   ├── user-service/          # Profiles, players, staff
│   ├── team-service/          # Teams, squads, approval workflow
│   ├── match-service/         # Scheduling, lineups, results
│   ├── performance-service/   # Stats, analytics, comparisons
│   ├── financial-service/     # Budget, salaries, expenses
│   ├── notification-service/  # Email, in-app, RabbitMQ consumers
│   ├── file-service/          # Uploads, PDF generation, MinIO
│   └── attendance-service/    # Training sessions, attendance
│
├── api-gateway/               # Proxy, auth middleware, rate limiting
├── infra/                     # DB init scripts, RabbitMQ config
├── scripts/                   # migrate.js, seed.js, health-check.js
├── docs/                      # API documentation
├── docker-compose.yml         # Full stack
├── docker-compose.dev.yml     # Dev overrides (hot reload)
└── package.json               # Monorepo root
```

---

## API Endpoints Summary

All routes prefixed with `/api/v1/`

| Prefix | Service |
|--------|---------|
| `/auth/*` | Auth Service |
| `/users/*` | User Management |
| `/teams/*` | Team Management |
| `/matches/*` | Match Management |
| `/performance/*` | Performance Tracking |
| `/financial/*` | Financial Service |
| `/notifications/*` | Notification Service |
| `/files/*` | File Management |
| `/attendance/*` | Attendance Service |

---

## Build Phases

- ✅ **Phase 0** — Monorepo, Docker infra, shared library *(complete)*
- ✅ **Phase 1** — Auth Service
- ✅ **Phase 2** — User Management Service
- ✅ **Phase 3** — Team & Squad Service
- ✅ **Phase 4** — Match Management Service
- ✅ **Phase 5** — Performance Tracking Service
- ✅ **Phase 6** — Financial Service
- ✅ **Phase 7** — Notification Service
- ✅ **Phase 8** — Attendance Service
- ✅ **Phase 9** — File Management Service
- ✅ **Phase 10** — API Gateway
- ✅ **Phase 11** — Hardening & Observability

- ✅ **Run all services** — `npm run dev` from the root directory of the backend. For more info, read `docs/SETUP.md`.

---

## Tech Stack

- **Runtime:** Node.js 20 + Express 4
- **PostgreSQL:** pg (node-postgres) with connection pooling
- **MongoDB:** Mongoose
- **Cache/Blacklist:** Redis (ioredis)
- **Message Queue:** RabbitMQ (amqplib)
- **File Storage:** MinIO / AWS S3
- **Auth:** JWT + bcryptjs
- **Validation:** Joi
- **Logging:** Winston
- **Testing:** Jest + Supertest
- **Containerization:** Docker + Docker Compose

---

## 🧪 Testing

```bash
# Run all tests
npm run test

# Run with coverage report
npm run test:coverage
```

---

## 📝 API Documentation

Once services are running, access:

| Service | URL | Credentials |
|---------|-----|-------------|
| API Gateway | http://localhost:8000 | — |
| RabbitMQ Management | http://localhost:15672 | admin / admin123 |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin123 |

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

Private — All rights reserved

---

## ✅ Project Status

> **Backend completed.**
