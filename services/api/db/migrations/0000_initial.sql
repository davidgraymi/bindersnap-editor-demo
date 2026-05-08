CREATE TABLE "processed_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"customer_id" text,
	"created_at" bigint NOT NULL,
	"processed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_versions" (
	"id" integer PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"applied_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"gitea_token" text NOT NULL,
	"gitea_token_name" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_access_overrides" (
	"username" text PRIMARY KEY NOT NULL,
	"access" text NOT NULL,
	"reason" text,
	"updated_by" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"username" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" bigint,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancel_at" bigint,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_customer_state" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"last_event_created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscriptions_customer" ON "subscriptions" USING btree ("stripe_customer_id");