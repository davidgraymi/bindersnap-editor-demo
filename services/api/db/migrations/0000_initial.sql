-- Baseline for a database that predates drizzle: production tables were
-- originally created inline by the stores, so every statement is hand-edited
-- to IF NOT EXISTS. On a fresh database this creates the full schema; on the
-- existing production file it only records the journal entry.
CREATE TABLE IF NOT EXISTS `processed_webhook_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`customer_id` text,
	`created_at` integer NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`gitea_token` text NOT NULL,
	`gitea_token_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `subscription_access_overrides` (
	`username` text PRIMARY KEY NOT NULL,
	`access` text NOT NULL,
	`reason` text,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `subscriptions` (
	`username` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`cancel_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `webhook_customer_state` (
	`customer_id` text PRIMARY KEY NOT NULL,
	`last_event_created_at` integer NOT NULL
);
