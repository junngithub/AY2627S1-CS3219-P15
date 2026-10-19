CREATE TYPE "public"."rating_role" AS ENUM('COURIER', 'REQUESTER');--> statement-breakpoint
CREATE TABLE "outbox" (
	"outbox_id" bigserial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"message_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rating" (
	"rating_id" bigserial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"rater_role" "rating_role" NOT NULL,
	"ratee_id" uuid NOT NULL,
	"ratee_role" "rating_role" NOT NULL,
	"score" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_order_rater_unique" UNIQUE("order_id","rater_id"),
	CONSTRAINT "rating_score_range" CHECK ("rating"."score" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "rating_grant" (
	"order_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"rater_role" "rating_role" NOT NULL,
	"ratee_id" uuid NOT NULL,
	"ratee_role" "rating_role" NOT NULL,
	"event_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_grant_order_id_rater_id_pk" PRIMARY KEY("order_id","rater_id"),
	CONSTRAINT "rating_grant_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "user_rating" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_rating_sum_nonneg" CHECK ("user_rating"."rating_sum" >= 0),
	CONSTRAINT "user_rating_count_nonneg" CHECK ("user_rating"."rating_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "outbox_unsent_idx" ON "outbox" USING btree ("outbox_id") WHERE "outbox"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "rating_ratee_idx" ON "rating" USING btree ("ratee_id");