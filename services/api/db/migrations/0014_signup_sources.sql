CREATE TABLE `signup_sources` (
	`username` text PRIMARY KEY NOT NULL,
	`entry_path` text,
	`from_path` text,
	`referrer_host` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`invited` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signup_sources_created_at_idx` ON `signup_sources` (`created_at`);