# ECR repository for the services/api Lambda container image.
#
# Pushed by .github/workflows/deploy-api.yml on each merge to main touching
# services/api/**. Lambda pulls from here at deploy and on cold-start.
#
# Lifecycle policy keeps the most recent N tagged images and expires
# untagged images after 7 days to bound storage cost.
#
# Image format: container-image Lambda (OCI). The Dockerfile installs the
# AWS Lambda Web Adapter binary into the image so the existing Bun.serve()
# handler keeps working unchanged. See lambda.tf.

resource "aws_ecr_repository" "api" {
  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 tagged images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
    ]
  })
}

output "ecr_repository_url" {
  description = "ECR repository URL for the API image. Consumed by deploy-api.yml."
  value       = aws_ecr_repository.api.repository_url
}
