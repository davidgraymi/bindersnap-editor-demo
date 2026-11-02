CREATE TABLE `organization_settings` (
	`gitea_org_id` integer PRIMARY KEY NOT NULL,
	`new_binder_required_approvals` integer DEFAULT 0 NOT NULL,
	`new_binder_dismiss_stale_approvals` integer DEFAULT true NOT NULL,
	`new_binder_block_on_unresolved_threads` integer DEFAULT false NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
