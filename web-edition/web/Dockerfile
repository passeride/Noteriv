# Build context must be the repo root: the app is an npm workspace (root package.json /
# package-lock.json) and imports shared code from packages/. Secrets are never baked into
# the image; they come from Dokploy's env injection at deploy time.
#
# Only `web` and the shared packages are installed here (`-w web`), not desktop's Tauri tooling.
# workspace manifest.

FROM node:22-alpine AS deps
WORKDIR /app
# The VPS's route to the npm registry drops connections now and then (ECONNRESET twice during
# deploys on 2026-10-15). Let npm retry instead of failing the whole build.
ENV NPM_CONFIG_FETCH_RETRIES=6 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=60000 \
    NPM_CONFIG_FETCH_TIMEOUT=120000
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/plugin-api/package.json packages/plugin-api/
COPY packages/plugins/package.json packages/plugins/
# -w @noteriv/ui as well: its own dependencies (mermaid, katex) are not web dependencies any more.
RUN npm install -w web -w @noteriv/ui --include-workspace-root --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
# Hoisted packages (root) and the few this app and the UI package resolve differently (web/node_modules, packages/ui/node_modules).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
# @noteriv/ui depends on katex 0.19 while the hoisted copy is 0.16 (mermaid needs that one), so npm nests it here.
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY web ./web
WORKDIR /app/web
# Both of these must be build args, not plain Dokploy runtime env vars:
# NEXT_PUBLIC_* is inlined into the client bundle, and next.config.ts's
# rewrites() destination gets resolved once into routes-manifest.json at
# `next build` time (not re-read per request in standalone/production mode,
# confirmed by a real failed proxy call during deploy testing) — setting
# NOTERIV_API_ORIGIN only at `docker run` time silently falls back to its
# http://127.0.0.1:4001 default and the frontend can't reach the backend.
ARG NEXT_PUBLIC_COLLAB_WS_URL
ARG NOTERIV_API_ORIGIN
ENV NEXT_PUBLIC_COLLAB_WS_URL=${NEXT_PUBLIC_COLLAB_WS_URL}
ENV NOTERIV_API_ORIGIN=${NOTERIV_API_ORIGIN}
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# next.config.ts sets outputFileTracingRoot to the repo root, so the standalone output nests the
# app under web/ (web/server.js) next to the hoisted node_modules.
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/public ./web/public
COPY --from=builder /app/web/.next/static ./web/.next/static

EXPOSE 3000
CMD ["node", "web/server.js"]
