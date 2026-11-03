# Terraform (AWS ap-south-1)

Production infrastructure for TouchGrass, as described in `docs/ARCHITECTURE.md` §10.

| File                 | What                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network.tf`         | VPC across 3 AZs, public/private/data subnets, one NAT gateway per AZ, S3 gateway endpoint, flow logs                                                      |
| `kms.tf`             | One customer-managed key for RDS, ElastiCache, S3, Secrets Manager and logs                                                                                |
| `security_groups.tf` | ALB → tasks → Postgres/Redis, nothing else                                                                                                                 |
| `secrets.tf`         | `…/app` (generated: JWT secret, pepper, signing secret, DB/Redis URLs) and `…/providers` (third-party keys you fill in)                                    |
| `data.tf`            | RDS PostgreSQL 16 Multi-AZ + read replica (forced TLS, Performance Insights), ElastiCache Redis 7 (TLS + auth, `noeviction` for BullMQ)                    |
| `media.tf`           | S3 media bucket (private, TLS-only) behind CloudFront with origin access control                                                                           |
| `ecr.tf`             | Image repositories: `api` (also runs realtime, worker and migrations) and `web`                                                                            |
| `edge.tf`            | ACM certificates, Route 53 records, ALB with `api.`/realtime (sticky)/web target groups, admin IP allow-list                                               |
| `ecs.tf`             | Fargate cluster, task definitions (api, realtime, worker, web, migrate) with an ADOT sidecar, services with deployment circuit breaker and CPU autoscaling |
| `waf.tf`             | Regional WAF on the ALB (AWS managed rules, per-IP rate limit, stricter OTP limit) and a CloudFront WAF                                                    |
| `email.tf`           | SES domain identity with Easy DKIM and a DMARC record (receipts and account email)                                                                         |
| `alarms.tf`          | SNS topic + alarms (5xx, latency, CPU, DB, Redis memory, queue depth)                                                                                      |

## First deployment

Prerequisites: an AWS account, a Route 53 hosted zone for the domain, Terraform 1.9.x, Docker, and an S3 bucket + DynamoDB table for state.

1. State backend (the `backend "s3" {}` block is filled at init):

   ```bash
   terraform init -backend-config="bucket=<state-bucket>" -backend-config="key=touchgrass/production.tfstate" -backend-config="region=ap-south-1" -backend-config="dynamodb_table=<lock-table>" -backend-config="encrypt=true"
   ```

2. Variables: copy `terraform.tfvars.example` to `terraform.tfvars` and set the domain, zone ID, `support_email`, `seller_legal_name` (and `seller_gstin` once registered), `apple_team_id`, `android_sha256_cert_fingerprints`, `alarm_email` and `admin_allowed_cidrs` (office VPN egress; an empty list leaves `/admin` open to the internet).

3. Create the registries first, then push images tagged with the git SHA:

   ```bash
   terraform apply -target=aws_ecr_repository.app
   ```

   ```bash
   docker build -f apps/api/Dockerfile -t <api-repo>:<sha> . && docker push <api-repo>:<sha>
   ```

   ```bash
   docker build -f apps/web/Dockerfile -t <web-repo>:<sha> . && docker push <web-repo>:<sha>
   ```

4. Apply everything with `image_tag=<sha>`:

   ```bash
   terraform apply -var image_tag=<sha>
   ```

5. Fill the providers secret (`terraform output provider_secret_name`) in the console or CLI: MSG91, Razorpay, Expo access token, Google Maps, OpenWeather, PostHog, Sentry and the store review sign-in pair. Terraform created it with empty values and never overwrites it. Empty values count as unset. Then force a new deployment of the services so they read it.

6. Run migrations as a one-off task before (or right after) the first deploy, and before every deploy that adds one:

   ```bash
   aws ecs run-task --cluster "$(terraform output -raw ecs_cluster)" --task-definition "$(terraform output -raw migrate_task_definition)" --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json private_subnets | jq -r 'join(",")')],securityGroups=[$(terraform output -raw task_security_group)],assignPublicIp=DISABLED}"
   ```

7. Bootstrap reference data (Hyderabad and its neighbourhoods, feature flags, the interest and vibe taxonomy, the starter icebreaker deck) and the first super admin, using the same task definition with a different command. It's idempotent, and it adds no fake people or plans; the development seed refuses to run in production:

   ```bash
   aws ecs run-task --cluster "$(terraform output -raw ecs_cluster)" --task-definition "$(terraform output -raw migrate_task_definition)" --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json private_subnets | jq -r 'join(",")')],securityGroups=[$(terraform output -raw task_security_group)],assignPublicIp=DISABLED}" --overrides '{"containerOverrides":[{"name":"migrate","command":["node","dist/seed/bootstrap.cli.js","--super-admin","+91XXXXXXXXXX"]}]}'
   ```

   That number can then sign in to the app and `/admin` without an invite code; from there, invite the team (admin team page) and create invite codes for the first members.

## Later deploys

Build and push both images with the new SHA, run the migrate task if the release has migrations, then `terraform apply -var image_tag=<sha>`. ECS rolls the services; the deployment circuit breaker rolls back a release whose tasks fail health checks.

## Validating without AWS credentials

```bash
terraform init -backend=false && terraform validate
```

In a sandbox that can't reach `registry.terraform.io`, point `init` at a local provider mirror (`terraform providers mirror` on a machine that can, or the release zips from `releases.hashicorp.com` laid out as `registry.terraform.io/hashicorp/<name>/<version>/<os_arch>/`) with a `provider_installation { filesystem_mirror { … } }` block in a CLI config file passed as `TF_CLI_CONFIG_FILE`. Provider versions are pinned in `versions.tf` and `.terraform.lock.hcl`.
