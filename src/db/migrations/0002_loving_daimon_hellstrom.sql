ALTER TABLE "cases" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "eligible_override" boolean;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;