-- Hand-edited to adopt legacy pre-Drizzle SQLite files on first db:migrate.
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`gitea_token` text NOT NULL,
	`gitea_token_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sessions_expires` ON `sessions` (`expires_at`);
