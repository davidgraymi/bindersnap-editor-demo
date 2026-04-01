# Alpine-based Bun runtime with pandoc from Alpine packages.
# pandoc/core ships musl binaries which can't load in glibc images,
# so we install pandoc directly from Alpine apk to match the libc.
FROM oven/bun:1-alpine

# hadolint ignore=DL3018
RUN apk add --no-cache pandoc

WORKDIR /app
COPY pandoc-service/package.json ./
COPY pandoc-service/server.ts pandoc-service/transform.ts ./

EXPOSE 3001
ENV PORT=3001

CMD ["bun", "server.ts"]
