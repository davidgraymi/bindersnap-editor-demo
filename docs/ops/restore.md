# Backups and restores

Production keeps three copies, each made a different way
(`docs/ops/production-architecture.md` §3):

| Copy                | What                                                         | How often  | Kept                     | Lives in                          |
| ------------------- | ------------------------------------------------------------ | ---------- | ------------------------ | --------------------------------- |
| EBS snapshots (DLM) | the whole data volume                                        | hourly     | 48 h; daily ones 35 days | us-east-1, copied to us-west-2    |
| Litestream          | `gitea.db`, `sessions.db`                                    | continuous | 7 days of point-in-time  | S3 `bindersnap-litestream-*`      |
| restic              | both databases (consistent copies) + the `gitea-data` volume | hourly     | 36 days, locked for 35   | Cloudflare R2 `bindersnap-backup` |

**The rule.** Restore Gitea's database and its repositories **from the same
copy**. A newer `gitea.db` over older repositories leaves pull requests,
reviews and approvals pointing at commits that are not there. Litestream on
its own is only for a broken database while the repositories are intact.
`sessions.db` has no such tie: take the newest one from anywhere.

## Setting up restic, once

1. Apply `infra/edge`. It creates the R2 bucket and its lock, and prints the
   repository URL: `terraform -chdir=infra/edge output -raw backup_repository`.
2. In Cloudflare → R2 → Manage API tokens, create a token with **Object Read &
   Write**, limited to the `bindersnap-backup` bucket. Note its Access Key ID
   and Secret Access Key.
3. Generate a repository password and keep it **in your password manager as
   well as SSM**. Without it the backups cannot be read, by anyone.
4. Put all four in SSM; the next deploy renders them into `.env.prod`:

   ```bash
   P=/bindersnap/prod; K=alias/bindersnap-prod-ssm
   put() { aws ssm put-parameter --overwrite --type SecureString --key-id "$K" --name "$P/$1" --value "$2"; }
   put restic_repository           "$(terraform -chdir=infra/edge output -raw backup_repository)"
   put restic_password             "<the password>"
   put restic_r2_access_key_id     "<access key id>"
   put restic_r2_secret_access_key "<secret access key>"
   ```

5. Deploy. The first hourly run initialises the repository. Check it from the
   host: `sudo systemctl start bindersnap-backup && journalctl -u bindersnap-backup -n 20`.

## Restore 1: a broken database (Litestream)

The repositories are fine; `gitea.db` (or `sessions.db`) is corrupted or a
migration went wrong. On the host:

```bash
cd /opt/bindersnap
docker compose --env-file .env.prod -f docker-compose.prod.yml down
export LITESTREAM_S3_BUCKET=$(grep ^LITESTREAM_S3_BUCKET= .env.prod | cut -d= -f2)
scripts/restore.sh gitea        # or: api
bindersnap-stack-up
```

The old file stays beside the new one as `gitea.db.pre-restore-<time>`. If the
restore fails part-way, move it back.

## Restore 2: the host or its volume is gone (EBS snapshot)

1. Pick the newest good snapshot:
   `aws ec2 describe-snapshots --owner-ids self --filters Name=tag:Project,Values=bindersnap --query 'sort_by(Snapshots,&StartTime)[-5:]'`
   If us-east-1 is the problem, copy one back from us-west-2 first
   (`aws ec2 copy-snapshot --source-region us-west-2 ...`).
2. If the host is still running, stop the stack, so nothing writes to the old
   volume while it is detached.
3. In `infra/compute`, set `data_volume_snapshot_id = "snap-..."` in
   `terraform.tfvars`, forget the old volume, and apply:

   ```bash
   terraform state rm aws_ebs_volume.data
   terraform apply -var-file=terraform.tfvars
   ```

   Terraform builds a new volume from the snapshot and attaches it in place
   of the old one. The old volume is left alone, detached; delete it by hand
   once the restore is checked.

4. Deploy. Do not restore Litestream's `gitea.db` on top (the rule above).
5. Set `data_volume_snapshot_id` back to null. Nothing changes: the volume
   ignores it after creation.

## Restore 3: AWS is unavailable or compromised (restic)

From any machine with Docker, the repository password and the R2 token:

```bash
export RESTIC_REPOSITORY=s3:https://<account>.r2.cloudflarestorage.com/bindersnap-backup
export RESTIC_PASSWORD=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_DEFAULT_REGION=auto
docker run --rm -e RESTIC_REPOSITORY -e RESTIC_PASSWORD -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -v "$PWD/restore:/restore" \
  restic/restic:0.19.1 restore latest --target /restore
```

`restore/backup/gitea-data/` is the `gitea-data` volume without its database;
copy `restore/backup/databases/gitea.db` into it as `gitea.db`. That pair is one
consistent copy. `restore/backup/databases/sessions.db` is the API's volume.
Load both into the volumes of a fresh stack, then deploy.

## The drill

Before the first customer, and every quarter: restore each copy into a
scratch instance, sign in, open a document, check its history and approvals.
Write the wall-clock time here.

| Date | Copy | Time to working app | Notes |
| ---- | ---- | ------------------- | ----- |
|      |      |                     |       |
