CREATE TABLE `organization_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`gitea_org_id` integer NOT NULL,
	`org_name` text NOT NULL,
	`email` text NOT NULL,
	`org_role` text NOT NULL,
	`binder` text,
	`binder_level` text,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`accepted_at` integer,
	`accepted_by` text,
	`joined_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_invitations_token_hash_unique` ON `organization_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_organization_invitations_org` ON `organization_invitations` (`gitea_org_id`);--> statement-breakpoint
CREATE INDEX `idx_organization_invitations_waiting` ON `organization_invitations` (`accepted_at`,`joined_at`);