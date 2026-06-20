# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Builder — install all deps, generate the Prisma client, compile TypeScript.
# debian-slim (glibc) avoids the musl/openssl binary-target friction Prisma
# hits on Alpine.
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app

# openssl is required by Prisma at `generate` time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps against the lockfile first (better layer caching).
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Generate the Prisma client (native engine for THIS platform) + build.
RUN npx prisma generate
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime — one image that runs any role (api / worker / migrate); the role is
# chosen by the command + PROCESS_ROLE env. Runs as a non-root user.
#
# Note: dev dependencies are intentionally kept so the `migrate` role can run
# `prisma migrate deploy` + the ts-node seed from the same image. For a leaner
# production image, build a separate migration image and `npm prune --omit=dev`
# here.
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nodejs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
# The `migrate` role runs `prisma migrate deploy && prisma db seed`. Prisma 7 reads the SEED
# COMMAND from prisma.config.ts (not package.json), and that command is `ts-node prisma/seed.ts`
# — which needs tsconfig.json. Without these two, `prisma db seed` exits 1 (no seed command /
# ts-node can't compile). They're tiny; copy them so the one-shot migrate+seed actually runs.
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER nodejs
EXPOSE 3000

# Liveness probe baked into the image (overridden/disabled for the worker role).
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

# Default role = API. The worker service overrides this with: node dist/src/worker
CMD ["node", "dist/src/main"]
