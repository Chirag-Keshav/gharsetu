-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ServiceMode" AS ENUM ('CARE', 'LIST', 'LIST_AND_CARE');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VerificationSubject" AS ENUM ('OWNER', 'PROPERTY');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DocumentOwnerType" AS ENUM ('VERIFICATION', 'PROVIDER');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'PUBLISHED', 'PAUSED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('INSTANT', 'OWNER_APPROVAL');

-- CreateEnum
CREATE TYPE "OccupancyKind" AS ENUM ('BOOKING_HOLD', 'BOOKING_CONFIRMED', 'BLOCK_OWNER', 'BLOCK_MAINTENANCE', 'BLOCK_ADMIN');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'AWAITING_PAYMENT', 'CONFIRMED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'ON_HOLD', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('STANDARD', 'URGENT', 'SAFETY_RISK');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'INSPECTION_SCHEDULED', 'QUOTATION_DRAFT', 'QUOTATION_SENT', 'APPROVED', 'WORK_ORDER_CREATED', 'REJECTED', 'CANCELLED', 'NOT_SERVICEABLE');

-- CreateEnum
CREATE TYPE "RequestSource" AS ENUM ('OWNER', 'ADMIN', 'TURNOVER_AUTO');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_ACCESS');

-- CreateEnum
CREATE TYPE "QuoteType" AS ENUM ('ORIGINAL', 'CHANGE_ORDER');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('LABOUR', 'MATERIAL', 'TRAVEL', 'INSPECTION_FEE', 'OTHER', 'DISCOUNT');

