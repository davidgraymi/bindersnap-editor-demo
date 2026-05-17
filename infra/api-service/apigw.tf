# API Gateway HTTP API fronting the Lambda function.
#
# Why HTTP API not REST API:
#   Cheaper ($1/M requests vs $3.50/M), lower latency, native Lambda
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
#   Route53 alias optionally created when var.route53_zone_id is set.
#
# CORS:
#   Configured at the API Gateway layer (allowed origins from
#   var.cors_allowed_origins) so OPTIONS preflights short-circuit before
#   hitting Lambda. Saves invocations on every cross-origin browser request.
#
# Cost: $0 idle, $1 per million requests, free 1M/month for first 12
# months on a fresh account.

variable "route53_zone_id" {
  description = "Optional Route53 hosted zone ID for var.api_domain_name. When set, an A-alias record is created pointing at the API Gateway regional endpoint. Leave null to manage DNS out-of-band."
  type        = string
  default     = null
}

resource "aws_apigatewayv2_api" "api" {
  name          = local.name_prefix
  protocol_type = "HTTP"
  description   = "Bindersnap API (Lambda + API Gateway) — issue #224"

  cors_configuration {
    allow_origins     = var.cors_allowed_origins
    allow_methods     = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]
    allow_headers     = ["authorization", "content-type", "x-requested-with"]
    expose_headers    = ["content-type"]
    allow_credentials = true
    max_age           = 600
  }

  tags = local.common_tags
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  tags = local.common_tags
}

resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---------- Custom domain ----------

resource "aws_apigatewayv2_domain_name" "api" {
  domain_name = var.api_domain_name

  domain_name_configuration {
    certificate_arn = var.acm_certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = local.common_tags
}

resource "aws_apigatewayv2_api_mapping" "api" {
  api_id      = aws_apigatewayv2_api.api.id
  domain_name = aws_apigatewayv2_domain_name.api.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "api" {
  count = var.route53_zone_id == null ? 0 : 1

  zone_id = var.route53_zone_id
  name    = var.api_domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# ---------- Outputs ----------

output "api_gateway_endpoint" {
  description = "API Gateway default endpoint (use as a fallback if custom domain DNS isn't wired yet)."
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "api_gateway_target_domain_name" {
  description = "Regional target domain to CNAME/alias var.api_domain_name to (only needed when route53_zone_id is null)."
  value       = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
}

output "api_public_url" {
  description = "Public URL the SPA should point at."
  value       = "https://${var.api_domain_name}"
}
