# API Gateway HTTP API fronting the Lambda function.
#
# Why HTTP API not REST API:
#   Cheaper ($1/M requests vs $3.50/M), lower latency, native JWT/Lambda
#   integration. We don't need REST API features (request validation,
#   API keys, usage plans) — auth is owned by the API itself.
#
# Routes:
#   ANY /{proxy+}   → Lambda integration (catch-all, lets the existing
#                     services/api/server.ts router handle every path)
#
# Custom domain:
#   var.api_domain_name (e.g., api.bindersnap.example.com)
#   ACM cert from var.acm_certificate_arn (must be in same region as the
#   API — HTTP APIs are regional, no us-east-1 quirk)
#   Route53 alias points the domain at the API Gateway custom-domain
#   regional endpoint.
#
# CORS:
#   Configured at the API Gateway layer (allowed origins from
#   var.cors_allowed_origins) so OPTIONS preflights short-circuit before
#   hitting Lambda. Saves invocations on every cross-origin browser request.
#
# Throttling:
#   Default account limits are fine for solo-dev. Per-route throttle on
#   /auth/login + /auth/signup at e.g. 5 req/s burst once we have any
#   public traffic.
#
# Cost: $0 idle, $1 per million requests, free 1M/month for first 12
# months on a fresh account.
#
# TODO(#224):
#   aws_apigatewayv2_api.api
#   aws_apigatewayv2_integration.lambda
#   aws_apigatewayv2_route.proxy
#   aws_apigatewayv2_stage.default (auto-deploy)
#   aws_apigatewayv2_domain_name.api
#   aws_apigatewayv2_api_mapping.api
#   aws_lambda_permission.apigw_invoke
