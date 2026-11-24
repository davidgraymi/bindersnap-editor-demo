# Pinned to .bun-version by digest; bump together.
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS builder
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
# The images this commit deploys, which the admin console's System page lists
# (services/api/admin-system.ts). Data, not code: no secrets live in it.
COPY deploy/files/docker-compose.prod.yml ./deploy/files/docker-compose.prod.yml
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.5-slim@sha256:b780593f3e10918cbdaec3d5a08d52224b9198069a65eb47812085c2ec007643

ENV PORT=8787

WORKDIR /app
RUN mkdir -p /var/lib/bindersnap && chown bun:bun /var/lib/bindersnap
COPY --from=builder --chown=bun:bun /app .
USER bun
EXPOSE 8787
CMD ["bun", "services/api/server.ts"]
