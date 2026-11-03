# FocusTime: the hosted app's image (A4). Two stages: build the UI with the full toolchain, then run the server on
# Node's own TypeScript support with production dependencies only. No secrets here or in build args: the app reads
# its secrets at run time from Key Vault references (host/azure/secrets.ts) and its data key through Key Vault.
ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
# S1 (D452): which build this is, from the workflow (scripts/build-info.ts): the short sha, the PR number and the build
# time in UTC. Not secret; "unknown" and "none" when built by hand. The env label (dev, prod) comes at run time.
ARG BUILD_SHA=unknown
ARG BUILD_PR=none
ARG BUILD_TIME=
ENV NODE_ENV=production \
    FOCUSTIME_HOST=azure \
    PORT=8080 \
    FOCUSTIME_BUILD_SHA=${BUILD_SHA} \
    FOCUSTIME_BUILD_PR=${BUILD_PR} \
    FOCUSTIME_BUILD_TIME=${BUILD_TIME}
WORKDIR /app
# The source (run as TypeScript) and the built UI from the first stage, then production dependencies only.
COPY --from=build /src ./
RUN npm prune --omit=dev --no-audit --no-fund && npm cache clean --force && rm -rf ui e2e test docs
RUN chown -R root:root /app && chmod -R a-w /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/main.ts", "--no-open"]
