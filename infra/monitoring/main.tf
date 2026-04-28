terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key = "monitoring/terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region for CloudWatch and SNS resources"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used for resource naming"
  type        = string
  default     = "bindersnap"
}

variable "instance_id" {
  description = "EC2 instance ID to scope the alarms to; override with the real instance ID for production"
  type        = string
  default     = "i-0123456789abcdef0"

  validation {
    condition     = can(regex("^i-[0-9a-f]+$", var.instance_id))
    error_message = "instance_id must look like an EC2 instance ID, for example i-0123456789abcdef0."
  }
}

variable "alert_email" {
  description = "Optional email address for SNS alert delivery"
  type        = string
  default     = null

  validation {
    condition     = var.alert_email == null || can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", trimspace(var.alert_email)))
    error_message = "alert_email must be null or a valid email address."
  }
}

variable "api_log_group_name" {
  description = "CloudWatch Logs log group for the API container (must match docker-compose awslogs-group)"
  type        = string
  default     = "/bindersnap/api"
}

locals {
  alerts_topic_name      = "${var.project}-alerts"
  email_subscription     = var.alert_email != null && trimspace(var.alert_email) != ""
  status_alarm_name      = "${var.project}-instance-status-check-failed"
  cpu_warning_alarm_name = "${var.project}-instance-cpu-high-warning"
  common_tags = {
    Project = var.project
  }
}

resource "aws_sns_topic" "alerts" {
  name = local.alerts_topic_name

  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  count = local.email_subscription ? 1 : 0

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = trimspace(var.alert_email)
}

# Treat missing datapoints as breaching so a stopped instance still trips the uptime alarm.
resource "aws_cloudwatch_metric_alarm" "status_check_failed" {
  alarm_name                = local.status_alarm_name
  alarm_description         = "Alert when the EC2 instance fails system or instance status checks"
  namespace                 = "AWS/EC2"
  metric_name               = "StatusCheckFailed"
  dimensions                = { InstanceId = var.instance_id }
  statistic                 = "Maximum"
  period                    = 60
  evaluation_periods        = 2
  threshold                 = 1
  comparison_operator       = "GreaterThanOrEqualToThreshold"
  treat_missing_data        = "breaching"
  alarm_actions             = [aws_sns_topic.alerts.arn]
  insufficient_data_actions = []

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "cpu_high_warning" {
  alarm_name                = local.cpu_warning_alarm_name
  alarm_description         = "Warn when EC2 CPU stays above 90 percent for 5 minutes"
  namespace                 = "AWS/EC2"
  metric_name               = "CPUUtilization"
  dimensions                = { InstanceId = var.instance_id }
  statistic                 = "Average"
  period                    = 60
  evaluation_periods        = 5
  threshold                 = 90
  comparison_operator       = "GreaterThanThreshold"
  treat_missing_data        = "notBreaching"
  alarm_actions             = [aws_sns_topic.alerts.arn]
  insufficient_data_actions = []

  tags = local.common_tags
}

# Disk usage alarm — requires CloudWatch agent emitting to Bindersnap namespace.
# Triggers when any monitored mount (/, /data) exceeds 85% for 10 minutes.
resource "aws_cloudwatch_metric_alarm" "disk_high" {
  alarm_name          = "${var.project}-instance-disk-high"
  alarm_description   = "Alert when disk usage exceeds 85% on any mount for 10+ minutes"
  namespace           = "Bindersnap"
  metric_name         = "disk_used_percent"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = var.instance_id
  }

  tags = local.common_tags
}

# Memory usage alarm — bonus, since CW agent is already installed.
resource "aws_cloudwatch_metric_alarm" "mem_high" {
  alarm_name          = "${var.project}-instance-mem-high"
  alarm_description   = "Alert when memory usage exceeds 90% for 10+ minutes"
  namespace           = "Bindersnap"
  metric_name         = "mem_used_percent"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 90
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = var.instance_id
  }

  tags = local.common_tags
}

# API log group — owned here so retention and tags are consistent.
# The docker-compose awslogs driver will also create it if missing, but
# Terraform ownership lets us set retention and prevent accidental deletion.
resource "aws_cloudwatch_log_group" "api" {
  name              = var.api_log_group_name
  retention_in_days = 30

  tags = local.common_tags
}

# Count structured log lines that carry stripe_webhook_5xx=true.
# The API emits these before every 500 return from the /stripe/webhook handler.
resource "aws_cloudwatch_log_metric_filter" "stripe_webhook_5xx" {
  name           = "${var.project}-stripe-webhook-5xx"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.stripe_webhook_5xx = true }"

  metric_transformation {
    name          = "StripeWebhook5xxCount"
    namespace     = "Bindersnap"
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

# Alert as soon as a single 5xx is emitted within any 5-minute window.
resource "aws_cloudwatch_metric_alarm" "stripe_webhook_5xx" {
  alarm_name          = "${var.project}-stripe-webhook-5xx"
  alarm_description   = "Alert on any 5xx response from POST /stripe/webhook in a 5-minute window"
  namespace           = "Bindersnap"
  metric_name         = "StripeWebhook5xxCount"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  tags = local.common_tags
}

output "disk_high_alarm_name" {
  description = "CloudWatch alarm name for disk usage"
  value       = aws_cloudwatch_metric_alarm.disk_high.alarm_name
}

output "mem_high_alarm_name" {
  description = "CloudWatch alarm name for memory usage"
  value       = aws_cloudwatch_metric_alarm.mem_high.alarm_name
}

output "alerts_topic_arn" {
  description = "SNS topic ARN for alert delivery"
  value       = aws_sns_topic.alerts.arn
}

output "status_check_alarm_name" {
  description = "CloudWatch alarm name for EC2 status checks"
  value       = aws_cloudwatch_metric_alarm.status_check_failed.alarm_name
}

output "cpu_warning_alarm_name" {
  description = "CloudWatch alarm name for sustained CPU warning"
  value       = aws_cloudwatch_metric_alarm.cpu_high_warning.alarm_name
}

output "alerts_email_subscription_arn" {
  description = "SNS email subscription ARN, if an email address was provided"
  value       = try(aws_sns_topic_subscription.email[0].arn, null)
}

output "api_log_group_name" {
  description = "CloudWatch Logs log group for the API container"
  value       = aws_cloudwatch_log_group.api.name
}

output "stripe_webhook_5xx_alarm_name" {
  description = "CloudWatch alarm name for Stripe webhook 5xx responses"
  value       = aws_cloudwatch_metric_alarm.stripe_webhook_5xx.alarm_name
}
