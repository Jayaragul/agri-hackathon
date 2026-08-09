# syntax=docker/dockerfile:1
#
# Thulir — single-container build for Google Cloud Run.
#
# Three stages:
#   1. frontend-build : npm ci + `npm run build` at the project root -> /app/dist (the Vite SPA)
#   2. server-build    : npm ci + `npm run build` in server/         -> /app/server/dist (compiled JS)
#   3. runtime         : production-only server node_modules + compiled server + built frontend
#
# Runtime layout (must match what server/src/index.ts expects):
#   /app/server/dist/index.js         <- compiled entry point
#   /app/server/node_modules/         <- production deps
#   /app/dist/                        <- built frontend (index.ts resolves it via
#                                        path.resolve(__dirname, "..", "..", "dist") from
#                                        /app/server/dist/index.js, i.e. /app/dist)
#
# See deploy/DEPLOY.md for how this image is built and deployed (gcloud run deploy --source .).

# ---------------------------------------------------------------------------
# Stage 1: build the Vite frontend
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend-build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Do not let the server/ subtree influence the frontend build.
RUN rm -rf server
# Keep the browser on the server proxy in production. This default also makes a
# clean Cloud Build safe; callers can override it with --build-arg when needed.
ARG VITE_AI_TRANSPORT=server
ENV VITE_AI_TRANSPORT=${VITE_AI_TRANSPORT}
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: build the Express server
# ---------------------------------------------------------------------------
FROM node:20-slim AS server-build
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY server/src ./src
COPY server/tsconfig.json ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: runtime image
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Production-only server dependencies.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --legacy-peer-deps

# Compiled server code.
COPY --from=server-build /app/server/dist ./server/dist

# Built frontend — served by the server as ../dist relative to server/dist/index.js, i.e. /app/dist.
COPY --from=frontend-build /app/dist ./dist

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
