CREATE TABLE `binder_drafts` (
	`gitea_repo_id` integer NOT NULL,
	`branch` text NOT NULL,
	`name` text NOT NULL,
	`authored` integer DEFAULT false NOT NULL,
	`owner` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`gitea_repo_id`, `branch`)
);
--> statement-breakpoint
CREATE INDEX `idx_binder_drafts_owner` ON `binder_drafts` (`gitea_repo_id`,`owner`);