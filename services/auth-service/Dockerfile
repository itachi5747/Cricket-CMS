# ─────────────────────────────────────────
# Multi-stage Dockerfile — used by all microservices
# Build args: SERVICE_PORT (default 3001)
# ─────────────────────────────────────────

ARG NODE_VERSION=20-alpine

# ── Stage 1: Base ──
FROM node:${NODE_VERSION} AS base
WORKDIR /app
RUN apk add --no-cache curl

# ── Stage 2: Development (hot reload with nodemon) ──
FROM base AS development
ENV NODE_ENV=development
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE ${SERVICE_PORT:-3001}
CMD ["npm", "run", "dev"]

# ── Stage 3: Builder (install prod deps only) ──
FROM base AS builder
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ── Stage 4: Production ──
FROM node:${NODE_VERSION} AS production
ENV NODE_ENV=production
WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

USER nodejs
EXPOSE ${SERVICE_PORT:-3001}

# Graceful shutdown support
STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
