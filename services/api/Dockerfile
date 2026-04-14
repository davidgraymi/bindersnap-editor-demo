FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim

WORKDIR /app

RUN mkdir -p /var/lib/bindersnap && chown bun:bun /var/lib/bindersnap

COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun services/api ./services/api
COPY --chown=bun:bun packages/gitea-client ./packages/gitea-client

USER bun

EXPOSE 8787

CMD ["bun", "services/api/server.ts"]
