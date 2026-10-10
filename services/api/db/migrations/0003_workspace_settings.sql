CREATE TABLE `settings_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gitea_repo_id` integer NOT NULL,
	`setting` text NOT NULL,
	`previous_value` text,
	`new_value` text NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_settings_events_repo` ON `settings_events` (`gitea_repo_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`gitea_repo_id` integer PRIMARY KEY NOT NULL,
	`organization` text NOT NULL,
	`workspace` text NOT NULL,
	`block_on_unresolved_threads` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
