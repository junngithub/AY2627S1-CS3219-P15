CREATE TYPE "public"."badge_state" AS ENUM('earned', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."order_role" AS ENUM('COURIER', 'REQUESTER');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('schedule', 'manual');--> statement-breakpoint
CREATE TYPE "public"."badge_target_role" AS ENUM('courier', 'requester', 'any');--> statement-breakpoint
CREATE TABLE "badge_catalog" (
	"badge_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"target_role" "badge_target_role" NOT NULL,
	"display_order" integer NOT NULL,
	"icon_earned_url" text NOT NULL,
	"icon_unearned_url" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"progress_metric" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counted_order" (
	"order_id" uuid NOT NULL,
	"role" "order_role" NOT NULL,
	"user_id" uuid NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counted_order_order_id_role_pk" PRIMARY KEY("order_id","role")
);
--> statement-breakpoint
CREATE TABLE "disputed_order" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"disputed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_run" (
	"run_id" bigserial PRIMARY KEY NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"triggered_by" uuid,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"users_processed" integer DEFAULT 0 NOT NULL,
	"users_skipped" integer DEFAULT 0 NOT NULL,
	"badges_awarded" integer DEFAULT 0 NOT NULL,
	"badges_revoked" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "user_badge" (
	"user_id" uuid NOT NULL,
	"badge_id" text NOT NULL,
	"state" "badge_state" NOT NULL,
	"first_earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"earned_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badge_user_id_badge_id_pk" PRIMARY KEY("user_id","badge_id")
);
--> statement-breakpoint
CREATE TABLE "user_metrics" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"completed_deliveries" integer DEFAULT 0 NOT NULL,
	"completed_orders" integer DEFAULT 0 NOT NULL,
	"average_rating" double precision,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"last_order_event_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_metrics_deliveries_nonneg" CHECK ("user_metrics"."completed_deliveries" >= 0),
	CONSTRAINT "user_metrics_orders_nonneg" CHECK ("user_metrics"."completed_orders" >= 0),
	CONSTRAINT "user_metrics_rating_count_nonneg" CHECK ("user_metrics"."rating_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_badge" ADD CONSTRAINT "user_badge_badge_id_badge_catalog_badge_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badge_catalog"("badge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counted_order_user_idx" ON "counted_order" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_run_one_running" ON "job_run" USING btree ("status") WHERE "job_run"."status" = 'running';