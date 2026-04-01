# Stage 1: pull the pandoc binary
FROM pandoc/core:latest AS pandoc

# Stage 2: Bun runtime + pandoc binary
FROM oven/bun:1

# Copy pandoc binary from the pandoc image
COPY --from=pandoc /usr/bin/pandoc /usr/bin/pandoc

WORKDIR /app
COPY package.json ./
COPY server.ts transform.ts ./

EXPOSE 3001
ENV PORT=3001

CMD ["bun", "server.ts"]
