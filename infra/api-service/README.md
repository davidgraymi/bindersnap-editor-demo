# infra/api-service

Terraform root for the `services/api` Lambda + API Gateway deployment. **Skeleton only — not yet apply-ready.** Tracks issue #224.

## Architecture

```
                    Internet
                       │
                       ▼
              API Gateway HTTP API           ($0 idle, $1/M requests)
                       │
                       ▼
           Lambda (container image, VPC)     ($0 idle, pay per invocation)
              │       │       │
   ┌──────────┘       │       └─────────┐
   ▼                  ▼                 ▼
 Aurora             Gitea             Stripe API
 Serverless v2      on EC2            (via Gitea-as-NAT,
 (private)          (private          using existing public
                     ENI)             IP — see nat.tf)
 ($0 idle at
  min_capacity=0)
```

**No pay-per-hour resources.** Aurora pauses to ~$0/month, Lambda and API Gateway are pay-per-use, no ALB, no NAT Gateway. The Gitea EC2 instance — already running, already paid for — doubles as the NAT for Lambda's outbound traffic to Stripe.

## Status

| File                 | Purpose                                                                      | State    |
| -------------------- | ---------------------------------------------------------------------------- | -------- |
| `main.tf`            | Provider, backend, shared variables and locals                               | scaffold |
| `ecr.tf`             | ECR repository for the Lambda container image                                | scaffold |
| `aurora.tf`          | Aurora Serverless v2 Postgres — sessions, subscriptions, webhook idempotency | scaffold |
| `secrets.tf`         | Secrets Manager + KMS for Stripe/Gitea/Postgres credentials                  | scaffold |
| `iam.tf`             | Lambda execution role                                                        | scaffold |
| `security-groups.tf` | Lambda SG, Aurora SG, reciprocal Gitea ingress rule                          | scaffold |
| `apigw.tf`           | API Gateway HTTP API + custom domain                                         | scaffold |
| `lambda.tf`          | Lambda function (container image, VPC-attached, Lambda Web Adapter)          | scaffold |
| `nat.tf`             | Lambda subnet egress route via the Gitea ENI                                 | scaffold |

## Apply order

Once filled in, this root slots between `infra/compute/` and `infra/backups/` in `infra/apply-all.sh`. Apply order within this root: main → ecr → secrets → aurora → iam → security-groups → nat → lambda → apigw.

## Cold-start tradeoff

Aurora Serverless v2 supports `min_capacity = 0` ACU (true auto-pause). Lambda has its own ~1–2s container cold-start when the execution environment is recycled.

Worst-case: idle for 30+ minutes, first request pays both. Roughly 7–17 seconds. Tolerable for Stripe webhooks (they retry) and acceptable for low-traffic personal use.

If a hot login path matters, two mitigations:

| Knob                               | Idle cost | Effect                    |
| ---------------------------------- | --------- | ------------------------- |
| Aurora `min_capacity = 0.5`        | +~$43/mo  | Removes Aurora wake-up    |
| Lambda provisioned concurrency = 1 | +~$5/mo   | Removes Lambda cold-start |
| Both                               | +~$48/mo  | Hot path always           |

A 4-minute warmer cron pinging `/healthz` during business hours is a cheaper middle ground for both.

## Why container-image Lambda (not zip + custom runtime)

Bun isn't a managed Lambda runtime. Two paths exist:

1. **Container image + AWS Lambda Web Adapter (chosen).** The existing Bun HTTP server runs unchanged inside a Lambda container; LWA is a sidecar binary that proxies API Gateway events to a local HTTP listener. No code refactor.
2. Custom runtime via `bootstrap` script. Requires packaging Bun as a layer and writing handler glue — bigger code change.

We're picking #1 to keep `services/api/server.ts` portable across local dev (Bun directly), CI tests, and prod (Bun under LWA in Lambda).

## Why Lambda is in the VPC, not using the RDS Data API

We considered making Lambda VPC-less and reaching Aurora via the RDS Data API (HTTPS, no VPC attachment needed). Rejected because:

- VPC-attached Lambda reaches Aurora over a long-lived Postgres connection — lower latency, no per-request Data API fee, full transaction support without the BeginTransaction/CommitTransaction API dance.
- Lambda is already in the VPC anyway to reach Gitea privately, so the Data API only saves us one of two private-VPC reasons.
- The Stripe egress problem (Lambda → public internet) is solved by the Gitea-as-NAT path with no extra cost.

## Out of scope for #224 first slice

- Filling in the resource bodies. The first slice (this PR) only commits the structure so the design is reviewable. Each subsequent PR fills in one or two files and is independently applyable.
- Cross-account / multi-region. Single-AZ, single-account is fine for solo-dev launch.
- Replacing Caddy on the host (Gitea still fronts itself; Caddy is unaffected by this change).
- Refactoring `services/api/server.ts` for Lambda Web Adapter compatibility (no code change needed beyond a Dockerfile addition).

See issue #224 and the plan-verification thread for the full breakdown.
