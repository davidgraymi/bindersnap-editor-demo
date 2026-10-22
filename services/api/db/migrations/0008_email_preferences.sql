CREATE TABLE `email_preferences` (
	`username` text PRIMARY KEY NOT NULL,
	`review_requested` integer DEFAULT true NOT NULL,
	`changes_requested` integer DEFAULT true NOT NULL,
	`ready_to_publish` integer DEFAULT true NOT NULL,
	`published` integer DEFAULT true NOT NULL,
	`unsubscribe_token` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_preferences_unsubscribe_token_unique` ON `email_preferences` (`unsubscribe_token`);--> statement-breakpoint
ALTER TABLE `email_outbox` ADD `headers` text;