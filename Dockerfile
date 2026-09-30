# syntax=docker/dockerfile:1
# GODSEYE production image: multi-stage build, Next.js standalone output, non-root runtime,
# no secrets baked in (configure everything at run time with env vars; see .env.example).
#   docker build -t godseye .
#   docker compose up -d        # app behind Caddy (TLS, overwrites X-Forwarded-For)
# Hardening: base image pinned by digest (Renovate/Dependabot bump tag + digest together), uid/gid
# 1001 with no shell login and no package managers at run time, only /data and the Next image cache
# writable, so the container runs with a read-only root filesystem (docker-compose.yml:
# read_only, tmpfs, cap_drop ALL, no-new-privileges).
# node:22-alpine multi-arch index digest, resolved from registry-1.docker.io on 2026-09-30.
ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# ── deps: install exactly what the lockfile says ─────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# corepack reads "packageManager" (pnpm@10.33.0) from package.json.
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── build: `pnpm build` (not `next build`) so the prebuild hook vendors the MapLibre worker ──
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── runtime: standalone server + static assets + public/ (incl. public/maplibre/<version>/) ──
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# System user without a login shell; the server needs no npm/yarn/corepack at run time, so remove
# them (smaller attack surface, fewer CVE reports). /app/.next/cache is the only in-app write path
# (next/image cache); compose mounts a tmpfs there when the root filesystem is read-only.
RUN addgroup -S -g 1001 godseye \
 && adduser -S -D -H -u 1001 -G godseye -h /app -s /sbin/nologin godseye \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir -p /data /app/.next/cache \
 && chown godseye:godseye /data /app/.next/cache
COPY --from=build --chown=godseye:godseye /app/.next/standalone ./
COPY --from=build --chown=godseye:godseye /app/.next/static ./.next/static
COPY --from=build --chown=godseye:godseye /app/public ./public
USER godseye
VOLUME ["/data"]
EXPOSE 3000
STOPSIGNAL SIGTERM
# Liveness only: /api/health answers 200 with status "ok" or "degraded" (per-feed detail inside).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
