FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

EXPOSE 3000

CMD ["bun", "--hot", "src/index.ts"]
