# ECS cluster with Fargate capacity providers.
#
# Two providers attached: FARGATE (default) for steady traffic, FARGATE_SPOT
# for opportunistic cost savings once we have >1 task running. Default
# strategy keeps weight on FARGATE so a Spot interruption can't take the
# service offline.
#
# Container insights: enabled. Solo-dev volume keeps the metrics cost
# negligible and CloudWatch dashboards become useful immediately.
#
# TODO(#224): aws_ecs_cluster.api + aws_ecs_cluster_capacity_providers.api
