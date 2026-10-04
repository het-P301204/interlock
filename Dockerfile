# syntax=docker/dockerfile:1.7
#
# INTERLOCK production image: the API serves the built web app from one origin.
# Node 24 runs the TypeScript sources directly (type stripping), so the server
# has no compile step. Pin the base image by digest in your registry mirror.

ARG NODE_IMAGE=node:24.21.0-alpine3.24

# ---- build: install everything, build the web app ---------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
# The web app bundles the synthetic demo scenarios.
COPY fixtures fixtures
RUN npm run build -w @interlock/web

# ---- runtime: production dependencies only, non-root ------------------------
FROM ${NODE_IMAGE} AS runtime
# HOST=0.0.0.0 lets the published port reach the server, but on its own it would
# turn the Host check off (it defaults to loopback names only for a loopback
# bind). Keep it on, so a web page using DNS rebinding cannot reach a port
# published on the reviewer's machine. Set INTERLOCK_ALLOWED_HOSTS to the
# public name when deploying behind a reverse proxy.
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    INTERLOCK_ALLOWED_HOSTS=127.0.0.1,localhost,[::1] \
    INTERLOCK_DATA_DIR=/data \
    INTERLOCK_WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
# Install production dependencies, then remove the package managers: the server
# never runs npm, and the npm bundled in the base image carries its own
# vulnerable dependencies that image scanners report. Patch OS packages.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && apk upgrade --no-cache
COPY packages/core/src packages/core/src
COPY apps/api/src apps/api/src
COPY apps/cli/src apps/cli/src
# Scenario registry for GET /api/scenarios and the CLI's built-in scenarios (synthetic data only).
COPY fixtures/scenarios.json fixtures/scenarios.json
COPY fixtures/l5x fixtures/l5x
COPY fixtures/manifests fixtures/manifests
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/src/index.ts", "--production"]
