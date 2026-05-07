# ECR repository for the services/api container image.
# Pushed by .github/workflows/deploy-api.yml on each merge to main touching
# services/api/**. Lifecycle policy keeps the most recent N tagged images and
# expires untagged images after 7 days to bound storage cost.
#
# TODO(#224): aws_ecr_repository.api + aws_ecr_lifecycle_policy.api
