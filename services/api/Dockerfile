# Pinned to .bun-version by digest; bump together.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS builder
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

FROM oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04

ENV PORT=8787

WORKDIR /app
RUN mkdir -p /var/lib/bindersnap && chown bun:bun /var/lib/bindersnap
COPY --from=builder --chown=bun:bun /app .
USER bun
EXPOSE 8787
CMD ["bun", "services/api/server.ts"]
