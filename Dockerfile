# DiziVAT R5 — one container, two processes:
#   Next.js (standalone) on $PORT  ──/api/v1/* rewrite──▶  NestJS API on 127.0.0.1:4000  ──▶  PostgreSQL (DATABASE_URL, e.g. Neon)
# Build:  docker build -t dizivat .      Run:  docker run -p 10000:10000 -e DATABASE_URL=… -e SESSION_SECRET=… dizivat

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY api/package.json api/package-lock.json api/
RUN npm --prefix api ci --no-audit --no-fund

FROM deps AS build
COPY . .
# API_UPSTREAM is compiled into the route manifest (rewrites), so it is fixed here: the API runs in the same container.
# Types/lint are checked in CI; the image build skips next build's type-check worker to fit small build machines.
ENV NEXT_TELEMETRY_DISABLED=1 API_UPSTREAM=http://127.0.0.1:4000 STANDALONE=1 LOW_MEM_BUILD=1 SKIP_BUILD_TYPECHECK=1 \
    NODE_OPTIONS=--max-old-space-size=1536
ARG NEXT_PUBLIC_LEGACY_URL=
ENV NEXT_PUBLIC_LEGACY_URL=$NEXT_PUBLIC_LEGACY_URL
RUN npx next build \
 && npm --prefix api run build \
 && npm --prefix api prune --omit=dev

FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=10000 \
    API_UPSTREAM=http://127.0.0.1:4000 API_HOST=127.0.0.1 API_PORT=4000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/api/package.json ./api/package.json
COPY --from=build --chown=node:node /app/api/node_modules ./api/node_modules
COPY --from=build --chown=node:node /app/api/dist ./api/dist
COPY --from=build --chown=node:node /app/api/drizzle ./api/drizzle
COPY --chown=node:node docker/start.sh ./start.sh
# Commit of this build, reported by /api/v1/health (the deploy pipeline checks it). CI passes GIT_COMMIT; on Render
# the runtime variable RENDER_GIT_COMMIT takes precedence. Declared last so it never invalidates the cached layers.
ARG GIT_COMMIT=
ENV GIT_COMMIT=$GIT_COMMIT
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bash", "./start.sh"]
