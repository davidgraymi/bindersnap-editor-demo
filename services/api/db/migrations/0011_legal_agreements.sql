CREATE TABLE `legal_agreements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`version` text NOT NULL,
	`accepted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `legal_agreements_username_idx` ON `legal_agreements` (`username`);