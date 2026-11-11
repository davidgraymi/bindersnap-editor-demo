CREATE TABLE `resource_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`resource` text NOT NULL,
	`unsubscribe_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`requested_at` integer NOT NULL,
	`unsubscribed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_requests_email_resource_idx` ON `resource_requests` (`email`,`resource`);--> statement-breakpoint
CREATE INDEX `resource_requests_token_idx` ON `resource_requests` (`unsubscribe_token`);--> statement-breakpoint
CREATE INDEX `resource_requests_created_at_idx` ON `resource_requests` (`created_at`);