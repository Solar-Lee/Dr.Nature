# [P12-02] Medusa backend image (server and worker use the same image). Built on the Mac (arm64,
# same architecture as the VPS), never on the host (CPU near capacity). Build from the repo root:
#   docker build -f infra/backend.Dockerfile -t drn-backend:<git-sha> .
# Dependencies come from pnpm-lock.yaml only (--frozen-lockfile; production deps via
# `pnpm deploy --prod`), never from a fresh `npm install`. No secrets at build time: every
# provider reads its credentials when the container starts (.env on the host, written by Aki).
# Base image pinned by digest (node 22.22.3, alpine 3.22, released 2026-05; CI uses Node 22).

FROM node:22.22.3-alpine3.22@sha256:cd7807368cf24826297cbad5dca1a44972ccfd770647db52a8c7589eb4599ac8 AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm install --frozen-lockfile
COPY apps/backend apps/backend
RUN pnpm --dir apps/backend run build \
 && pnpm --filter @drn/backend deploy --prod /out \
 && cp -R apps/backend/.medusa /out/.medusa

FROM node:22.22.3-alpine3.22@sha256:cd7807368cf24826297cbad5dca1a44972ccfd770647db52a8c7589eb4599ac8
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out /app
USER node
# Medusa runs from the build output; packages resolve from /app/node_modules.
WORKDIR /app/.medusa/server
EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["/app/node_modules/.bin/medusa", "start"]
