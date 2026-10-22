CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`group_key` text NOT NULL,
	`subject` text NOT NULL,
	`idempotency_key` text,
	`plan` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` integer,
	`last_error` text,
	`result` text,
	`created_by` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`,`lease_until`);--> statement-breakpoint
CREATE INDEX `idx_jobs_subject` ON `jobs` (`group_key`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_idempotency_key` ON `jobs` (`idempotency_key`);