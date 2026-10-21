/** Enumerations shared by API and web. Values mirror the Prisma enums (asserted by an API test). */

export const ROLES = ['OWNER', 'CUSTOMER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];
export const SELF_SERVICE_ROLES = ['OWNER', 'CUSTOMER'] as const;
export type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number];

export const PERMISSION_FLAGS = [
  'LISTING_REVIEW',
  'QUOTE_DISCOUNT_APPROVE',
  'COMPLETION_APPROVE',
  'ASSIGNMENT_OVERRIDE',
  'FINANCE',
  'AUDIT_VIEW',
  'CATALOG_ADMIN',
  'USER_ADMIN',
  'AI_ADMIN',
] as const;
export type PermissionFlag = (typeof PERMISSION_FLAGS)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const SERVICE_MODES = ['CARE', 'LIST', 'LIST_AND_CARE'] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];
export const modeIncludesCare = (m: ServiceMode) => m === 'CARE' || m === 'LIST_AND_CARE';
export const modeIncludesList = (m: ServiceMode) => m === 'LIST' || m === 'LIST_AND_CARE';

export const PROPERTY_TYPES = [
  'APARTMENT',
  'INDEPENDENT_HOUSE',
  'VILLA',
  'FARMHOUSE',
  'COTTAGE',
  'HOMESTAY',
  'SERVICED_APARTMENT',
  'OTHER',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

export const VERIFICATION_SUBJECTS = ['OWNER', 'PROPERTY'] as const;
export type VerificationSubject = (typeof VERIFICATION_SUBJECTS)[number];
export const VERIFICATION_STATUSES = ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
/** Admin-configurable in a later version; seeded here (SPEC §8.2). */
export const OWNER_DOCUMENT_TYPES = ['GOVERNMENT_ID'] as const;
export const PROPERTY_DOCUMENT_TYPES = ['TITLE_OR_SALE_DEED', 'PROPERTY_TAX_RECEIPT', 'UTILITY_BILL', 'AUTHORISATION_LETTER'] as const;

export const LISTING_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'PUBLISHED',
  'PAUSED',
  'REJECTED',
  'ARCHIVED',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const BOOKING_MODES = ['INSTANT', 'OWNER_APPROVAL'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const OCCUPANCY_KINDS = [
  'BOOKING_HOLD',
  'BOOKING_CONFIRMED',
  'BLOCK_OWNER',
  'BLOCK_MAINTENANCE',
  'BLOCK_ADMIN',
] as const;
export type OccupancyKind = (typeof OCCUPANCY_KINDS)[number];

export const BOOKING_STATUSES = [
  'REQUESTED',
  'AWAITING_PAYMENT',
  'CONFIRMED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'COMPLETED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYOUT_STATUSES = ['PENDING', 'ELIGIBLE', 'ON_HOLD', 'PAID', 'VOID'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const REVIEW_STATUSES = ['PUBLISHED', 'HIDDEN'] as const;

export const URGENCIES = ['STANDARD', 'URGENT', 'SAFETY_RISK'] as const;
export type Urgency = (typeof URGENCIES)[number];
export const urgencyRank = (u: Urgency) => URGENCIES.indexOf(u);
/** Returns the higher of two urgencies; urgency can be raised but never lowered (SPEC §7 rule 8). */
export const maxUrgency = (a: Urgency, b: Urgency): Urgency => (urgencyRank(a) >= urgencyRank(b) ? a : b);

export const REQUEST_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_INFORMATION',
  'INSPECTION_SCHEDULED',
  'QUOTATION_DRAFT',
  'QUOTATION_SENT',
  'APPROVED',
  'WORK_ORDER_CREATED',
  'REJECTED',
  'CANCELLED',
  'NOT_SERVICEABLE',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_SOURCES = ['OWNER', 'ADMIN', 'TURNOVER_AUTO'] as const;

export const INSPECTION_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_ACCESS'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const QUOTE_TYPES = ['ORIGINAL', 'CHANGE_ORDER'] as const;
export type QuoteType = (typeof QUOTE_TYPES)[number];
export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN', 'EXPIRED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const LINE_TYPES = ['LABOUR', 'MATERIAL', 'TRAVEL', 'INSPECTION_FEE', 'OTHER', 'DISCOUNT'] as const;
export type LineType = (typeof LINE_TYPES)[number];
export const LINE_DIRECTIONS = ['ADD', 'DEDUCT'] as const;
export type LineDirection = (typeof LINE_DIRECTIONS)[number];

export const PROVIDER_TYPES = ['INDIVIDUAL', 'GROUP'] as const;
export const PROVIDER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export const PROVIDER_VERIFICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const WORK_ORDER_KINDS = ['STANDARD', 'REWORK'] as const;
export const WORK_ORDER_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'ASSIGNED',
  'IN_PROGRESS',
  'BLOCKED',
  'SUBMITTED_FOR_REVIEW',
  'REWORK_REQUIRED',
  'READY_FOR_OWNER_REVIEW',
  'COMPLETED',
  'CANCELLED',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const BLOCKED_REASONS = [
  'ACCESS_DENIED',
  'HIDDEN_DAMAGE',
  'MATERIAL_UNAVAILABLE',
  'SAFETY_CONCERN',
  'SCOPE_CHANGE',
  'OTHER',
] as const;
export type BlockedReason = (typeof BLOCKED_REASONS)[number];
export const ASSIGNMENT_ROLES = ['PRIMARY', 'SUPPORT'] as const;
/** How an admin learned about a provider's progress (SPEC §6.5). */
export const REPORT_SOURCES = ['PHONE', 'MESSAGING_APP', 'IN_PERSON', 'EMAIL', 'OTHER'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export const PAYMENT_PURPOSES = ['INSPECTION_FEE', 'DEPOSIT', 'MILESTONE', 'FINAL'] as const;
export const DUE_TRIGGERS = [
  'ON_INSPECTION_SCHEDULED',
  'ON_QUOTE_APPROVAL',
  'ON_WORK_SCHEDULED',
  'ON_COMPLETION_ACCEPTED',
  'MANUAL',
] as const;
export const REQUIREMENT_STATUSES = ['PENDING', 'PAID', 'WAIVED', 'CANCELLED'] as const;
export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const THREAD_TYPES = ['REQUEST', 'ISSUE', 'WORK_ORDER', 'BOOKING', 'LISTING_REVIEW'] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];
export const MESSAGE_VISIBILITIES = ['PARTICIPANT', 'INTERNAL'] as const;

export const ATTACHMENT_OWNER_TYPES = [
  'PROPERTY',
  'LISTING',
  'REQUEST',
  'MESSAGE',
  'INSPECTION',
  'WORK_ORDER',
  'ISSUE',
  'VERIFICATION',
  'PROVIDER',
] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];
export const EVIDENCE_PHASES = ['GENERAL', 'BEFORE', 'DURING', 'AFTER'] as const;
export type EvidencePhase = (typeof EVIDENCE_PHASES)[number];
export const ATTACHMENT_STATUSES = ['PENDING', 'AVAILABLE', 'REJECTED', 'DELETED'] as const;

export const ISSUE_SUBJECT_TYPES = ['WORK_ORDER', 'BOOKING'] as const;
export type IssueSubjectType = (typeof ISSUE_SUBJECT_TYPES)[number];
export const ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const RESOLUTION_CODES = [
  'REWORK_DONE',
  'PARTIAL_REFUND',
  'FULL_REFUND',
  'PAYOUT_ADJUSTED',
  'NO_ACTION_REQUIRED',
  'DUPLICATE',
  'RAISER_WITHDREW',
  'OTHER',
] as const;
export type ResolutionCode = (typeof RESOLUTION_CODES)[number];
export const ISSUE_CATEGORIES = ['QUALITY', 'DAMAGE', 'CLEANLINESS', 'ACCESS', 'SAFETY', 'LISTING_ACCURACY', 'BILLING', 'OTHER'] as const;

export const INVOICE_KINDS = ['MAINTENANCE_RECEIPT', 'MAINTENANCE_FINAL', 'BOOKING_RECEIPT', 'COMMISSION_STATEMENT'] as const;
export const NOTIFICATION_CHANNELS = ['IN_APP', 'SMS', 'EMAIL'] as const;

export const AI_SUGGESTION_STATUSES = ['PENDING', 'READY', 'ACCEPTED', 'EDITED', 'DISMISSED', 'FAILED'] as const;
export type AiSuggestionStatus = (typeof AI_SUGGESTION_STATUSES)[number];

export const BENCHMARK_MODES = ['MIN', 'AVG', 'MAX', 'SPECIFIC'] as const;
export type BenchmarkMode = (typeof BENCHMARK_MODES)[number];
export const UNDERCUT_MODES = ['RELATIVE', 'POINTS'] as const;
export type UndercutMode = (typeof UNDERCUT_MODES)[number];

export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const ADMIN_ALERT_TYPES = [
  'LATE_PAYMENT_DATES_TAKEN',
  'REFUND_FAILED',
  'SAFETY_FLAGGED_REQUEST',
  'WEBHOOK_UNMATCHED',
  'OUTBOX_HANDLER_FAILED',
] as const;
export type AdminAlertType = (typeof ADMIN_ALERT_TYPES)[number];
