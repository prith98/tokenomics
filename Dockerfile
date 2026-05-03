# ── Stage 1a: build frontend (Vite SPA → dist/public) ────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build
# Output lives at /app/dist/public (vite outDir = ../dist/public)

# ── Stage 1b: compile TypeScript backend ──────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npx tsc

# ── Stage 2: production dependencies (native modules compiled for target arch) ─
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 3: lean runtime image ───────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV SQLITE_PATH=/data/gateway.db

RUN addgroup -S gateway && adduser -S gateway -G gateway \
    && mkdir -p /data && chown gateway:gateway /data

COPY --from=deps     /app/node_modules    ./node_modules
COPY --from=builder  /app/dist/src        ./dist/src
COPY --from=frontend /app/dist/public     ./dist/public
COPY policy.yaml ./
COPY package.json ./

USER gateway

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["node", "dist/src/index.js"]