-- CreateEnum
CREATE TYPE "LineDirection" AS ENUM ('ADD', 'DEDUCT');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('INDIVIDUAL', 'GROUP');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProviderVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorkOrderKind" AS ENUM ('STANDARD', 'REWORK');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED_FOR_REVIEW', 'REWORK_REQUIRED', 'READY_FOR_OWNER_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BlockedReason" AS ENUM ('ACCESS_DENIED', 'HIDDEN_DAMAGE', 'MATERIAL_UNAVAILABLE', 'SAFETY_CONCERN', 'SCOPE_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('PRIMARY', 'SUPPORT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('INSPECTION_FEE', 'DEPOSIT', 'MILESTONE', 'FINAL');

-- CreateEnum
CREATE TYPE "DueTrigger" AS ENUM ('ON_INSPECTION_SCHEDULED', 'ON_QUOTE_APPROVAL', 'ON_WORK_SCHEDULED', 'ON_COMPLETION_ACCEPTED', 'MANUAL');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ThreadType" AS ENUM ('REQUEST', 'ISSUE', 'WORK_ORDER', 'BOOKING', 'LISTING_REVIEW');

-- CreateEnum
CREATE TYPE "MessageVisibility" AS ENUM ('PARTICIPANT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "AttachmentOwnerType" AS ENUM ('PROPERTY', 'LISTING', 'REQUEST', 'MESSAGE', 'INSPECTION', 'WORK_ORDER', 'ISSUE', 'VERIFICATION', 'PROVIDER');

-- CreateEnum
CREATE TYPE "EvidencePhase" AS ENUM ('GENERAL', 'BEFORE', 'DURING', 'AFTER');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "AttachmentSource" AS ENUM ('USER_UPLOAD', 'ADMIN_UPLOAD_FOR_PROVIDER');

-- CreateEnum
CREATE TYPE "AttachmentVisibility" AS ENUM ('PUBLIC', 'PARTICIPANT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "IssueSubjectType" AS ENUM ('WORK_ORDER', 'BOOKING');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ResolutionCode" AS ENUM ('REWORK_DONE', 'PARTIAL_REFUND', 'FULL_REFUND', 'PAYOUT_ADJUSTED', 'NO_ACTION_REQUIRED', 'DUPLICATE', 'RAISER_WITHDREW', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('MAINTENANCE_RECEIPT', 'MAINTENANCE_FINAL', 'BOOKING_RECEIPT', 'COMMISSION_STATEMENT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('PENDING', 'READY', 'ACCEPTED', 'EDITED', 'DISMISSED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(3),
    "email" TEXT,
    "full_name" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "permission_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "communication_prefs" JSONB NOT NULL DEFAULT '{}',
    "last_active_role" "Role",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "owner_profiles" (
    "user_id" UUID NOT NULL,
    "default_service_mode" "ServiceMode",
    "payout_account_ref" TEXT,
    "commission_override_bps" INTEGER,
    "commission_override_reason" TEXT,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "owner_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "active_role" "Role",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip_hash" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_areas" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "pin_codes" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "offers_stays" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "inspection_usually_required" BOOLEAN NOT NULL DEFAULT false,
    "intake_schema" JSONB NOT NULL,
    "danger_rules" JSONB NOT NULL DEFAULT '[]',
    "safety_notes" TEXT,
    "attachment_rules" JSONB NOT NULL DEFAULT '{}',
    "required_evidence" JSONB NOT NULL DEFAULT '{}',
    "payment_policy" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_service_areas" (
    "category_id" UUID NOT NULL,
    "service_area_id" UUID NOT NULL,

    CONSTRAINT "category_service_areas_pkey" PRIMARY KEY ("category_id","service_area_id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amenities" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "icon_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_policies" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "policy_settings" (
    "key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL,
    "description" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "nickname" TEXT NOT NULL,
    "property_type" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "locality" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pin_code" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "area_sqft" INTEGER,
    "access_notes" TEXT,
    "service_mode" "ServiceMode" NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'ACTIVE',
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_contacts" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "access_role" TEXT,
    "consent_confirmed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "property_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL,
    "subject_type" "VerificationSubject" NOT NULL,
    "subject_id" UUID NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "reason" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_documents" (
    "id" UUID NOT NULL,
    "owner_type" "DocumentOwnerType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "attachment_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "max_guests" INTEGER NOT NULL DEFAULT 2,
    "bedrooms" INTEGER NOT NULL DEFAULT 1,
    "beds" INTEGER NOT NULL DEFAULT 1,
    "bathrooms" INTEGER NOT NULL DEFAULT 1,
    "house_rules" JSONB NOT NULL DEFAULT '{}',
    "check_in_time" TEXT NOT NULL DEFAULT '14:00',
    "check_out_time" TEXT NOT NULL DEFAULT '11:00',
    "base_price_paise" BIGINT NOT NULL DEFAULT 0,
    "weekend_price_paise" BIGINT,
    "cleaning_fee_paise" BIGINT NOT NULL DEFAULT 0,
    "min_nights" INTEGER NOT NULL DEFAULT 1,
    "max_nights" INTEGER NOT NULL DEFAULT 30,
    "advance_notice_hours" INTEGER NOT NULL DEFAULT 24,
    "max_advance_days" INTEGER NOT NULL DEFAULT 365,
    "booking_mode" "BookingMode" NOT NULL DEFAULT 'INSTANT',
    "cancellation_policy_key" TEXT,
    "turnover_cleaning_enabled" BOOLEAN NOT NULL DEFAULT false,
    "public_area_label" TEXT NOT NULL DEFAULT '',
    "approx_latitude" DOUBLE PRECISION,
    "approx_longitude" DOUBLE PRECISION,
    "checkin_instructions" TEXT,
    "search_vector" tsvector,
    "rating_avg" DOUBLE PRECISION,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "paused_by" "Role",
    "edited_since_review" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_amenities" (
    "listing_id" UUID NOT NULL,
    "amenity_id" UUID NOT NULL,

    CONSTRAINT "listing_amenities_pkey" PRIMARY KEY ("listing_id","amenity_id")
);

-- CreateTable
CREATE TABLE "listing_photos" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "caption" TEXT,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "public_variants" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_price_rules" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "nightly_price_paise" BIGINT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_occupancy" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "kind" "OccupancyKind" NOT NULL,
    "booking_id" UUID,
    "work_order_id" UUID,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_occupancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "listing_id" UUID NOT NULL,
    "customer_user_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "check_in_date" DATE NOT NULL,
    "check_out_date" DATE NOT NULL,
    "check_in_at" TIMESTAMPTZ(3) NOT NULL,
    "check_out_at" TIMESTAMPTZ(3) NOT NULL,
    "nights" INTEGER NOT NULL,
    "guests_count" INTEGER NOT NULL,
    "special_requests" TEXT,
    "guest_details" JSONB,
    "booking_mode_snapshot" "BookingMode" NOT NULL,
    "cancellation_policy_snapshot" JSONB NOT NULL,
    "pricing_snapshot" JSONB NOT NULL,
    "nights_total_paise" BIGINT NOT NULL,
    "cleaning_fee_paise" BIGINT NOT NULL,
    "tax_paise" BIGINT NOT NULL,
    "total_paise" BIGINT NOT NULL,
    "commission_bps_applied" INTEGER NOT NULL,
    "commission_benchmark_snapshot" JSONB NOT NULL,
    "commission_paise" BIGINT NOT NULL,
    "owner_payout_paise" BIGINT NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(3),
    "request_expires_at" TIMESTAMPTZ(3),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_role" TEXT,
    "cancel_reason" TEXT,
    "refund_paise" BIGINT NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "booking_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL,
    "eligible_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "payment_reference" TEXT,
    "hold_reason" TEXT,
    "held_by_system" BOOLEAN NOT NULL DEFAULT false,
    "requires_dual_approval" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "recorded_by" UUID,
    "adjustment_paise" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "customer_user_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "hidden_reason" TEXT,
    "moderated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_benchmarks" (
    "id" UUID NOT NULL,
    "platform_name" TEXT NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "note" TEXT,
    "source_url" TEXT,
    "as_of_date" DATE NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "entered_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commission_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rate_history" (
    "id" UUID NOT NULL,
    "benchmark_bps" INTEGER,
    "effective_bps" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "changed_by" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "intake_answers" JSONB NOT NULL DEFAULT '{}',
    "urgency" "Urgency" NOT NULL DEFAULT 'STANDARD',
    "safety_flag" BOOLEAN NOT NULL DEFAULT false,
    "safety_guidance_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RequestStatus" NOT NULL,
    "preferred_windows" JSONB NOT NULL DEFAULT '[]',
    "access_contact_id" UUID,
    "handled_by_admin_id" UUID,
    "created_on_behalf_by" UUID,
    "source" "RequestSource" NOT NULL DEFAULT 'OWNER',
    "override_reason" TEXT,
    "booking_id" UUID,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_response_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "scheduled_start" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end" TIMESTAMPTZ(3) NOT NULL,
    "provider_id" UUID,
    "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "fee_paise" BIGINT NOT NULL DEFAULT 0,
    "findings" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "quote_type" "QuoteType" NOT NULL DEFAULT 'ORIGINAL',
    "work_order_id" UUID,
    "base_quote_id" UUID,
    "version" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal_paise" BIGINT NOT NULL DEFAULT 0,
    "tax_paise" BIGINT NOT NULL DEFAULT 0,
    "total_paise" BIGINT NOT NULL DEFAULT 0,
    "scope" TEXT,
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "estimated_duration" TEXT,
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "sent_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "approved_total_paise" BIGINT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line_items" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price_paise" BIGINT NOT NULL,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "line_total_paise" BIGINT NOT NULL,
    "line_tax_paise" BIGINT NOT NULL,
    "line_type" "LineType" NOT NULL,
    "direction" "LineDirection" NOT NULL,
    "internal_cost_paise" BIGINT,

    CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_decisions" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "displayed_total_paise" BIGINT,
    "reason" TEXT,
    "request_revision" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_providers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider_type" "ProviderType" NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "verification_status" "ProviderVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "availability_notes" TEXT,
    "internal_notes" TEXT,
    "internal_rating" INTEGER,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_skills" (
    "provider_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "provider_skills_pkey" PRIMARY KEY ("provider_id","category_id")
);

-- CreateTable
CREATE TABLE "provider_service_areas" (
    "provider_id" UUID NOT NULL,
    "service_area_id" UUID NOT NULL,

    CONSTRAINT "provider_service_areas_pkey" PRIMARY KEY ("provider_id","service_area_id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "WorkOrderKind" NOT NULL DEFAULT 'STANDARD',
    "request_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "quote_id" UUID,
    "parent_work_order_id" UUID,
    "issue_id" UUID,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_start" TIMESTAMPTZ(3),
    "scheduled_end" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "owner_review_due_at" TIMESTAMPTZ(3),
    "approved_total_paise" BIGINT NOT NULL DEFAULT 0,
    "blocked_reason" "BlockedReason",
    "checklist_template_id" UUID,
    "checklist_version" INTEGER,
    "completion_override" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_assignments" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "assignment_role" "AssignmentRole" NOT NULL DEFAULT 'PRIMARY',
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "override_reason" TEXT,
    "internal_notes" TEXT,

    CONSTRAINT "work_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_visits" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "recorded_by" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "checked_in_at" TIMESTAMPTZ(3) NOT NULL,
    "checked_out_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_checklist_results" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "item_key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "notes" TEXT,
    "recorded_by" UUID NOT NULL,
    "provider_id" UUID,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_checklist_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requirements" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "work_order_id" UUID,
    "purpose" "PaymentPurpose" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "due_trigger" "DueTrigger" NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'PENDING',
    "is_due" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "thread_type" "ThreadType" NOT NULL,
    "thread_id" UUID NOT NULL,
    "author_user_id" UUID,
    "author_role" TEXT,
    "body" TEXT NOT NULL,
    "visibility" "MessageVisibility" NOT NULL DEFAULT 'PARTICIPANT',
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "owner_type" "AttachmentOwnerType" NOT NULL,
    "owner_id" UUID,
    "evidence_phase" "EvidencePhase" NOT NULL DEFAULT 'GENERAL',
    "object_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "uploaded_by" UUID NOT NULL,
    "source" "AttachmentSource" NOT NULL DEFAULT 'USER_UPLOAD',
    "recorded_for_provider_id" UUID,
    "visibility" "AttachmentVisibility" NOT NULL DEFAULT 'PARTICIPANT',
    "captured_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "subject_type" "IssueSubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "customer_user_id" UUID,
    "raised_by_user_id" UUID NOT NULL,
    "raised_by_role" "Role" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "handled_by_admin_id" UUID,
    "resolution_code" "ResolutionCode",
    "internal_note" TEXT,
    "visible_summary" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "requirement_id" UUID,
    "booking_id" UUID,
    "payer_user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "refunded_paise" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "checkout_url" TEXT,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "idempotency_key" TEXT,
    "recorded_by" UUID,
    "offline_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "payload_hash" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "processing_note" TEXT,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "provider_refund_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "request_id" UUID,
    "work_order_id" UUID,
    "booking_id" UUID,
    "payment_id" UUID,
    "owner_user_id" UUID,
    "recipient_user_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "tax_metadata" JSONB NOT NULL DEFAULT '{}',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "document_key" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template_key" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "provider_ref" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "outbox_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_events" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT NOT NULL,
    "reason" TEXT,
    "owner_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "on_behalf_of_type" TEXT,
    "on_behalf_of_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_hash" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_alerts" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" UUID,
    "audience_role" "Role" NOT NULL,
    "requested_by" UUID,
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "prompt_version" TEXT,
    "input_hash" TEXT NOT NULL,
    "output" JSONB,
    "error_code" TEXT,
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "acted_by" UUID,
    "acted_at" TIMESTAMPTZ(3),
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "usage_date" DATE NOT NULL,
    "user_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("usage_date","user_id","feature_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_e164_created_at_idx" ON "otp_challenges"("phone_e164", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_endpoint_key_key" ON "idempotency_keys"("user_id", "endpoint", "key");

-- CreateIndex
CREATE INDEX "consent_records_user_id_idx" ON "consent_records"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_slug_key" ON "service_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_category_id_version_key" ON "checklist_templates"("category_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "amenities_slug_key" ON "amenities"("slug");

-- CreateIndex
CREATE INDEX "properties_owner_user_id_idx" ON "properties"("owner_user_id");

-- CreateIndex
CREATE INDEX "property_contacts_property_id_idx" ON "property_contacts"("property_id");

-- CreateIndex
CREATE INDEX "verifications_subject_type_subject_id_idx" ON "verifications"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "verifications_status_idx" ON "verifications"("status");

-- CreateIndex
CREATE INDEX "verification_documents_owner_type_owner_id_idx" ON "verification_documents"("owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "listings_reference_key" ON "listings"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "listings_property_id_key" ON "listings"("property_id");

-- CreateIndex
CREATE INDEX "listings_status_idx" ON "listings"("status");

-- CreateIndex
CREATE INDEX "listings_owner_user_id_idx" ON "listings"("owner_user_id");

-- CreateIndex
CREATE INDEX "listing_photos_listing_id_idx" ON "listing_photos"("listing_id");

-- CreateIndex
CREATE INDEX "listing_price_rules_listing_id_idx" ON "listing_price_rules"("listing_id");

-- CreateIndex
CREATE INDEX "listing_occupancy_listing_id_start_date_idx" ON "listing_occupancy"("listing_id", "start_date");

-- CreateIndex
CREATE INDEX "listing_occupancy_booking_id_idx" ON "listing_occupancy"("booking_id");

-- CreateIndex
CREATE INDEX "listing_occupancy_work_order_id_idx" ON "listing_occupancy"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- CreateIndex
CREATE INDEX "bookings_customer_user_id_idx" ON "bookings"("customer_user_id");

-- CreateIndex
CREATE INDEX "bookings_owner_user_id_idx" ON "bookings"("owner_user_id");

-- CreateIndex
CREATE INDEX "bookings_listing_id_idx" ON "bookings"("listing_id");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_reference_key" ON "payouts"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_booking_id_key" ON "payouts"("booking_id");

-- CreateIndex
CREATE INDEX "payouts_owner_user_id_idx" ON "payouts"("owner_user_id");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");

-- CreateIndex
CREATE INDEX "reviews_listing_id_idx" ON "reviews"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_reference_key" ON "service_requests"("reference");

-- CreateIndex
CREATE INDEX "service_requests_owner_user_id_idx" ON "service_requests"("owner_user_id");

-- CreateIndex
CREATE INDEX "service_requests_status_idx" ON "service_requests"("status");

-- CreateIndex
CREATE INDEX "service_requests_property_id_idx" ON "service_requests"("property_id");

-- CreateIndex
CREATE INDEX "inspections_request_id_idx" ON "inspections"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_reference_key" ON "quotes"("reference");

-- CreateIndex
CREATE INDEX "quotes_work_order_id_idx" ON "quotes"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_request_id_quote_type_version_key" ON "quotes"("request_id", "quote_type", "version");

-- CreateIndex
CREATE INDEX "quote_line_items_quote_id_idx" ON "quote_line_items"("quote_id");

-- CreateIndex
CREATE INDEX "quote_decisions_quote_id_idx" ON "quote_decisions"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_reference_key" ON "work_orders"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_quote_id_key" ON "work_orders"("quote_id");

-- CreateIndex
CREATE INDEX "work_orders_owner_user_id_idx" ON "work_orders"("owner_user_id");

-- CreateIndex
CREATE INDEX "work_orders_status_idx" ON "work_orders"("status");

-- CreateIndex
CREATE INDEX "work_orders_request_id_idx" ON "work_orders"("request_id");

-- CreateIndex
CREATE INDEX "work_assignments_work_order_id_idx" ON "work_assignments"("work_order_id");

-- CreateIndex
CREATE INDEX "work_assignments_provider_id_idx" ON "work_assignments"("provider_id");

-- CreateIndex
CREATE INDEX "work_visits_work_order_id_idx" ON "work_visits"("work_order_id");

-- CreateIndex
CREATE INDEX "work_checklist_results_work_order_id_idx" ON "work_checklist_results"("work_order_id");

-- CreateIndex
CREATE INDEX "payment_requirements_request_id_idx" ON "payment_requirements"("request_id");

-- CreateIndex
CREATE INDEX "payment_requirements_work_order_id_idx" ON "payment_requirements"("work_order_id");

-- CreateIndex
CREATE INDEX "messages_thread_type_thread_id_created_at_idx" ON "messages"("thread_type", "thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_object_key_key" ON "attachments"("object_key");

-- CreateIndex
CREATE INDEX "attachments_owner_type_owner_id_idx" ON "attachments"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "attachments_uploaded_by_idx" ON "attachments"("uploaded_by");

-- CreateIndex
CREATE UNIQUE INDEX "issues_reference_key" ON "issues"("reference");

-- CreateIndex
CREATE INDEX "issues_subject_type_subject_id_idx" ON "issues"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "issues_owner_user_id_idx" ON "issues"("owner_user_id");

-- CreateIndex
CREATE INDEX "issues_customer_user_id_idx" ON "issues"("customer_user_id");

-- CreateIndex
CREATE INDEX "issues_status_idx" ON "issues"("status");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_requirement_id_idx" ON "payments"("requirement_id");

-- CreateIndex
CREATE INDEX "payments_payer_user_id_idx" ON "payments"("payer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_provider_event_id_key" ON "payment_events"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_reference_key" ON "invoices"("reference");

-- CreateIndex
CREATE INDEX "invoices_recipient_user_id_idx" ON "invoices"("recipient_user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_outbox_event_id_user_id_channel_template_key_key" ON "notifications"("outbox_event_id", "user_id", "channel", "template_key");

-- CreateIndex
CREATE INDEX "outbox_events_dispatched_at_next_attempt_at_idx" ON "outbox_events"("dispatched_at", "next_attempt_at");

-- CreateIndex
CREATE INDEX "status_events_entity_type_entity_id_created_at_idx" ON "status_events"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- CreateIndex
CREATE INDEX "admin_alerts_resolved_at_idx" ON "admin_alerts"("resolved_at");

-- CreateIndex
CREATE INDEX "ai_suggestions_subject_type_subject_id_idx" ON "ai_suggestions"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "ai_suggestions_feature_key_input_hash_idx" ON "ai_suggestions"("feature_key", "input_hash");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_profiles" ADD CONSTRAINT "owner_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_service_areas" ADD CONSTRAINT "category_service_areas_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_service_areas" ADD CONSTRAINT "category_service_areas_service_area_id_fkey" FOREIGN KEY ("service_area_id") REFERENCES "service_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_amenities" ADD CONSTRAINT "listing_amenities_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_amenities" ADD CONSTRAINT "listing_amenities_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_price_rules" ADD CONSTRAINT "listing_price_rules_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_occupancy" ADD CONSTRAINT "listing_occupancy_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_decisions" ADD CONSTRAINT "quote_decisions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_skills" ADD CONSTRAINT "provider_skills_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_skills" ADD CONSTRAINT "provider_skills_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_service_areas" ADD CONSTRAINT "provider_service_areas_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_service_areas" ADD CONSTRAINT "provider_service_areas_service_area_id_fkey" FOREIGN KEY ("service_area_id") REFERENCES "service_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignments" ADD CONSTRAINT "work_assignments_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignments" ADD CONSTRAINT "work_assignments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_visits" ADD CONSTRAINT "work_visits_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_checklist_results" ADD CONSTRAINT "work_checklist_results_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requirements" ADD CONSTRAINT "payment_requirements_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "payment_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

