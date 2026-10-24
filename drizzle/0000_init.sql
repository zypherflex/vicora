CREATE TYPE "public"."charge_kind" AS ENUM('RECEIVABLE', 'PAYABLE');--> statement-breakpoint
CREATE TYPE "public"."charge_status" AS ENUM('ESTIMATED', 'CONFIRMED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."compliance_status" AS ENUM('UNVERIFIED', 'PENDING_REVIEW', 'VERIFIED', 'EXPIRED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."customs_status" AS ENUM('INTAKE', 'DOCS_PENDING', 'IN_REVIEW', 'READY_TO_FILE', 'SUBMITTED', 'RELEASED', 'HOLD', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."exception_type" AS ENUM('DELAY', 'DAMAGE', 'MISSING_DOCUMENT', 'CUSTOMS_HOLD', 'EQUIPMENT_FAILURE', 'ACCESS_ISSUE', 'STALE_TRACKING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."leg_status" AS ENUM('PLANNED', 'TENDERED', 'ACCEPTED', 'DISPATCHED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DELIVERY', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."location_source" AS ENUM('LIVE_GPS', 'MANUAL', 'DEMO');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('SHIPPER', 'CUSTOMS_BROKER', 'FREIGHT_BROKER', 'CARRIER', 'AUTO_TRANSPORT');--> statement-breakpoint
CREATE TYPE "public"."party_role" AS ENUM('CUSTOMER', 'PRIMARY_PROVIDER', 'CARRIER', 'CUSTOMS_BROKER');--> statement-breakpoint
CREATE TYPE "public"."payable_status" AS ENUM('PENDING_POD', 'APPROVED', 'PAID', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('SUBMITTED', 'WITHDRAWN', 'ACCEPTED', 'DECLINED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('FTL', 'LTL', 'AUTO_TRANSPORT', 'INTERMODAL', 'PORT_TO_DOOR');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('DRAFT', 'QUOTE_REQUESTED', 'BOOKED', 'ASSIGNED', 'DISPATCHED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."tender_status" AS ENUM('OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('SHARED', 'INTERNAL');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"kind" charge_kind NOT NULL,
	"biller_org_id" uuid NOT NULL,
	"bill_to_org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"quantity_milli" integer DEFAULT 1000 NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" charge_status DEFAULT 'ESTIMATED' NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid,
	"invoice_id" uuid,
	"created_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"identifier" text,
	"status" "compliance_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"source" text DEFAULT 'SELF_REPORTED' NOT NULL,
	"coverage_minor" bigint,
	"currency" text DEFAULT 'USD',
	"effective_date" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"document_id" uuid,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"verified_by_org_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customs_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"broker_org_id" uuid NOT NULL,
	"status" "customs_status" DEFAULT 'INTAKE' NOT NULL,
	"assigned_to_user_id" uuid,
	"port_of_entry" text,
	"arrival_at" timestamp with time zone,
	"importer_name" text,
	"declared_value_minor" bigint,
	"currency" text DEFAULT 'USD',
	"country_of_origin" text,
	"gross_weight_kg" integer,
	"broker_notes" text,
	"filing_adapter" text DEFAULT 'NOT_CONNECTED' NOT NULL,
	"filing_reference" text,
	"filing_submitted_at" timestamp with time zone,
	"filing_submitted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customs_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"description" text NOT NULL,
	"hts_code" text,
	"quantity" integer,
	"value_minor" bigint,
	"country_of_origin" text,
	"broker_reviewed" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"source_extraction_id" uuid
);
--> statement-breakpoint
CREATE TABLE "document_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"org_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" "review_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"approved_fields" jsonb,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"requested_by_org_id" uuid NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"document_id" uuid,
	"due_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"shipment_id" uuid,
	"subject_org_id" uuid,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"visibility" "visibility" DEFAULT 'SHARED' NOT NULL,
	"customer_visible" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'UPLOADED' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"retention_until" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"phone" text,
	"license_state" text,
	"license_expires_at" timestamp with time zone,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"unit_number" text NOT NULL,
	"type" text NOT NULL,
	"vehicle_capacity" integer,
	"max_weight_lb" integer,
	"plate" text,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"available_from" timestamp with time zone,
	"current_city" text,
	"current_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_damages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"photo_document_id" uuid,
	"area" text NOT NULL,
	"damage_type" text NOT NULL,
	"severity" text DEFAULT 'MINOR' NOT NULL,
	"x" double precision,
	"y" double precision,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"performed_by" uuid,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"odometer" integer,
	"notes" text,
	"signer_name" text,
	"signature_document_id" uuid,
	"lat" double precision,
	"lng" double precision
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"roles" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"charge_id" uuid,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"quantity_milli" integer NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"issuer_org_id" uuid NOT NULL,
	"bill_to_org_id" uuid NOT NULL,
	"shipment_id" uuid,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"credits_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"amount_paid_minor" bigint DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"memo" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "location_pings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"leg_id" uuid,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" integer,
	"source" "location_source" NOT NULL,
	"label" text,
	"reported_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"roles" text[] NOT NULL,
	"grants" text[] DEFAULT '{}'::text[] NOT NULL,
	"revocations" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"author_user_id" uuid,
	"visibility" "visibility" DEFAULT 'SHARED' NOT NULL,
	"body" text NOT NULL,
	"ai_drafted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_preferences_user_id_event_type_pk" PRIMARY KEY("user_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"shipment_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "org_type" NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"document_retention_days" integer DEFAULT 2555 NOT NULL,
	"city" text,
	"state" text,
	"phone" text,
	"usdot_number" text,
	"mc_number" text,
	"customs_filer_code" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payer_org_id" uuid NOT NULL,
	"payee_org_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"leg_id" uuid,
	"tender_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "payable_status" DEFAULT 'PENDING_POD' NOT NULL,
	"due_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"reference" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payer_org_id" uuid NOT NULL,
	"payee_org_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"is_sandbox" boolean DEFAULT true NOT NULL,
	"failure_reason" text,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "provider_profiles" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"service_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"equipment_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"service_states" text[] DEFAULT '{}'::text[] NOT NULL,
	"accepting_loads" boolean DEFAULT true NOT NULL,
	"on_time_pct" integer,
	"completed_loads" integer DEFAULT 0 NOT NULL,
	"about" text
);
--> statement-breakpoint
CREATE TABLE "quote_invitations" (
	"shipment_id" uuid NOT NULL,
	"provider_org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_invitations_shipment_id_provider_org_id_pk" PRIMARY KEY("shipment_id","provider_org_id")
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"quantity_milli" integer DEFAULT 1000 NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"provider_org_id" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'SUBMITTED' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"total_minor" bigint NOT NULL,
	"estimated_cost_minor" bigint,
	"transit_days" integer,
	"valid_until" timestamp with time zone,
	"notes" text,
	"submitted_by" uuid,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"active_org_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"leg_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"actor_org_id" uuid,
	"visible_to_org_id" uuid,
	"customer_tracking" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"leg_id" uuid,
	"vehicle_id" uuid,
	"type" "exception_type" NOT NULL,
	"severity" text DEFAULT 'MEDIUM' NOT NULL,
	"status" "exception_status" DEFAULT 'OPEN' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"opened_by_user_id" uuid,
	"opened_by_org_id" uuid,
	"detected_by" text DEFAULT 'USER' NOT NULL,
	"assigned_to_user_id" uuid,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"packaging" text DEFAULT 'PALLET' NOT NULL,
	"length_in" integer,
	"width_in" integer,
	"height_in" integer,
	"weight_lb" integer NOT NULL,
	"freight_class" text,
	"stackable" boolean DEFAULT true NOT NULL,
	"hazmat" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"mode" text DEFAULT 'TRUCK' NOT NULL,
	"from_stop_id" uuid,
	"to_stop_id" uuid,
	"executor_org_id" uuid,
	"manager_org_id" uuid,
	"status" "leg_status" DEFAULT 'PLANNED' NOT NULL,
	"driver_id" uuid,
	"equipment_id" uuid,
	"carrier_rate_minor" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"planned_pickup_at" timestamp with time zone,
	"planned_delivery_at" timestamp with time zone,
	"actual_pickup_at" timestamp with time zone,
	"actual_delivery_at" timestamp with time zone,
	"eta_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_parties" (
	"shipment_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "party_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_parties_shipment_id_org_id_role_pk" PRIMARY KEY("shipment_id","org_id","role")
);
--> statement-breakpoint
CREATE TABLE "shipment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"from_status" "shipment_status",
	"to_status" "shipment_status" NOT NULL,
	"actor_user_id" uuid,
	"actor_org_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"address1" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text,
	"country" text DEFAULT 'US' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"contact_name" text,
	"contact_phone" text,
	"reference" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"created_by" uuid,
	"service_type" "service_type" NOT NULL,
	"requires_customs" boolean DEFAULT false NOT NULL,
	"status" "shipment_status" DEFAULT 'DRAFT' NOT NULL,
	"title" text NOT NULL,
	"customer_reference" text,
	"commodity" text,
	"total_weight_lb" integer,
	"total_pieces" integer,
	"equipment_type" text,
	"accessorials" text[] DEFAULT '{}'::text[] NOT NULL,
	"hazmat" boolean DEFAULT false NOT NULL,
	"temperature_min_f" integer,
	"temperature_max_f" integer,
	"special_instructions" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"quote_visibility" text DEFAULT 'MARKETPLACE' NOT NULL,
	"target_budget_minor" bigint,
	"accepted_quote_id" uuid,
	"primary_provider_org_id" uuid,
	"port_of_entry" text,
	"vessel_voyage" text,
	"container_number" text,
	"bill_of_lading_number" text,
	"country_of_origin" text,
	"port_eta" timestamp with time zone,
	"cancelled_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shipment_id" uuid,
	"customs_entry_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"assignee_user_id" uuid,
	"due_at" timestamp with time zone,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"leg_id" uuid NOT NULL,
	"from_org_id" uuid NOT NULL,
	"to_org_id" uuid NOT NULL,
	"rate_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "tender_status" DEFAULT 'OFFERED' NOT NULL,
	"notes" text,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"responded_by" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"label" text,
	"created_by_user_id" uuid,
	"created_by_org_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"driver_id" uuid,
	"equipment_id" uuid,
	"capacity" integer NOT NULL,
	"planned_start" timestamp with time zone,
	"planned_end" timestamp with time zone,
	"status" text DEFAULT 'PLANNING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"phone" text,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "shipment_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"vin" text NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"color" text,
	"operable" boolean DEFAULT true NOT NULL,
	"transport_type" text DEFAULT 'OPEN' NOT NULL,
	"auction_reference" text,
	"dealership_reference" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"trip_id" uuid,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_biller_org_id_organizations_id_fk" FOREIGN KEY ("biller_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_bill_to_org_id_organizations_id_fk" FOREIGN KEY ("bill_to_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_subject_org_id_organizations_id_fk" FOREIGN KEY ("subject_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_verified_by_org_id_organizations_id_fk" FOREIGN KEY ("verified_by_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_entries" ADD CONSTRAINT "customs_entries_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_entries" ADD CONSTRAINT "customs_entries_broker_org_id_organizations_id_fk" FOREIGN KEY ("broker_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_entries" ADD CONSTRAINT "customs_entries_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_entries" ADD CONSTRAINT "customs_entries_filing_submitted_by_users_id_fk" FOREIGN KEY ("filing_submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_lines" ADD CONSTRAINT "customs_lines_entry_id_customs_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."customs_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_lines" ADD CONSTRAINT "customs_lines_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_requested_by_org_id_organizations_id_fk" FOREIGN KEY ("requested_by_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_subject_org_id_organizations_id_fk" FOREIGN KEY ("subject_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_damages" ADD CONSTRAINT "inspection_damages_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_vehicle_id_shipment_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."shipment_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issuer_org_id_organizations_id_fk" FOREIGN KEY ("issuer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bill_to_org_id_organizations_id_fk" FOREIGN KEY ("bill_to_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_payer_org_id_organizations_id_fk" FOREIGN KEY ("payer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_payee_org_id_organizations_id_fk" FOREIGN KEY ("payee_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_org_id_organizations_id_fk" FOREIGN KEY ("payer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payee_org_id_organizations_id_fk" FOREIGN KEY ("payee_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_invitations" ADD CONSTRAINT "quote_invitations_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_invitations" ADD CONSTRAINT "quote_invitations_provider_org_id_organizations_id_fk" FOREIGN KEY ("provider_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_provider_org_id_organizations_id_fk" FOREIGN KEY ("provider_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_actor_org_id_organizations_id_fk" FOREIGN KEY ("actor_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_opened_by_org_id_organizations_id_fk" FOREIGN KEY ("opened_by_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_from_stop_id_shipment_stops_id_fk" FOREIGN KEY ("from_stop_id") REFERENCES "public"."shipment_stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_to_stop_id_shipment_stops_id_fk" FOREIGN KEY ("to_stop_id") REFERENCES "public"."shipment_stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_executor_org_id_organizations_id_fk" FOREIGN KEY ("executor_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_manager_org_id_organizations_id_fk" FOREIGN KEY ("manager_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_parties" ADD CONSTRAINT "shipment_parties_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_parties" ADD CONSTRAINT "shipment_parties_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_status_history" ADD CONSTRAINT "shipment_status_history_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_status_history" ADD CONSTRAINT "shipment_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_status_history" ADD CONSTRAINT "shipment_status_history_actor_org_id_organizations_id_fk" FOREIGN KEY ("actor_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_stops" ADD CONSTRAINT "shipment_stops_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_primary_provider_org_id_organizations_id_fk" FOREIGN KEY ("primary_provider_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_leg_id_shipment_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."shipment_legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_from_org_id_organizations_id_fk" FOREIGN KEY ("from_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_to_org_id_organizations_id_fk" FOREIGN KEY ("to_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_created_by_org_id_organizations_id_fk" FOREIGN KEY ("created_by_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_vehicles" ADD CONSTRAINT "shipment_vehicles_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_vehicles" ADD CONSTRAINT "shipment_vehicles_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "charges_shipment_idx" ON "charges" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "compliance_subject_idx" ON "compliance_records" USING btree ("subject_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_shipment_broker_uq" ON "customs_entries" USING btree ("shipment_id","broker_org_id");--> statement-breakpoint
CREATE INDEX "extractions_document_idx" ON "document_extractions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_req_shipment_idx" ON "document_requirements" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_versions_uq" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "documents_shipment_idx" ON "documents" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "drivers_org_idx" ON "drivers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "equipment_org_idx" ON "equipment" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "inspections_vehicle_idx" ON "inspections" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_issuer_number_uq" ON "invoices" USING btree ("issuer_org_id","number");--> statement-breakpoint
CREATE INDEX "invoices_bill_to_idx" ON "invoices" USING btree ("bill_to_org_id");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "pings_shipment_idx" ON "location_pings" USING btree ("shipment_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_shipment_idx" ON "messages" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payables_payer_idx" ON "payables" USING btree ("payer_org_id");--> statement-breakpoint
CREATE INDEX "payables_payee_idx" ON "payables" USING btree ("payee_org_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "quotes_shipment_idx" ON "quotes" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "quotes_provider_idx" ON "quotes" USING btree ("provider_org_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_shipment_idx" ON "shipment_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "exceptions_shipment_idx" ON "shipment_exceptions" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "items_shipment_idx" ON "shipment_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "legs_shipment_idx" ON "shipment_legs" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "legs_executor_idx" ON "shipment_legs" USING btree ("executor_org_id");--> statement-breakpoint
CREATE INDEX "parties_org_idx" ON "shipment_parties" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "status_history_shipment_idx" ON "shipment_status_history" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "stops_shipment_idx" ON "shipment_stops" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipments_owner_idx" ON "shipments" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_org_idx" ON "tasks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tenders_to_idx" ON "tenders" USING btree ("to_org_id");--> statement-breakpoint
CREATE INDEX "tenders_shipment_idx" ON "tenders" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "tracking_links_shipment_idx" ON "tracking_links" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "trips_org_idx" ON "trips" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "vehicles_shipment_idx" ON "shipment_vehicles" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "vehicles_trip_idx" ON "shipment_vehicles" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_provider_event_uq" ON "webhook_events" USING btree ("provider","event_id");