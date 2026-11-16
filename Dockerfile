# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY . .
RUN npm run check

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ARG APP_VERSION=0.9.17
LABEL org.opencontainers.image.title="筑家手记 Web" \
      org.opencontainers.image.description="家庭协作装修管理应用" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 TSX_DISABLE_CACHE=1 \
    DATABASE_URL=/app/data/postgres
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/scripts/migrate-storage.ts ./scripts/migrate-storage.ts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=8s --start-period=60s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "try { const r = await fetch('http://127.0.0.1:3001/api/v1/health', {signal: AbortSignal.timeout(6000)}); process.exit(r.ok ? 0 : 1) } catch { process.exit(1) }"]
CMD ["node", "--import", "tsx", "server/index.ts"]
