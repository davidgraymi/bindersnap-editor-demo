CREATE TABLE `email_verifications` (
	`username` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`sent_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`verified_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_verifications_token_hash_unique` ON `email_verifications` (`token_hash`);