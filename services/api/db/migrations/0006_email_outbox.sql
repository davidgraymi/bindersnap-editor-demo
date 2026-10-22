CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`html` text NOT NULL,
	`text` text NOT NULL,
	`idempotency_key` text,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`provider_message_id` text,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_email_outbox_due` ON `email_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_email_outbox_idempotency_key` ON `email_outbox` (`idempotency_key`);