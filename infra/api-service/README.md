# infra/api-service

Terraform root for the `services/api` Fargate deployment. **Skeleton only — not yet apply-ready.** Tracks issue #224.

## Status

| File                 | Purpose                                                                               | State    |
| -------------------- | ------------------------------------------------------------------------------------- | -------- |
| `main.tf`            | Provider, backend, shared variables and locals                                        | scaffold |
| `ecr.tf`             | ECR repository for the API image                                                      | scaffold |
| `aurora.tf`          | Aurora Serverless v2 Postgres — sessions, subscriptions, webhook idempotency, all of it | scaffold |
| `secrets.tf`         | Secrets Manager + KMS for Stripe/Gitea/Postgres credentials                           | scaffold |
| `iam.tf`             | Task execution role and task role                                                     | scaffold |
| `security-groups.tf` | ALB SG, task SG, task→Aurora SG                                                       | scaffold |
| `alb.tf`             | ALB, target group, listener, ACM cert                                                 | scaffold |
| `ecs-cluster.tf`     | ECS cluster with FARGATE / FARGATE_SPOT capacity providers                            | scaffold |
| `ecs-service.tf`     | Service, task definition, autoscaling                                                 | scaffold |

## Apply order

Once filled in, this root slots between `infra/compute/` and `infra/backups/` in `infra/apply-all.sh`. Apply order within this root is the file order above (main → ecr → data store → secrets → iam → networking → alb → cluster → service).

## Datastore choice: Aurora Serverless v2 Postgres only

DynamoDB was considered for sessions and dropped to keep operational/cost surface small. One DB, one IAM/networking surface, one backup story, one credential rotation. Sessions are pure key-value but Postgres handles that fine; we lose DynamoDB's native TTL but a tiny reap job (or `pg_cron`) replaces it.

### Cold-start tradeoff

Aurora Serverless v2 supports `min_capacity = 0` ACU (true auto-pause). Cost vs. UX:

| `min_capacity` | Idle cost | First-request latency after long idle |
| --- | --- | --- |
| `0` (auto-pause) | ~$0/month | ~5–15s wake-up |
| `0.5 ACU` | ~$43/month | none |

Default in this scaffold is `0`. Acceptable for Stripe webhooks (they retry) and for low-traffic personal use; uncomfortable if a user has just been linked a login URL. Knob is a single number in `aurora.tf`.

### Cold-start mitigations if `min_capacity = 0` proves painful

- A ~3-line warmer cron that pings `/healthz` (and a trivial DB query inside it) every 4 minutes during business hours. Keeps the cluster warm only when it matters; ~$0–5/month at solo-dev volume.
- Bump to `0.5 ACU` and stop thinking about it.

## Open question: ALB vs. API Gateway HTTP API

ALB has a ~$16/month floor at zero traffic — pay-per-hour, can't be turned off. The "true serverless" alternative is **API Gateway HTTP API + VPC Link to Fargate**, billed per request. Tradeoffs:

| | ALB | API Gateway HTTP API |
| --- | --- | --- |
| Idle cost | ~$16/month | $0 |
| Per-request cost | included in floor | ~$1/M requests |
| WebSocket support | yes | separate WebSocket API product |
| Path-based routing | rich | adequate |
| ECS native integration | direct | via VPC Link |

Hocuspocus runs separately so the WebSocket gap doesn't matter for the API tier. If you want the smallest possible idle bill, this is worth swapping. The scaffold currently assumes ALB; switching is a contained change to `alb.tf` and `ecs-service.tf`.

## Out of scope for #224 first slice

- Filling in the resource bodies. The first slice (this PR) only commits the structure so the design is reviewable. Each subsequent PR fills in one or two files and is independently applyable.
- Cross-account / multi-region. Single-AZ, single-account is fine for solo-dev launch.
- Replacing Caddy on the EC2 host (Gitea still fronts it).

See issue #224 and the plan-verification comment for the full breakdown.
