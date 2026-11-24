# Build context must be web/server/. One image serves all three backend
# processes (API, sync-worker, collab-server) — docker-compose.prod.yml
# overrides `command` per service rather than building three images.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Prisma's query engine on Alpine needs openssl present at runtime. The sync engine and
# note history shell out to the `git` binary (lib/gitSync.ts, lib/noteHistory.ts), and git
# over HTTPS needs the CA bundle; without git every sync fails with "spawn git ENOENT".
RUN apk add --no-cache openssl git ca-certificates

# Claude Code CLI for the owner-only AI relay (routes/ai.ts). Alpine needs libgcc, libstdc++ and the system ripgrep.
# Its login lives in CLAUDE_CONFIG_DIR, which compose mounts as a volume so it survives rebuilds.
RUN apk add --no-cache libgcc libstdc++ ripgrep \
 && npm install -g @anthropic-ai/claude-code \
 && mkdir -p /claude-config && chown node:node /claude-config
ENV USE_BUILTIN_RIPGREP=0 CLAUDE_CONFIG_DIR=/claude-config

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Run as unprivileged node user (non-root)
USER node

CMD ["node", "dist/index.js"]
