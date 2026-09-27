CREATE TYPE "public"."appointment_kind" AS ENUM('inspection_hu', 'service', 'repair', 'tire_change', 'other');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('requested', 'proposed', 'confirmed', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."approval_kind" AS ENUM('offer', 'additional_work');--> statement-breakpoint
CREATE TYPE "public"."approval_request_status" AS ENUM('draft', 'pending_customer', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."checkout_status" AS ENUM('created', 'pending', 'paid', 'failed', 'expired', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."client_channel" AS ENUM('ios', 'android', 'web', 'windows');--> statement-breakpoint
CREATE TYPE "public"."customer_kind" AS ENUM('private', 'business');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('ios', 'android', 'web', 'windows');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('offer', 'invoice', 'intake_protocol', 'report', 'other');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('info', 'recommended', 'urgent', 'safety');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('new', 'reported', 'converted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."intake_confirmation_method" AS ENUM('on_site_signature', 'app', 'none');--> statement-breakpoint
CREATE TYPE "public"."invitation_purpose" AS ENUM('staff', 'customer');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."odometer_plausibility" AS ENUM('ok', 'lower_than_previous');--> statement-breakpoint
CREATE TYPE "public"."odometer_source" AS ENUM('intake', 'work_completion', 'customer', 'staff');--> statement-breakpoint
CREATE TYPE "public"."part_demand_status" AS ENUM('needed', 'ordered', 'received', 'installed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('sumup_online', 'bank_transfer', 'cash', 'card_terminal');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('sumup');--> statement-breakpoint
CREATE TYPE "public"."payment_provider_setting" AS ENUM('none', 'sumup');--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('dashboard.view', 'customers.read', 'customers.write', 'customerAccounts.manage', 'vehicles.read', 'vehicles.write', 'vehicles.transferOwnership', 'appointments.read', 'appointments.write', 'workOrders.read', 'workOrders.write', 'workOrders.completeReview', 'workItems.execute', 'intake.write', 'findings.write', 'approvals.request', 'documents.readInternal', 'documents.write', 'documents.publish', 'messages.customerChat', 'invoices.read', 'invoices.write', 'payments.recordManual', 'payments.refund', 'serviceHistory.read', 'serviceHistory.correct', 'reports.export', 'users.manage', 'settings.manage', 'audit.read');--> statement-breakpoint
CREATE TYPE "public"."photo_context" AS ENUM('intake', 'finding', 'work', 'chat', 'approval');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('open', 'accepted', 'declined', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."requested_by" AS ENUM('customer', 'staff');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('lift', 'bay', 'diagnosis', 'other');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'service', 'mechanic', 'customer');--> statement-breakpoint
CREATE TYPE "public"."service_entry_source" AS ENUM('work_completion');--> statement-breakpoint
CREATE TYPE "public"."service_entry_status" AS ENUM('valid', 'superseded', 'voided');--> statement-breakpoint
CREATE TYPE "public"."time_entry_source" AS ENUM('timer', 'manual');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('internal', 'customer');--> statement-breakpoint
CREATE TYPE "public"."work_item_authorization" AS ENUM('agreed', 'pending_approval', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."work_item_execution_status" AS ENUM('planned', 'in_progress', 'paused', 'done', 'not_done');--> statement-breakpoint
CREATE TYPE "public"."work_item_kind" AS ENUM('labor', 'part', 'flat_rate', 'other');--> statement-breakpoint
CREATE TYPE "public"."work_item_origin" AS ENUM('intake', 'offer', 'additional');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('draft', 'open', 'in_progress', 'work_completed', 'completed', 'picked_up', 'cancelled');--> statement-breakpoint
CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_accounts_customer_id_unique" UNIQUE("customer_id"),
	CONSTRAINT "customer_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "device_platform" NOT NULL,
	"push_token" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_push_token_unique" UNIQUE("push_token")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" "invitation_purpose" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_event_type_channel_pk" PRIMARY KEY("user_id","event_type","channel")
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"user_id" uuid NOT NULL,
	"permission" "permission" NOT NULL,
	"granted" boolean NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permission_overrides_user_id_permission_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text,
	"display_name" text NOT NULL,
	"role" "role" NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"default_interval_km" integer,
	"default_interval_months" integer,
	"interval_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "staff_working_hours_weekday" CHECK ("staff_working_hours"."weekday" BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE "workshop_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"street" text,
	"postal_code" text,
	"city" text,
	"phone" text,
	"email" text,
	"website" text,
	"vat_id" text,
	"iban" text,
	"bic" text,
	"bank_name" text,
	"opening_hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_term_days" integer DEFAULT 14 NOT NULL,
	"notification_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_provider" "payment_provider_setting" DEFAULT 'none' NOT NULL,
	"sumup_merchant_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workshop_settings_single_row" CHECK ("workshop_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_number" text NOT NULL,
	"kind" "customer_kind" NOT NULL,
	"salutation" text,
	"first_name" text,
	"last_name" text,
	"company_name" text,
	"email" "citext",
	"phone" text,
	"mobile" text,
	"street" text,
	"postal_code" text,
	"city" text,
	"country" char(2) DEFAULT 'DE' NOT NULL,
	"notes_internal" text,
	"archived_at" timestamp with time zone,
	"is_test_data" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_customer_number_unique" UNIQUE("customer_number")
);
--> statement-breakpoint
CREATE TABLE "odometer_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"value_km" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"source" "odometer_source" NOT NULL,
	"work_order_id" uuid,
	"recorded_by" uuid,
	"plausibility" "odometer_plausibility" DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "odometer_readings_value" CHECK ("odometer_readings"."value_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_ownerships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_ownerships_period" CHECK ("vehicle_ownerships"."ended_at" IS NULL OR "vehicle_ownerships"."ended_at" >= "vehicle_ownerships"."started_at")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_plate" text NOT NULL,
	"license_plate_normalized" text NOT NULL,
	"vin" text,
	"hsn" text,
	"tsn" text,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"variant" text,
	"first_registration" date,
	"fuel_type" text,
	"color" text,
	"notes_internal" text,
	"qr_token" text NOT NULL,
	"qr_public_view_enabled" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"is_test_data" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin"),
	CONSTRAINT "vehicles_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "appointment_assignees" (
	"appointment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "appointment_assignees_appointment_id_user_id_pk" PRIMARY KEY("appointment_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "appointment_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "proposal_status" DEFAULT 'open' NOT NULL,
	"message" text,
	"proposed_by" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "appointment_kind" NOT NULL,
	"status" "appointment_status" NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"work_order_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"resource_id" uuid,
	"requested_by" "requested_by" NOT NULL,
	"customer_note" text,
	"internal_note" text,
	"conflict_override_reason" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_period" CHECK ("appointments"."ends_at" > "appointments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "part_demands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"description" text NOT NULL,
	"part_number" text,
	"quantity" numeric(12, 3) DEFAULT 1 NOT NULL,
	"status" "part_demand_status" DEFAULT 'needed' NOT NULL,
	"expected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_runs_uq" UNIQUE("work_order_id","template_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"work_item_id" uuid,
	"description" text NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"status" "finding_status" DEFAULT 'new' NOT NULL,
	"reported_by" uuid NOT NULL,
	"reported_at" timestamp with time zone,
	"dictated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"odometer_km" integer,
	"fuel_level" text,
	"customer_complaint" text NOT NULL,
	"damages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agreed_services" text DEFAULT '' NOT NULL,
	"cost_limit_cents" integer,
	"notes_internal" text,
	"notes_customer" text,
	"confirmed_at" timestamp with time zone,
	"confirmation_method" "intake_confirmation_method" DEFAULT 'none' NOT NULL,
	"confirmed_by_user_id" uuid,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intakes_work_order_id_unique" UNIQUE("work_order_id")
);
--> statement-breakpoint
CREATE TABLE "parts_used" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"part_number" text,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price_cents" integer,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"context" "photo_context" NOT NULL,
	"finding_id" uuid,
	"visibility" "visibility" DEFAULT 'internal' NOT NULL,
	"caption" text,
	"taken_by" uuid,
	"taken_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" time_entry_source DEFAULT 'timer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "work_item_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"maintenance_type_id" uuid,
	"interval_km" integer,
	"interval_months" integer,
	"quantity" numeric(12, 3) DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'Stk' NOT NULL,
	"unit_price_cents" integer,
	"vat_rate_bp" integer DEFAULT 1900 NOT NULL,
	"origin" "work_item_origin" NOT NULL,
	"authorization" "work_item_authorization" NOT NULL,
	"execution_status" "work_item_execution_status" DEFAULT 'planned' NOT NULL,
	"approval_request_id" uuid,
	"approved_version_id" uuid,
	"assigned_to" uuid,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"done_odometer_km" integer,
	"result_notes" text,
	"not_done_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_assignees" (
	"work_order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "work_order_assignees_work_order_id_user_id_pk" PRIMARY KEY("work_order_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"status" "work_order_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description_customer" text,
	"notes_internal" text,
	"cost_limit_cents" integer,
	"planned_start" timestamp with time zone,
	"planned_end" timestamp with time zone,
	"ready_for_pickup_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"completion_reviewed_at" timestamp with time zone,
	"completion_reviewed_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"decided_by_user_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"channel" "client_channel" NOT NULL,
	"comment" text,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "approval_decisions_version_id_unique" UNIQUE("version_id")
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"title" text NOT NULL,
	"status" "approval_request_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"finding_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"summary_customer" text NOT NULL,
	"items" jsonb NOT NULL,
	"total_net_cents" integer NOT NULL,
	"total_gross_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"schedule_change" text,
	"new_ready_at" timestamp with time zone,
	"photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_version_id" uuid,
	"content_hash" text NOT NULL,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_versions_request_no_uq" UNIQUE("request_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "conversation_reads" (
	"work_order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_reads_work_order_id_user_id_pk" PRIMARY KEY("work_order_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_doc_no_uq" UNIQUE("document_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "document_kind" NOT NULL,
	"title" text NOT NULL,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"work_order_id" uuid,
	"visibility" "visibility" DEFAULT 'internal' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"current_version_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "internal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"message_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"photo_id" uuid,
	CONSTRAINT "message_attachments_message_id_file_id_pk" PRIMARY KEY("message_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"client_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "messages_author_client_id_uq" UNIQUE("author_user_id","client_message_id")
);
--> statement-breakpoint
CREATE TABLE "checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"checkout_reference" text NOT NULL,
	"provider_checkout_id" text,
	"amount_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"merchant_code" text NOT NULL,
	"status" "checkout_status" DEFAULT 'created' NOT NULL,
	"hosted_url" text,
	"valid_until" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"provider_transaction_id" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkouts_checkout_reference_unique" UNIQUE("checkout_reference"),
	CONSTRAINT "checkouts_provider_checkout_id_unique" UNIQUE("provider_checkout_id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text,
	"work_order_id" uuid,
	"customer_id" uuid NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp with time zone,
	"due_date" date,
	"total_gross_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"vat_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_total_positive" CHECK ("invoices"."total_gross_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"provider" "payment_provider",
	"provider_transaction_id" text,
	"checkout_id" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"reference_text" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_txn_uq" UNIQUE("provider","provider_transaction_id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"event_type" text NOT NULL,
	"provider_object_id" text,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"receive_count" integer DEFAULT 1 NOT NULL,
	"first_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"result" text,
	CONSTRAINT "provider_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "refund_status" DEFAULT 'requested' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_refund_id" text,
	"reason" text,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	CONSTRAINT "refunds_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "service_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"maintenance_type_id" uuid,
	"performed_on" date NOT NULL,
	"odometer_km" integer,
	"title" text NOT NULL,
	"details" text,
	"workshop_name" text NOT NULL,
	"interval_km" integer,
	"interval_months" integer,
	"next_due_date" date,
	"next_due_km" integer,
	"status" "service_entry_status" DEFAULT 'valid' NOT NULL,
	"revision_of_id" uuid,
	"revision_no" integer DEFAULT 1 NOT NULL,
	"correction_reason" text,
	"source" "service_entry_source" DEFAULT 'work_completion' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"include_vin" boolean DEFAULT false NOT NULL,
	"service_entry_ids" uuid[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_shares_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "role",
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_uq" UNIQUE("user_id","route","key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"target_path" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"dedupe_key" text NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_number" text,
	"description" text NOT NULL,
	"stock_quantity" numeric(12, 3) DEFAULT 0 NOT NULL,
	"minimum_quantity" numeric(12, 3),
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_car_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_car_id" uuid NOT NULL,
	"work_order_id" uuid,
	"customer_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"handover_notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_cars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_plate" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tire_storage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"season" text NOT NULL,
	"storage_location" text,
	"dimension" text,
	"dot" text,
	"tread_depths_mm" text,
	"stored_at" date,
	"returned_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_working_hours" ADD CONSTRAINT "staff_working_hours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_assignees" ADD CONSTRAINT "appointment_assignees_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_assignees" ADD CONSTRAINT "appointment_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_proposals" ADD CONSTRAINT "appointment_proposals_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_proposals" ADD CONSTRAINT "appointment_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_demands" ADD CONSTRAINT "part_demands_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_runs" ADD CONSTRAINT "checklist_runs_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts_used" ADD CONSTRAINT "parts_used_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts_used" ADD CONSTRAINT "parts_used_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_maintenance_type_id_maintenance_types_id_fk" FOREIGN KEY ("maintenance_type_id") REFERENCES "public"."maintenance_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_approved_version_id_approval_versions_id_fk" FOREIGN KEY ("approved_version_id") REFERENCES "public"."approval_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignees" ADD CONSTRAINT "work_order_assignees_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignees" ADD CONSTRAINT "work_order_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_completion_reviewed_by_users_id_fk" FOREIGN KEY ("completion_reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_version_id_approval_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."approval_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_current_version_id_approval_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."approval_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_versions" ADD CONSTRAINT "approval_versions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_versions" ADD CONSTRAINT "approval_versions_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_versions" ADD CONSTRAINT "approval_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_document_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_maintenance_type_id_maintenance_types_id_fk" FOREIGN KEY ("maintenance_type_id") REFERENCES "public"."maintenance_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_revision_of_id_service_entries_id_fk" FOREIGN KEY ("revision_of_id") REFERENCES "public"."service_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_shares" ADD CONSTRAINT "vehicle_shares_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_shares" ADD CONSTRAINT "vehicle_shares_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_shares" ADD CONSTRAINT "vehicle_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_car_bookings" ADD CONSTRAINT "loan_car_bookings_loan_car_id_loan_cars_id_fk" FOREIGN KEY ("loan_car_id") REFERENCES "public"."loan_cars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_car_bookings" ADD CONSTRAINT "loan_car_bookings_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_car_bookings" ADD CONSTRAINT "loan_car_bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_car_bookings" ADD CONSTRAINT "loan_car_bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tire_storage" ADD CONSTRAINT "tire_storage_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tire_storage" ADD CONSTRAINT "tire_storage_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_user_idx" ON "invitations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "customers_last_name_idx" ON "customers" USING btree ("last_name");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "odometer_readings_vehicle_idx" ON "odometer_readings" USING btree ("vehicle_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_ownerships_current_uq" ON "vehicle_ownerships" USING btree ("vehicle_id") WHERE "vehicle_ownerships"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "vehicle_ownerships_customer_idx" ON "vehicle_ownerships" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "vehicles_plate_idx" ON "vehicles" USING btree ("license_plate_normalized");--> statement-breakpoint
CREATE INDEX "appointment_proposals_appointment_idx" ON "appointment_proposals" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointments_time_idx" ON "appointments" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "appointments_customer_idx" ON "appointments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "part_demands_work_order_idx" ON "part_demands" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "findings_work_order_idx" ON "findings" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "parts_used_item_idx" ON "parts_used" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "photos_work_order_idx" ON "photos" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "photos_finding_idx" ON "photos" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "time_entries_item_idx" ON "time_entries" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_items_work_order_idx" ON "work_items" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "work_items_assigned_idx" ON "work_items" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "work_items_approval_request_idx" ON "work_items" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "work_order_assignees_user_idx" ON "work_order_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_orders_customer_idx" ON "work_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "work_orders_vehicle_idx" ON "work_orders" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "work_orders_status_idx" ON "work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_requests_work_order_idx" ON "approval_requests" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "documents_customer_idx" ON "documents" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "documents_work_order_idx" ON "documents" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "documents_vehicle_idx" ON "documents" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "internal_notes_work_order_idx" ON "internal_notes" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "messages_work_order_idx" ON "messages" USING btree ("work_order_id","created_at");--> statement-breakpoint
CREATE INDEX "checkouts_invoice_idx" ON "checkouts" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "checkouts_status_idx" ON "checkouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_work_order_idx" ON "invoices" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_entries_origin_uq" ON "service_entries" USING btree ("work_item_id") WHERE "service_entries"."revision_of_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "service_entries_revision_uq" ON "service_entries" USING btree ("revision_of_id") WHERE "service_entries"."revision_of_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "service_entries_vehicle_idx" ON "service_entries" USING btree ("vehicle_id","performed_on");--> statement-breakpoint
CREATE INDEX "vehicle_shares_vehicle_idx" ON "vehicle_shares" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","channel","created_at");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "loan_car_bookings_car_idx" ON "loan_car_bookings" USING btree ("loan_car_id","starts_at");--> statement-breakpoint
CREATE INDEX "tire_storage_customer_idx" ON "tire_storage" USING btree ("customer_id");