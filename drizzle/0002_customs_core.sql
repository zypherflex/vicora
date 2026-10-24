CREATE TABLE "classification_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broker_org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"part_number" text,
	"description" text NOT NULL,
	"hts_code" text NOT NULL,
	"country_of_origin" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"rationale" text,
	"source" text DEFAULT 'BROKER' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"times_used" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customs_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broker_org_id" uuid NOT NULL,
	"importer_org_id" uuid,
	"name" text NOT NULL,
	"ior_number" text,
	"status" text DEFAULT 'ONBOARDING' NOT NULL,
	"poa_status" text DEFAULT 'NONE' NOT NULL,
	"poa_document_id" uuid,
	"poa_signed_at" timestamp with time zone,
	"poa_expires_at" timestamp with time zone,
	"poa_verified_by" uuid,
	"poa_verified_at" timestamp with time zone,
	"bond_type" text DEFAULT 'NONE' NOT NULL,
	"bond_number" text,
	"surety_name" text,
	"bond_amount_minor" bigint,
	"bond_expires_at" timestamp with time zone,
	"bond_source" text DEFAULT 'SELF_REPORTED' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"entry_fee_minor" bigint,
	"per_line_fee_minor" bigint,
	"isf_fee_minor" bigint,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customs_deadline_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broker_org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"anchor" text NOT NULL,
	"offset_days" integer DEFAULT 0 NOT NULL,
	"offset_hours" integer DEFAULT 0 NOT NULL,
	"business_days" boolean DEFAULT false NOT NULL,
	"modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reference" text,
	"is_default_template" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customs_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"broker_org_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"label" text NOT NULL,
	"reference" text,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "customs_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"broker_org_id" uuid NOT NULL,
	"user_id" uuid,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"engine" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customs_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"broker_org_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"score" integer NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customs_entries" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "customs_entries" ADD COLUMN "entry_number" text;--> statement-breakpoint
ALTER TABLE "customs_entries" ADD COLUMN "entry_type" text;--> statement-breakpoint
ALTER TABLE "customs_entries" ADD COLUMN "mode_of_transport" text DEFAULT 'OCEAN' NOT NULL;--> statement-breakpoint
ALTER TABLE "customs_entries" ADD COLUMN "vessel_departure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customs_entries" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customs_lines" ADD COLUMN "line_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customs_lines" ADD COLUMN "part_number" text;--> statement-breakpoint
ALTER TABLE "customs_lines" ADD COLUMN "classification_item_id" uuid;--> statement-breakpoint
ALTER TABLE "customs_lines" ADD COLUMN "duty_rate_bp" integer;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD COLUMN "line_items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_items" ADD CONSTRAINT "classification_items_broker_org_id_organizations_id_fk" FOREIGN KEY ("broker_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_items" ADD CONSTRAINT "classification_items_client_id_customs_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."customs_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_items" ADD CONSTRAINT "classification_items_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_items" ADD CONSTRAINT "classification_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_clients" ADD CONSTRAINT "customs_clients_broker_org_id_organizations_id_fk" FOREIGN KEY ("broker_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_clients" ADD CONSTRAINT "customs_clients_importer_org_id_organizations_id_fk" FOREIGN KEY ("importer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_clients" ADD CONSTRAINT "customs_clients_poa_verified_by_users_id_fk" FOREIGN KEY ("poa_verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_clients" ADD CONSTRAINT "customs_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_deadline_rules" ADD CONSTRAINT "customs_deadline_rules_broker_org_id_organizations_id_fk" FOREIGN KEY ("broker_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_deadlines" ADD CONSTRAINT "customs_deadlines_entry_id_customs_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."customs_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_deadlines" ADD CONSTRAINT "customs_deadlines_broker_org_id_organizations_id_fk" FOREIGN KEY ("broker_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_deadlines" ADD CONSTRAINT "customs_deadlines_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_questions" ADD CONSTRAINT "customs_questions_entry_id_customs_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."customs_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_questions" ADD CONSTRAINT "customs_questions_broker_org_id_organizations_id_fk" FOREIGN KEY ("broker_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_questions" ADD CONSTRAINT "customs_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_reviews" ADD CONSTRAINT "customs_reviews_entry_id_customs_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."customs_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_reviews" ADD CONSTRAINT "customs_reviews_broker_org_id_organizations_id_fk" FOREIGN KEY ("broker_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_reviews" ADD CONSTRAINT "customs_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classification_client_idx" ON "classification_items" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "classification_part_idx" ON "classification_items" USING btree ("broker_org_id","part_number");--> statement-breakpoint
CREATE INDEX "customs_clients_broker_idx" ON "customs_clients" USING btree ("broker_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_clients_importer_uq" ON "customs_clients" USING btree ("broker_org_id","importer_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_rules_org_key_uq" ON "customs_deadline_rules" USING btree ("broker_org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_deadlines_entry_rule_uq" ON "customs_deadlines" USING btree ("entry_id","rule_key");--> statement-breakpoint
CREATE INDEX "customs_deadlines_due_idx" ON "customs_deadlines" USING btree ("broker_org_id","due_at");--> statement-breakpoint
CREATE INDEX "customs_questions_entry_idx" ON "customs_questions" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "customs_reviews_entry_idx" ON "customs_reviews" USING btree ("entry_id");