# infra/api-service

Terraform root for the `services/api` Fargate deployment. **Skeleton only — not yet apply-ready.** Tracks issue #224.

## Status

| File                 | Purpose                                                               | State    |
| -------------------- | --------------------------------------------------------------------- | -------- |
| `main.tf`            | Provider, backend, shared variables and locals                        | scaffold |
| `ecr.tf`             | ECR repository for the API image                                      | scaffold |
| `dynamodb.tf`        | Sessions table (PK=`session_id`, TTL=`expires_at`)                    | scaffold |
| `aurora.tf`          | Aurora Serverless v2 Postgres for subscriptions + webhook idempotency | scaffold |
| `secrets.tf`         | Secrets Manager + KMS for Stripe/Gitea/Postgres credentials           | scaffold |
| `iam.tf`             | Task execution role and task role                                     | scaffold |
| `security-groups.tf` | ALB SG, task SG, task→Aurora SG                                       | scaffold |
| `alb.tf`             | ALB, target group, listener, ACM cert                                 | scaffold |
| `ecs-cluster.tf`     | ECS cluster with FARGATE / FARGATE_SPOT capacity providers            | scaffold |
| `ecs-service.tf`     | Service, task definition, autoscaling                                 | scaffold |

## Apply order

Once filled in, this root slots between `infra/compute/` and `infra/backups/` in `infra/apply-all.sh`. Apply order within this root is the file order above (main → ecr → data stores → secrets → iam → networking → alb → cluster → service).

## Out of scope for #224 first slice

- Filling in the resource bodies. The first slice (this PR) only commits the structure so the design is reviewable. Each subsequent PR fills in one or two files and is independently applyable.
- Cross-account / multi-region. Single-AZ, single-account is fine for solo-dev launch.
- Replacing Caddy on the EC2 host (Gitea still fronts it).

See issue #224 and the plan-verification comment for the full breakdown.
