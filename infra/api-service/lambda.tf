# Lambda function for services/api.
#
# Architecture: container-image Lambda running the existing Bun HTTP server
# unchanged via Lambda Web Adapter (LWA). LWA is a small extension that
# proxies API Gateway events to a local HTTP server inside the Lambda
# environment, so the Bun.serve() handler in services/api/server.ts keeps
# working with no code changes.
#
# Image source:
#   ECR repo bindersnap-${env}-api (see ecr.tf)
#   Built by .github/workflows/deploy-api.yml on each push to main.
#   Tagged with the commit SHA; deploy is `aws lambda update-function-code
#   --image-uri <repo>:<sha>` followed by `aws lambda wait function-updated`.
#
# Why container-image Lambda instead of zip + custom runtime:
#   Bun isn't a managed Lambda runtime. Custom runtimes via bootstrap work
#   but require packaging Bun as a layer and writing handler glue. The
#   container path keeps the Dockerfile we already have (one extra COPY for
#   the LWA binary) and lets us run the same image locally for dev parity.
#
# Configuration:
#   memory:        1024 MB    (Bun + Stripe SDK + pg driver headroom)
#   timeout:       29 seconds (max useful — API Gateway HTTP API timeout is 30s)
#   architecture:  arm64      (cheaper, Bun supports it)
#   ephemeral:     512 MB     (default; nothing on-disk persists)
#
# Environment:
#   PORT=8787                                # LWA forwards to this
#   AWS_LWA_PORT=8787
#   AWS_LWA_INVOKE_MODE=BUFFERED             # standard request/response
#   BINDERSNAP_STORAGE_BACKEND=postgres
#   DATABASE_URL                             # via Secrets Manager
#   STRIPE_SECRET_KEY                        # via Secrets Manager
#   STRIPE_WEBHOOK_SECRET                    # via Secrets Manager
#   BINDERSNAP_GITEA_SERVICE_TOKEN           # via Secrets Manager
#   BINDERSNAP_GITEA_INTERNAL_URL            # http://<gitea-eni-ip>:3000
#                                            # (private VPC reach to Gitea)
#
# VPC attachment:
#   subnets:         var.private_subnet_ids
#   security_groups: [lambda_sg]
#   This is required so Lambda can reach Aurora (private) and Gitea (private
#   IP, same VPC). Outbound to Stripe traverses the Gitea-as-NAT path — see
#   nat.tf.
#
# Concurrency:
#   reserved_concurrent_executions: 10   # solo-dev cap; raise when needed
#   provisioned_concurrency: 0           # accept ~1-2s cold-start
#
# TODO(#224):
#   aws_lambda_function.api
#   aws_cloudwatch_log_group.api (retention = 14 days)
