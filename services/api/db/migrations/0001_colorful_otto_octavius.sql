-- Hand-edited to adopt legacy pre-Drizzle SQLite files on first db:migrate.
CREATE TABLE IF NOT EXISTS `subscriptions` (
	`username` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_subscriptions_customer` ON `subscriptions` (`stripe_customer_id`);
