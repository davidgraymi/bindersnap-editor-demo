FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY services/api ./services/api
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim

# AWS Lambda Web Adapter — dormant outside Lambda (activates only when the
# Lambda runtime sets AWS_LAMBDA_RUNTIME_API), so local `docker run` and the
# host-side compose stack keep behaving exactly as before. In Lambda it
# proxies API Gateway events to the Bun.serve() listener on $AWS_LWA_PORT.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter

ENV PORT=8787 \
    AWS_LWA_PORT=8787 \
    AWS_LWA_INVOKE_MODE=BUFFERED

WORKDIR /app
RUN mkdir -p /var/lib/bindersnap && chown bun:bun /var/lib/bindersnap
COPY --from=builder --chown=bun:bun /app .
USER bun
EXPOSE 8787
CMD ["bun", "services/api/server.ts"]
