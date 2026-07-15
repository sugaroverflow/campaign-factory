# Factory Runtime Worker (ADR 0016). Built from the repo root because the
# worker imports runtime-neutral modules from web/src (contracts, store,
# agents, documents, anthropic client) via tsconfig paths.
FROM node:22-slim

WORKDIR /app

COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --omit=dev

COPY worker/package.json worker/package-lock.json worker/
RUN cd worker && npm ci

COPY web/src web/src
COPY worker/src worker/src
COPY worker/tsconfig.json worker/tsconfig.json
COPY db db

ENV NODE_ENV=production
# Config comes from Railway service variables (no .env files in the image).
CMD ["npm", "--prefix", "worker", "run", "start"]
