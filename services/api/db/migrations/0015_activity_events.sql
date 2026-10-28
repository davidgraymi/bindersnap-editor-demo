CREATE TABLE `activity_builds` (
	`id` integer PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`events` integer NOT NULL,
	`binders` integer NOT NULL,
	`errors` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	`org_id` integer,
	`binder_id` integer,
	`change_number` integer,
	`actor_id` integer,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `activity_events_kind_at_idx` ON `activity_events` (`kind`,`at`);--> statement-breakpoint
CREATE INDEX `activity_events_org_idx` ON `activity_events` (`org_id`);--> statement-breakpoint
CREATE INDEX `activity_events_binder_idx` ON `activity_events` (`binder_id`,`change_number`);