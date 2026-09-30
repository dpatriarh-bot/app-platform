# ============================================================
# Dockerfile — backend API
# Multi-stage: base → deps → development / build → production
# ============================================================

# --- Base ---
FROM node:20-alpine AS base
RUN apk add --no-cache tini curl
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json* ./

# --- Deps ---
FROM base AS deps
RUN npm ci --include=dev

# --- Development ---
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p uploads
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev"]

# --- Build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# --- Production ---
FROM node:20-alpine AS production
RUN apk add --no-cache tini curl
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/src/db/migrations ./dist/db/migrations
COPY --from=build --chown=nodejs:nodejs /app/package.json ./package.json

RUN mkdir -p uploads && chown -R nodejs:nodejs uploads

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]