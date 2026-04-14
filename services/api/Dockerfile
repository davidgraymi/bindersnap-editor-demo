FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/gitea-client ./packages/gitea-client
COPY services/api ./services/api
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim
WORKDIR /app
RUN mkdir -p /var/lib/bindersnap && chown bun:bun /var/lib/bindersnap
COPY --from=builder --chown=bun:bun /app .
USER bun
EXPOSE 8787
CMD ["bun", "services/api/server.ts"]
