CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"app_role" text DEFAULT 'evaluator' NOT NULL,
	"org_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "users_workos_user_id_unique" UNIQUE("workos_user_id")
);
--> statement-breakpoint
CREATE TABLE "case_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"guidance" text,
	"output_spec_json" jsonb NOT NULL,
	"runner_input_json" jsonb NOT NULL,
	"evaluator_context_json" jsonb NOT NULL,
	"source_blocks_json" jsonb DEFAULT '[]' NOT NULL,
	"hidden_metadata_json" jsonb DEFAULT '{}' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"dataset_split" text DEFAULT 'dev' NOT NULL,
	"sampling_weight" double precision DEFAULT 1 NOT NULL,
	"sensitivity" text DEFAULT 'internal' NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_versions_case_id_version_unique" UNIQUE("case_id","version")
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suite_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rubric_json" jsonb DEFAULT '{}' NOT NULL,
	"weighting_json" jsonb DEFAULT '{}' NOT NULL,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suite_versions_suite_id_version_unique" UNIQUE("suite_id","version")
);
--> statement-breakpoint
CREATE TABLE "suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"intended_reader" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"parent_competitor_version_id" uuid,
	"model_provider" text,
	"model_identifier" text,
	"prompt_bundle_json" jsonb DEFAULT '{}' NOT NULL,
	"model_parameters_json" jsonb DEFAULT '{}' NOT NULL,
	"tool_config_json" jsonb DEFAULT '{}' NOT NULL,
	"output_schema_json" jsonb,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "competitor_versions_competitor_id_version_unique" UNIQUE("competitor_id","version")
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"competitor_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"suite_version_id" uuid NOT NULL,
	"case_selector_json" jsonb DEFAULT '{}' NOT NULL,
	"eligible_competitor_version_ids" uuid[] DEFAULT '{}' NOT NULL,
	"replicates" integer DEFAULT 1 NOT NULL,
	"matchmaking_strategy" text DEFAULT 'coverage' NOT NULL,
	"required_judgments_per_battle" integer DEFAULT 1 NOT NULL,
	"ranking_method" text DEFAULT 'bradley_terry' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"case_version_id" uuid NOT NULL,
	"competitor_version_id" uuid NOT NULL,
	"replicate_index" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"rendered_request" jsonb,
	"provider_request_id" text,
	"raw_provider_response_s3_key" text,
	"model_reported_version" text,
	"seed" bigint,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost" numeric(12, 6),
	"finish_reason" text,
	"error_code" text,
	"runner_code_version" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"competitor_version_id" uuid,
	"origin_type" text NOT NULL,
	"generation_attempt_id" uuid,
	"author_user_id" uuid,
	"body_text" text NOT NULL,
	"body_json" jsonb,
	"parent_response_ids" uuid[],
	"reuse_permission" boolean,
	"authoring_protocol_json" jsonb,
	"length_chars" integer,
	"length_tokens" integer,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"replicate_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comparison_id" uuid NOT NULL,
	"assigned_user_id" uuid NOT NULL,
	"left_response_id" uuid NOT NULL,
	"right_response_id" uuid NOT NULL,
	"ui_version" text,
	"evaluator_instruction_version" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"case_version_id" uuid NOT NULL,
	"response_one_id" uuid NOT NULL,
	"response_two_id" uuid NOT NULL,
	"matchmaking_strategy" text,
	"matchmaking_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"preferred_response_id" uuid,
	"reason_tags" text[] DEFAULT '{}' NOT NULL,
	"free_text_comment" text,
	"rewrite_response_id" uuid,
	"rewrite_forked_from" text,
	"time_to_first_action_ms" integer,
	"total_duration_ms" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'valid' NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text
);
--> statement-breakpoint
CREATE TABLE "ranking_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"algorithm" text DEFAULT 'bradley_terry' NOT NULL,
	"algorithm_version" text,
	"parameters_json" jsonb DEFAULT '{}' NOT NULL,
	"vote_cutoff_at" timestamp with time zone NOT NULL,
	"filters_json" jsonb DEFAULT '{}' NOT NULL,
	"code_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_scores" (
	"ranking_run_id" uuid NOT NULL,
	"competitor_version_id" uuid NOT NULL,
	"raw_score" double precision,
	"display_score" double precision,
	"rank" integer,
	"rank_lower" integer,
	"rank_upper" integer,
	"confidence_lower" double precision,
	"confidence_upper" double precision,
	"judgment_count" integer,
	"case_count" integer,
	"unacceptable_rate" double precision,
	"tie_rate" double precision,
	CONSTRAINT "ranking_scores_ranking_run_id_competitor_version_id_pk" PRIMARY KEY("ranking_run_id","competitor_version_id")
);
--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_suite_id_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suite_versions" ADD CONSTRAINT "suite_versions_suite_id_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suites" ADD CONSTRAINT "suites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_versions" ADD CONSTRAINT "competitor_versions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_versions" ADD CONSTRAINT "competitor_versions_parent_competitor_version_id_competitor_versions_id_fk" FOREIGN KEY ("parent_competitor_version_id") REFERENCES "public"."competitor_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_versions" ADD CONSTRAINT "competitor_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_suite_version_id_suite_versions_id_fk" FOREIGN KEY ("suite_version_id") REFERENCES "public"."suite_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_competitor_version_id_competitor_versions_id_fk" FOREIGN KEY ("competitor_version_id") REFERENCES "public"."competitor_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_competitor_version_id_competitor_versions_id_fk" FOREIGN KEY ("competitor_version_id") REFERENCES "public"."competitor_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_generation_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("generation_attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_left_response_id_responses_id_fk" FOREIGN KEY ("left_response_id") REFERENCES "public"."responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_right_response_id_responses_id_fk" FOREIGN KEY ("right_response_id") REFERENCES "public"."responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_case_version_id_case_versions_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_response_one_id_responses_id_fk" FOREIGN KEY ("response_one_id") REFERENCES "public"."responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_response_two_id_responses_id_fk" FOREIGN KEY ("response_two_id") REFERENCES "public"."responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgments" ADD CONSTRAINT "judgments_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgments" ADD CONSTRAINT "judgments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgments" ADD CONSTRAINT "judgments_preferred_response_id_responses_id_fk" FOREIGN KEY ("preferred_response_id") REFERENCES "public"."responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgments" ADD CONSTRAINT "judgments_rewrite_response_id_responses_id_fk" FOREIGN KEY ("rewrite_response_id") REFERENCES "public"."responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_runs" ADD CONSTRAINT "ranking_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_scores" ADD CONSTRAINT "ranking_scores_ranking_run_id_ranking_runs_id_fk" FOREIGN KEY ("ranking_run_id") REFERENCES "public"."ranking_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_scores" ADD CONSTRAINT "ranking_scores_competitor_version_id_competitor_versions_id_fk" FOREIGN KEY ("competitor_version_id") REFERENCES "public"."competitor_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gen_attempts_cell" ON "generation_attempts" USING btree ("case_version_id","competitor_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_model_cell" ON "responses" USING btree ("case_version_id","competitor_version_id","replicate_index") WHERE origin_type = 'model_generation';