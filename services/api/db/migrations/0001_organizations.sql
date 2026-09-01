CREATE TABLE `organizations` (
	`gitea_org_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`trial_ends_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_organizations_name` ON `organizations` (`name`);