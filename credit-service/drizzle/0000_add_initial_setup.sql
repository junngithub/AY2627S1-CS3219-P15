CREATE TYPE "public"."credit_operation" AS ENUM('ONBOARDING', 'RESERVATION', 'CANCELLATION', 'EXPIRY', 'COMPLETION', 'RETURN');--> statement-breakpoint
CREATE TABLE "credit_log" (
	"log_id" bigserial PRIMARY KEY NOT NULL,
	"operation_type" "credit_operation" NOT NULL,
	"amount" integer NOT NULL,
	"actor_id" uuid NOT NULL,
	"order_id" uuid,
	"balance_after" integer NOT NULL,
	"event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_log_amount_positive" CHECK ("credit_log"."amount" > 0),
	CONSTRAINT "credit_log_balance_nonneg" CHECK ("credit_log"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_order" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"requester_id" uuid NOT NULL,
	"reserved_credits" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_order_reserved_positive" CHECK ("credit_order"."reserved_credits" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_user" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_user_balance_nonneg" CHECK ("credit_user"."balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "credit_log" ADD CONSTRAINT "credit_log_actor_id_credit_user_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."credit_user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_order" ADD CONSTRAINT "credit_order_requester_id_credit_user_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."credit_user"("user_id") ON DELETE no action ON UPDATE no action;