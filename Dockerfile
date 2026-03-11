# syntax=docker/dockerfile:1

# ──────────────────────────────────────────────
# Stage 1: builder — compile TypeScript sources
# ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig*.json ./
COPY src/ ./src/
RUN npm run build

# ──────────────────────────────────────────────
# Stage 2: runner — minimal production image
# ──────────────────────────────────────────────
FROM node:20-alpine AS runner

LABEL org.opencontainers.image.source="https://github.com/rankgnar/agent-watch"
LABEL org.opencontainers.image.description="Observability SDK for AI agents — self-hosted dashboard"
LABEL org.opencontainers.image.licenses="MIT"

# Install only production dependencies
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /build/dist ./dist

# Default data directory for SQLite persistence
RUN mkdir -p /data && chown node:node /data

# Dashboard port
EXPOSE 4200

# Run as non-root user
USER node

# Store SQLite database in /data (mount a volume here)
ENV AGENT_WATCH_DB_PATH=/data/agent-watch.db
ENV AGENT_WATCH_PORT=4200

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["serve"]
