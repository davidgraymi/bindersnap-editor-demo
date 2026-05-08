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
#
# TODO(#224): aws_ecr_repository.api + aws_ecr_lifecycle_policy.api
