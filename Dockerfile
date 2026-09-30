# syntax=docker/dockerfile:1
# GODSEYE production image: multi-stage build, Next.js standalone output, non-root runtime,
# no secrets baked in (configure everything at run time with env vars; see .env.example).
#   docker build -t godseye .
#   docker compose up -d        # app behind Caddy (TLS, overwrites X-Forwarded-For)
ARG NODE_IMAGE=node:22-alpine

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
RUN addgroup -S -g 1001 godseye \
 && adduser -S -u 1001 -G godseye -h /app godseye \
 && mkdir -p /data \
 && chown godseye:godseye /data
COPY --from=build --chown=godseye:godseye /app/.next/standalone ./
COPY --from=build --chown=godseye:godseye /app/.next/static ./.next/static
COPY --from=build --chown=godseye:godseye /app/public ./public
USER godseye
EXPOSE 3000
# Liveness only: /api/health answers 200 with status "ok" or "degraded" (per-feed detail inside).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
