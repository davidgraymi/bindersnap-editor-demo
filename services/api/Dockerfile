# Pinned to .bun-version by digest; bump together.
FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY services/api ./services/api
# Anything services/api imports at runtime has to be in the image. Keep this
# list and `services/api/image-contents.test.ts` in step: that test fails if an
# import reaches outside what is copied here, because the alternative is the
# API container dying on boot and the integration suite timing out five
# minutes later with nothing to say about why.
COPY packages/utils ./packages/utils
# `validate.ts` imports these schemas as values. Nothing reachable from
# server.ts loads it today, which is the only reason its absence has not
# already killed the container — copy them rather than leave that waiting.
COPY packages/api-schema/schemas ./packages/api-schema/schemas
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288

ENV PORT=8787

WORKDIR /app
RUN mkdir -p /var/lib/bindersnap && chown bun:bun /var/lib/bindersnap
COPY --from=builder --chown=bun:bun /app .
USER bun
EXPOSE 8787
CMD ["bun", "services/api/server.ts"]
