# IAM role for the Lambda function.
#
# Permissions:
#
#   Always-on AWS-managed:
#     AWSLambdaBasicExecutionRole              # CloudWatch Logs
#     AWSLambdaVPCAccessExecutionRole          # ENI mgmt for VPC attachment
#
#   Custom:
#     secretsmanager:GetSecretValue            # scoped to this root's secrets
#                                                + the RDS-managed master secret
#     kms:Decrypt, kms:GenerateDataKey         # session_envelope CMK only

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.name_prefix}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_vpc_access" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "lambda_secrets" {
  statement {
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.stripe.arn,
      aws_secretsmanager_secret.gitea.arn,
      # Aurora's RDS-managed master-user secret.
      aws_rds_cluster.api.master_user_secret[0].secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "lambda_secrets" {
  name   = "${local.name_prefix}-secrets"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_secrets.json
}

data "aws_iam_policy_document" "lambda_kms" {
  statement {
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]
    resources = [aws_kms_key.session_envelope.arn]
  }
}

resource "aws_iam_role_policy" "lambda_kms" {
  name   = "${local.name_prefix}-kms"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_kms.json
}
