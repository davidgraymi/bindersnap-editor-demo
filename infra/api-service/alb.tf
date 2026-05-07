# Application Load Balancer fronting the Fargate service.
#
# Listener: HTTPS:443 with var.acm_certificate_arn. HTTP:80 redirects to HTTPS.
# Target group: ip-mode (Fargate awsvpc), health check on GET /healthz.
#
# Health check tuning:
#   path: /healthz
#   matcher: 200
#   interval: 15s
#   timeout: 5s
#   healthy_threshold: 2
#   unhealthy_threshold: 3
#   deregistration_delay: 30s   (cookies are short-lived, no need for the 300s default)
#
# Cost note: ALB has a ~$16/mo floor at zero traffic. Acceptable; the cheaper
# alternative (API Gateway HTTP API) gives up native ALB features we'd want
# for any future websocket / long-poll endpoint.
#
# TODO(#224): aws_lb.api + aws_lb_target_group.api + aws_lb_listener.{https,http}
