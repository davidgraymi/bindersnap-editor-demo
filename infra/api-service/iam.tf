# IAM role for the Lambda function.
#
# Permissions:
#
#   Always-on AWS-managed:
#     AWSLambdaBasicExecutionRole              # CloudWatch Logs
#     AWSLambdaVPCAccessExecutionRole          # ENI mgmt for VPC attachment
#
# Runtime secrets are passed to Lambda as plain environment variables
# (see runtime-env.tf for the trade-off discussion), so the function does
# NOT need secretsmanager:GetSecretValue or kms:Decrypt at runtime. The
# Aurora master secret is read at terraform-apply time by the operator's
# credentials, not by Lambda.

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
