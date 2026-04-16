terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
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
