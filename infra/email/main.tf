# Amazon SES for the email the API sends (issue #665).
#
# This module creates:
#   - the sending domain as an SES identity, signed with Easy DKIM
#   - a custom MAIL FROM subdomain, so SPF aligns with the sending domain
#   - a policy letting the EC2 instance role send, and only from one address
#
# The API calls SES with the instance role's own credentials — there is no
# SMTP password or access key to store. DNS is not managed here: apply, then
# add the records in the `dns_records` output wherever bindersnap.com's DNS
# lives. SES starts every account in the sandbox (verified recipients only);
# request production access in the SES console once the domain verifies.
#
# Usage:
#   terraform init -backend-config=../state/backend.hcl
#   terraform apply -var="ec2_instance_role_name=..."   # or infra/apply-all.sh

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key = "email/terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region SES sends from. The API's AWS_REGION must match."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used for resource tagging"
  type        = string
  default     = "bindersnap"
}

variable "sending_domain" {
  description = "The domain Bindersnap's email comes from"
  type        = string
  default     = "bindersnap.com"
}

variable "mail_from_subdomain" {
  description = "Subdomain of sending_domain used as the envelope sender (bounces land here)"
  type        = string
  default     = "mail"
}

variable "from_address" {
  description = "The one address the API may send as. Keep in step with BINDERSNAP_MAIL_FROM."
  type        = string
  default     = "notifications@bindersnap.com"
}

variable "ec2_instance_role_name" {
  description = "Existing EC2 IAM role name to attach the send policy to"
  type        = string
  default     = null
}

locals {
  mail_from_domain = "${var.mail_from_subdomain}.${var.sending_domain}"
}

resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.sending_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = {
    Project = var.project
  }
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity         = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

data "aws_iam_policy_document" "send" {
  statement {
    sid       = "SendAsBindersnap"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [aws_sesv2_email_identity.domain.arn]

    # The role can send from exactly one address on the domain, so a bug in
    # the API cannot mail as anybody@bindersnap.com.
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [var.from_address]
    }
  }
}

resource "aws_iam_policy" "send" {
  name        = "bindersnap-ses-send"
  description = "Lets the Bindersnap API send email through SES as ${var.from_address}"
  policy      = data.aws_iam_policy_document.send.json
}

resource "aws_iam_role_policy_attachment" "send" {
  count = var.ec2_instance_role_name == null ? 0 : 1

  role       = var.ec2_instance_role_name
  policy_arn = aws_iam_policy.send.arn
}

output "dns_records" {
  description = "Records to add to the sending domain's DNS before SES will send"
  value = concat(
    [
      for token in aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens : {
        type  = "CNAME"
        name  = "${token}._domainkey.${var.sending_domain}"
        value = "${token}.dkim.amazonses.com"
      }
    ],
    [
      {
        type  = "MX"
        name  = local.mail_from_domain
        value = "10 feedback-smtp.${var.aws_region}.amazonses.com"
      },
      {
        type  = "TXT"
        name  = local.mail_from_domain
        value = "v=spf1 include:amazonses.com ~all"
      },
      {
        # Start at p=none and read the reports; tighten once they are clean.
        type  = "TXT"
        name  = "_dmarc.${var.sending_domain}"
        value = "v=DMARC1; p=none; rua=mailto:dmarc@${var.sending_domain}"
      },
    ],
  )
}

output "send_policy_arn" {
  value = aws_iam_policy.send.arn
}
