# ============================================================
# Dockerfile — frontend SPA
# development: vite dev server
# production:  статика через nginx
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
EXPOSE 5173
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev"]

# --- Build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Production (nginx раздаёт статику) ---
FROM nginx:1.27-alpine AS production
RUN apk add --no-cache curl

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]