# syntax=docker/dockerfile:1

# Every stage that RUNs anything executes on the BUILD platform — emulated npm
# SIGILLs under QEMU on node 22's arm64 binary (and was the slow path anyway).
# All output copied into the final image is architecture-independent JS, so
# only the final stage's base layers differ per platform.

# ---------------------------------------------------------------------------
# Build stage: install the full npm workspace (root install — installing
# inside web-administrator/ breaks the @oie/* links) and produce the built
# client (client/dist, vendor bundles, plugin bundles).
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app

# Manifests first so the npm ci layer caches across source-only changes.
COPY package.json package-lock.json ./
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/web-api/package.json packages/web-api/
COPY packages/web-shell/package.json packages/web-shell/
COPY packages/web-ui/package.json packages/web-ui/
COPY web-administrator/package.json web-administrator/
RUN npm ci

COPY packages packages
COPY web-administrator web-administrator
RUN npm run build -w web-administrator

# ---------------------------------------------------------------------------
# Production dependencies, installed once on the build platform. Sound because
# every production dependency is pure JS — if a native prod dep is ever added,
# this stage must go back to running per-architecture.
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS proddeps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/web-api/package.json packages/web-api/
COPY packages/web-shell/package.json packages/web-shell/
COPY packages/web-ui/package.json packages/web-ui/
COPY web-administrator/package.json web-administrator/
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Runtime stage (per-architecture, no RUN steps): production dependencies plus
# the built app. Nothing is baked in — configure from outside the image (see
# web-administrator/server/config.ts):
#   per-setting env vars   OIE_URL, WEBADMIN_PORT, WEBADMIN_TLS_KEY/CERT, ...
#   a mounted document     WEBADMIN_CONFIG=/config/config.json
#   the document inline    WEBADMIN_CONFIG_JSON='{"allowedUrls":[...],"tls":{...}}'
# Use absolute paths for mounted PEM/plugin paths inside the document.
# ---------------------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=proddeps /app /app

# The workspace links in node_modules/@oie point into packages/, so the real
# package sources must be present.
COPY --from=build /app/packages packages
COPY --from=build /app/web-administrator/server web-administrator/server
COPY --from=build /app/web-administrator/client web-administrator/client
COPY --from=build /app/web-administrator/plugins web-administrator/plugins

USER node
EXPOSE 3030

# Plain-HTTP probe; deployments that enable WEBADMIN_TLS_* should override
# the healthcheck (or probe through their TLS terminator).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WEBADMIN_PORT||3030)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "web-administrator/server/index.js"]
