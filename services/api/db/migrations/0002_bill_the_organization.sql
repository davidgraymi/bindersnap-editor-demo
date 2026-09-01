-- Billing moves off the person and onto the organization (ADR 0004).
--
-- Mapping a username to its organization needs Gitea, which SQL cannot reach,
-- so this migration does the half it can do correctly: it parks every existing
-- row verbatim in a legacy table and rebuilds the live tables keyed on the
-- Gitea org id. `scripts/backfill-org-billing.ts` does the mapping half, and
-- nothing is deleted until that has been run and checked.
CREATE TABLE `legacy_username_subscriptions` (
	`username` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`cancel_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legacy_username_subscription_access_overrides` (
	`username` text PRIMARY KEY NOT NULL,
	`access` text NOT NULL,
	`reason` text,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `legacy_username_subscriptions`("username", "stripe_customer_id", "stripe_subscription_id", "status", "current_period_end", "cancel_at_period_end", "cancel_at", "updated_at") SELECT "username", "stripe_customer_id", "stripe_subscription_id", "status", "current_period_end", "cancel_at_period_end", "cancel_at", "updated_at" FROM `subscriptions`;--> statement-breakpoint
INSERT INTO `legacy_username_subscription_access_overrides`("username", "access", "reason", "updated_by", "updated_at") SELECT "username", "access", "reason", "updated_by", "updated_at" FROM `subscription_access_overrides`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_subscription_access_overrides` (
	`gitea_org_id` integer PRIMARY KEY NOT NULL,
	`access` text NOT NULL,
	`reason` text,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
DROP TABLE `subscription_access_overrides`;--> statement-breakpoint
ALTER TABLE `__new_subscription_access_overrides` RENAME TO `subscription_access_overrides`;--> statement-breakpoint
CREATE TABLE `__new_subscriptions` (
	`gitea_org_id` integer PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`cancel_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
DROP TABLE `subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_subscriptions` RENAME TO `subscriptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
