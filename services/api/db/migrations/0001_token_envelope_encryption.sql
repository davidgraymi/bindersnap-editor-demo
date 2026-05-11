-- Replace plaintext `sessions.gitea_token` with envelope-encrypted columns.
--
-- `gitea_token_ciphertext` holds the gitea_token sealed with a per-session DEK
-- (AES-256-GCM). `gitea_token_dek` holds that DEK wrapped by the master key
-- (KMS CMK in production; BINDERSNAP_TOKEN_ENCRYPTION_KEY in local/dev). See
-- services/api/token-crypto.ts for the framing.
--
-- Destructive: any rows present in `sessions` at apply time are deleted. This
-- is acceptable because no Postgres deployment has been promoted to production
-- yet — SQLite remains authoritative until the cutover slice. The one-shot
-- migration script (scripts/migrate-sqlite-to-postgres.ts) re-encrypts session
-- rows with the configured TokenCrypto when it copies them across.

DELETE FROM "sessions";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "gitea_token";
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "gitea_token_ciphertext" bytea NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "gitea_token_dek" bytea NOT NULL;
