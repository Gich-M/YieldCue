# syntax=docker/dockerfile:1
# YieldCue self-hosted client. One runnable image, no operator build step.
# Build context is apps/self-hosted/ (the client subtree with vendored packages).

FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first for layer caching.
# vendor/ holds the vendored contracts/domain/notifications workspaces.
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev

# Application source, migrations, and static assets.
COPY src ./src
COPY migrations ./migrations
COPY public ./public

ENV YIELDCUE_DATA_DIR=/data \
    YIELDCUE_BIND=127.0.0.1 \
    YIELDCUE_PORT=8080

EXPOSE 8080
VOLUME ["/data"]

CMD ["node", "--import", "tsx", "src/index.ts"]
