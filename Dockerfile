# Minimal bindersnap image server. Do not use in production.

FROM oven/bun:1

WORKDIR /app

ARG APP_PORT=5173
ENV APP_PORT=${APP_PORT}
ENV PORT=${APP_PORT}

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

EXPOSE ${APP_PORT}

CMD ["bun", "--hot", "server.ts"]
