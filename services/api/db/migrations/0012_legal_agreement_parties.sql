ALTER TABLE `legal_agreements` ADD `user_id` integer;--> statement-breakpoint
ALTER TABLE `legal_agreements` ADD `scope` text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE `legal_agreements` ADD `organization_id` integer;--> statement-breakpoint
ALTER TABLE `legal_agreements` ADD `organization_name` text;--> statement-breakpoint
CREATE INDEX `legal_agreements_organization_idx` ON `legal_agreements` (`organization_id`);