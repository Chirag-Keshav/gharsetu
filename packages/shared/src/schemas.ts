/**
 * Request schemas shared by the API (authoritative validation) and the web app (form validation).
 * Monetary totals are never accepted from clients; only unit inputs are.
 */
import { z } from 'zod';
import { cancellationRulesSchema } from './cancellation';
import { isIsoDate, TIME_RE } from './dates';
import {
  AI_SUGGESTION_STATUSES,
  ASSIGNMENT_ROLES,
  ATTACHMENT_OWNER_TYPES,
  BLOCKED_REASONS,
  BOOKING_MODES,
  EVIDENCE_PHASES,
  ISSUE_CATEGORIES,
  LINE_DIRECTIONS,
  LINE_TYPES,
  PERMISSION_FLAGS,
  PROPERTY_DOCUMENT_TYPES,
  PROPERTY_TYPES,
  PROVIDER_STATUSES,
  PROVIDER_TYPES,
  PROVIDER_VERIFICATION_STATUSES,
  REPORT_SOURCES,
  REQUEST_STATUSES,
  RESOLUTION_CODES,
  ROLES,
  SELF_SERVICE_ROLES,
  SERVICE_MODES,
  URGENCIES,
  USER_STATUSES,
  WORK_ORDER_STATUSES,
  OWNER_DOCUMENT_TYPES,
  BOOKING_STATUSES,
  LISTING_STATUSES,
  ISSUE_STATUSES,
  PAYOUT_STATUSES,
} from './enums';
import { intakeSchemaSchema, checklistTemplateSchema, requiredEvidenceSchema } from './intake';
import { isValidQuantity } from './money';
import { isIndianMobileE164, normaliseIndianPhone } from './phone';
import { AI_FEATURE_KEYS } from './policies';

// --- primitives ---------------------------------------------------------------------------------
export const uuid = z.string().uuid();
export const isoDate = z.string().refine(isIsoDate, 'Expected a date in YYYY-MM-DD format');
export const timeOfDay = z.string().regex(TIME_RE, 'Expected HH:MM');
export const instant = z.string().datetime({ offset: true });
export const paise = z.number().int().min(0).max(1_000_000_000_00);
export const bps = z.number().int().min(0).max(10_000);
export const shortText = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 2000) => z.string().trim().max(max).optional().nullable();
export const indianPhone = z
  .string()
  .transform((v, ctx) => {
    const n = normaliseIndianPhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Indian mobile number' });
      return z.NEVER;
    }
    return n;
  })
  .refine(isIndianMobileE164);
export const pinCode = z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit PIN code');

export const paginationQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// --- auth and profile ---------------------------------------------------------------------------
export const otpRequestSchema = z.object({ phone: indianPhone });
export const otpVerifySchema = z.object({
  challengeId: uuid,
  code: z.string().regex(/^\d{4,8}$/),
  /** A logged-out visitor who started a booking is treated as CUSTOMER (SPEC §3.1 rule 4). */
  intent: z.enum(['BOOKING']).optional(),
});
export const updateMeSchema = z.object({
  fullName: shortText(100).optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  communicationPrefs: z.record(z.string(), z.boolean()).optional(),
});
export const addRoleSchema = z.object({ role: z.enum(SELF_SERVICE_ROLES) });
export const activeRoleSchema = z.object({ role: z.enum(ROLES) });
export const consentSchema = z.object({
  documentType: z.enum(['terms', 'privacy', 'ai_notice']),
  version: shortText(40),
});
export const ownerProfileUpdateSchema = z.object({
  defaultServiceMode: z.enum(SERVICE_MODES).optional(),
  // Only a provider token or masked display value is accepted (SPEC §8.9), never raw bank details.
  payoutAccountRef: z
    .string()
    .trim()
    .max(60)
    .regex(/^(tok_[A-Za-z0-9_]+|[A-Za-z .]*[•*xX]{4,}\d{2,4})$/, 'Enter a payout token or a masked account (e.g. HDFC ••••1234)')
    .nullable()
    .optional(),
});

// --- properties ---------------------------------------------------------------------------------
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const propertyCreateSchema = z.object({
  nickname: shortText(80),
  propertyType: z.enum(PROPERTY_TYPES),
  addressLine1: shortText(200),
  addressLine2: optionalText(200),
  locality: shortText(100),
  city: shortText(100),
  district: shortText(100),
  state: shortText(100),
  pinCode,
  latitude: latitude.nullable().optional(),
  longitude: longitude.nullable().optional(),
  areaSqft: z.number().int().min(50).max(1_000_000).nullable().optional(),
  accessNotes: optionalText(2000),
  serviceMode: z.enum(SERVICE_MODES),
});
export const propertyUpdateSchema = propertyCreateSchema.partial();
export const propertyContactSchema = z.object({
  name: shortText(100),
  phone: indianPhone,
  relationship: shortText(60),
  accessRole: optionalText(100),
  consentConfirmed: z.literal(true, { errorMap: () => ({ message: 'Confirm the contact agreed to be contacted' }) }),
});
export const propertyContactUpdateSchema = propertyContactSchema.partial();

export const verificationSubmitSchema = z.object({
  ownerDocuments: z
    .array(z.object({ docType: z.enum(OWNER_DOCUMENT_TYPES), attachmentId: uuid, expiresAt: isoDate.optional() }))
    .max(3)
    .default([]),
  propertyDocuments: z
    .array(z.object({ docType: z.enum(PROPERTY_DOCUMENT_TYPES), attachmentId: uuid, expiresAt: isoDate.optional() }))
    .min(1)
    .max(5),
});
export const verificationDecisionSchema = z.object({
  reason: optionalText(1000),
  expiresAt: isoDate.optional(),
});

// --- uploads ------------------------------------------------------------------------------------
export const presignSchema = z.object({
  ownerType: z.enum(ATTACHMENT_OWNER_TYPES),
  ownerId: uuid.optional(),
  filename: shortText(200),
  mimeType: shortText(100),
  sizeBytes: z.number().int().min(1).max(500 * 1024 * 1024),
  evidencePhase: z.enum(EVIDENCE_PHASES).optional(),
});
export const attachmentCompleteSchema = z.object({ attachmentId: uuid });

// --- catalogue and configuration ---------------------------------------------------------------
export const serviceAreaSchema = z.object({
  name: shortText(100),
  state: shortText(100),
  district: shortText(100),
  pinCodes: z.array(pinCode).min(1).max(2000),
  isActive: z.boolean().default(true),
  offersStays: z.boolean().default(false),
});
export const serviceAreaUpdateSchema = serviceAreaSchema.partial();

export const paymentPolicySchema = z
  .object({
    deposit: z.object({ bps, dueTrigger: z.enum(['ON_QUOTE_APPROVAL', 'ON_WORK_SCHEDULED']) }).nullable().default(null),
    final: z.literal('REMAINDER_ON_COMPLETION_ACCEPTED').default('REMAINDER_ON_COMPLETION_ACCEPTED'),
  })
  .default({});

export const serviceCategorySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  name: shortText(100),
  description: optionalText(1000),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(1000).default(100),
  inspectionUsuallyRequired: z.boolean().default(false),
  intakeSchema: intakeSchemaSchema,
  safetyNotes: optionalText(2000),
  attachmentRules: z.object({ maxFiles: z.number().int().min(0).max(50).optional() }).default({}),
  requiredEvidence: requiredEvidenceSchema,
  paymentPolicy: paymentPolicySchema,
  serviceAreaIds: z.array(uuid).max(500).default([]),
});
export const serviceCategoryUpdateSchema = serviceCategorySchema.partial();
export const checklistTemplateUpdateSchema = checklistTemplateSchema;

export const amenitySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  name: shortText(80),
  group: shortText(60),
  iconKey: z.string().max(40).optional().nullable(),
  isActive: z.boolean().default(true),
});
export const amenityUpdateSchema = amenitySchema.partial();

export const cancellationPolicySchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/),
  name: shortText(80),
  description: optionalText(500),
  rules: cancellationRulesSchema.min(1),
  isActive: z.boolean().default(true),
});
export const cancellationPolicyUpdateSchema = cancellationPolicySchema.omit({ key: true }).partial();

export const policyUpdateSchema = z.object({ value: z.unknown() });

export const staffCreateSchema = z.object({
  phone: indianPhone,
  fullName: shortText(100),
  flags: z.array(z.enum(PERMISSION_FLAGS)).default([]),
});
export const staffUpdateSchema = z.object({
  flags: z.array(z.enum(PERMISSION_FLAGS)).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

// --- maintenance --------------------------------------------------------------------------------
export const preferredWindowSchema = z
  .object({ start: instant, end: instant })
  .refine((w) => Date.parse(w.end) > Date.parse(w.start), 'Window end must be after start');

export const serviceRequestCreateSchema = z.object({
  propertyId: uuid,
  categoryId: uuid,
  title: shortText(150),
  description: z.string().trim().min(10).max(5000),
  intakeAnswers: z.record(z.string(), z.unknown()).default({}),
  urgency: z.enum(URGENCIES).default('STANDARD'),
  preferredWindows: z.array(preferredWindowSchema).max(5).default([]),
  attachmentIds: z.array(uuid).max(50).default([]),
  accessContactId: uuid.nullable().optional(),
  inspectionFeeAcknowledged: z.boolean().optional(),
  /** Admin only: create outside the service area (audited). */
  overrideReason: optionalText(500),
});

export const messageCreateSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  visibility: z.enum(['PARTICIPANT', 'INTERNAL']).default('PARTICIPANT'),
  attachmentIds: z.array(uuid).max(10).default([]),
});

export const requestTransitionSchema = z.object({
  to: z.enum(REQUEST_STATUSES),
  reason: optionalText(1000),
  /** Owner-visible message (required for NEEDS_INFORMATION and NOT_SERVICEABLE). */
  ownerMessage: optionalText(5000),
});
export const reasonSchema = z.object({ reason: shortText(1000) });
export const optionalReasonSchema = z.object({ reason: optionalText(1000) });

export const inspectionCreateSchema = z
  .object({
    scheduledStart: instant,
    scheduledEnd: instant,
    providerId: uuid.nullable().optional(),
    feePaise: paise.default(0),
  })
  .refine((v) => Date.parse(v.scheduledEnd) > Date.parse(v.scheduledStart), 'End must be after start');
export const inspectionUpdateSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED', 'NO_ACCESS']).optional(),
  findings: optionalText(5000),
  scheduledStart: instant.optional(),
  scheduledEnd: instant.optional(),
  providerId: uuid.nullable().optional(),
});

export const quoteLineSchema = z.object({
  description: shortText(300),
  quantity: z.string().refine(isValidQuantity, 'Quantity must have at most 3 decimals'),
  unit: shortText(30),
  unitPricePaise: paise,
  taxRateBps: z.number().int().min(0).max(5000).default(0),
  lineType: z.enum(LINE_TYPES),
  direction: z.enum(LINE_DIRECTIONS),
  internalCostPaise: paise.nullable().optional(),
});
export const quoteDraftSchema = z.object({
  lineItems: z.array(quoteLineSchema).max(100),
  scope: optionalText(5000),
  exclusions: z.array(shortText(500)).max(30).default([]),
  assumptions: z.array(shortText(500)).max(30).default([]),
  estimatedDuration: optionalText(100),
  validUntil: instant.optional(),
});
export const quoteApproveSchema = z.object({
  version: z.number().int().min(1),
  displayedTotalPaise: paise,
});
export const quoteRejectSchema = z.object({
  reason: optionalText(1000),
  requestRevision: z.boolean().default(false),
});

export const workOrderCreateSchema = z.object({ quoteId: uuid });
export const workOrderScheduleSchema = z
  .object({ scheduledStart: instant, scheduledEnd: instant, reason: optionalText(500) })
  .refine((v) => Date.parse(v.scheduledEnd) > Date.parse(v.scheduledStart), 'End must be after start');
export const assignmentCreateSchema = z.object({
  providerId: uuid,
  assignmentRole: z.enum(ASSIGNMENT_ROLES).default('PRIMARY'),
  overrideReason: optionalText(500),
  internalNotes: optionalText(1000),
});
export const workOrderTransitionSchema = z.object({
  to: z.enum(WORK_ORDER_STATUSES),
  reason: optionalText(1000),
});
const onBehalf = {
  providerId: uuid,
  source: z.enum(REPORT_SOURCES),
};
export const visitCreateSchema = z
  .object({ ...onBehalf, checkedInAt: instant, checkedOutAt: instant.nullable().optional(), note: optionalText(2000) })
  .refine((v) => !v.checkedOutAt || Date.parse(v.checkedOutAt) >= Date.parse(v.checkedInAt), 'Check-out must be after check-in');
export const checklistResultsSchema = z.object({
  ...onBehalf,
  results: z
    .array(z.object({ itemKey: z.string().max(60), result: z.unknown(), notes: optionalText(1000) }))
    .min(1)
    .max(50),
});
export const evidenceCreateSchema = z.object({
  ...onBehalf,
  attachmentIds: z.array(uuid).min(1).max(20),
  phase: z.enum(['BEFORE', 'DURING', 'AFTER']),
  capturedAt: instant,
});
export const reportBlockedSchema = z.object({
  ...onBehalf,
  reason: z.enum(BLOCKED_REASONS),
  note: shortText(2000),
});
export const submitForReviewSchema = z.object({ ...onBehalf, note: optionalText(2000) });
export const approveCompletionSchema = z.object({ overrideReason: optionalText(1000) });
export const safetyMitigationSchema = z.object({ note: shortText(2000) });

export const issueCreateSchema = z.object({
  category: z.enum(ISSUE_CATEGORIES),
  description: z.string().trim().min(10).max(5000),
  attachmentIds: z.array(uuid).max(10).default([]),
});
export const issueResolveSchema = z.object({
  resolutionCode: z.enum(RESOLUTION_CODES),
  internalNote: shortText(2000),
  visibleSummary: optionalText(2000),
  /** Booking issues: refund to the customer (FINANCE). */
  refundPaise: paise.optional(),
  /** Booking issues: reduce the owner payout by this amount (FINANCE). */
  payoutAdjustmentPaise: paise.optional(),
});

// --- payments -------------------------------------------------------------------------------------
export const offlinePaymentSchema = z
  .object({
    requirementId: uuid.optional(),
    bookingId: uuid.optional(),
    amountPaise: paise.refine((v) => v > 0, 'Amount must be positive'),
    reference: shortText(100),
    reason: shortText(500),
  })
  .refine((v) => Boolean(v.requirementId) !== Boolean(v.bookingId), 'Provide exactly one of requirementId or bookingId');
export const refundCreateSchema = z.object({
  amountPaise: paise.refine((v) => v > 0, 'Amount must be positive'),
  reason: shortText(500),
});
export const mockPaymentCompleteSchema = z.object({ outcome: z.enum(['SUCCEEDED', 'FAILED']) });

// --- listings -----------------------------------------------------------------------------------
export const houseRulesSchema = z.object({
  quietHours: z.string().max(40).optional().nullable(),
  petsAllowed: z.boolean().default(false),
  smokingAllowed: z.boolean().default(false),
  eventsAllowed: z.boolean().default(false),
  additionalRules: z.string().max(3000).optional().nullable(),
});
export type HouseRules = z.infer<typeof houseRulesSchema>;

export const listingUpdateSchema = z.object({
  title: z.string().trim().max(120).optional(),
  description: z.string().trim().max(8000).optional(),
  maxGuests: z.number().int().min(1).max(50).optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  beds: z.number().int().min(0).max(100).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  houseRules: houseRulesSchema.optional(),
  checkInTime: timeOfDay.optional(),
  checkOutTime: timeOfDay.optional(),
  basePricePaise: paise.optional(),
  weekendPricePaise: paise.nullable().optional(),
  cleaningFeePaise: paise.optional(),
  minNights: z.number().int().min(1).max(365).optional(),
  maxNights: z.number().int().min(1).max(365).optional(),
  advanceNoticeHours: z.number().int().min(0).max(720).optional(),
  maxAdvanceDays: z.number().int().min(1).max(730).optional(),
  bookingMode: z.enum(BOOKING_MODES).optional(),
  cancellationPolicyKey: z.string().max(40).optional(),
  turnoverCleaningEnabled: z.boolean().optional(),
  publicAreaLabel: z.string().trim().max(120).optional(),
  approxLatitude: latitude.nullable().optional(),
  approxLongitude: longitude.nullable().optional(),
  checkinInstructions: optionalText(3000),
});
export const listingAmenitiesSchema = z.object({ amenityIds: z.array(uuid).max(100) });
export const listingPhotoAddSchema = z.object({ attachmentId: uuid, caption: optionalText(200) });
export const listingPhotoUpdateSchema = z.object({ caption: optionalText(200), isCover: z.boolean().optional() });
export const listingPhotoOrderSchema = z.object({ photoIds: z.array(uuid).min(1).max(100) });
export const calendarBlockSchema = z
  .object({ startDate: isoDate, endDate: isoDate, note: optionalText(200) })
  .refine((v) => v.endDate > v.startDate, 'End date must be after start date');
export const priceRuleSchema = z
  .object({ startDate: isoDate, endDate: isoDate, nightlyPricePaise: paise, reason: optionalText(200) })
  .refine((v) => v.endDate >= v.startDate, 'End date must not be before start date');
export const listingDecisionSchema = z.object({ message: shortText(5000) });
export const calendarQuery = z.object({ from: isoDate, to: isoDate });

// --- public discovery ---------------------------------------------------------------------------
export const SEARCH_SORTS = ['relevance', 'price_asc', 'price_desc', 'rating', 'newest'] as const;
export const searchQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    checkIn: isoDate.optional(),
    checkOut: isoDate.optional(),
    guests: z.coerce.number().int().min(1).max(50).optional(),
    minPricePaise: z.coerce.number().int().min(0).optional(),
    maxPricePaise: z.coerce.number().int().min(0).optional(),
    propertyType: z.enum(PROPERTY_TYPES).optional(),
    amenities: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))),
    bedrooms: z.coerce.number().int().min(0).max(50).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    sort: z.enum(SEARCH_SORTS).default('relevance'),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((v) => (v.checkIn ? Boolean(v.checkOut) && v.checkOut! > v.checkIn : !v.checkOut), {
    message: 'Provide both dates, with check-out after check-in',
    path: ['checkOut'],
  });
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export const priceQuoteSchema = z.object({ checkIn: isoDate, checkOut: isoDate, guests: z.number().int().min(1).max(50) });
export const nlSearchSchema = z.object({ query: z.string().trim().min(3).max(300) });

// --- bookings ---------------------------------------------------------------------------------------
export const bookingCreateSchema = z.object({
  listingId: uuid,
  checkIn: isoDate,
  checkOut: isoDate,
  guests: z.number().int().min(1).max(50),
  specialRequests: optionalText(1000),
  guestDetails: z.record(z.string(), z.unknown()).optional(),
});
export const bookingCancelSchema = z.object({
  reason: optionalText(1000),
  /** Admin with FINANCE only: refund share other than the default full refund. */
  refundBps: bps.optional(),
});
export const bookingMessageSchema = z.object({ body: z.string().trim().min(1).max(3000) });
export const reviewCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(10).max(3000),
});

// --- admin: providers, finance ---------------------------------------------------------------------
export const providerSchema = z.object({
  name: shortText(120),
  providerType: z.enum(PROVIDER_TYPES),
  contactName: optionalText(120),
  phone: indianPhone,
  status: z.enum(PROVIDER_STATUSES).default('ACTIVE'),
  verificationStatus: z.enum(PROVIDER_VERIFICATION_STATUSES).default('PENDING'),
  availabilityNotes: optionalText(1000),
  internalNotes: optionalText(3000),
  internalRating: z.number().int().min(1).max(5).nullable().optional(),
  skillCategoryIds: z.array(uuid).max(50).default([]),
  serviceAreaIds: z.array(uuid).max(200).default([]),
});
export const providerUpdateSchema = providerSchema.partial();
export const providerDocumentSchema = z.object({
  docType: shortText(60),
  attachmentId: uuid,
  expiresAt: isoDate.optional(),
});
export const providerImportSchema = z.object({ csv: z.string().min(1).max(500_000) });

export const benchmarkSchema = z.object({
  platformName: shortText(80),
  commissionBps: bps,
  note: optionalText(1000),
  sourceUrl: z.string().url().max(500).nullable().optional(),
  asOfDate: isoDate,
  enabled: z.boolean().default(true),
});
export const benchmarkUpdateSchema = benchmarkSchema.partial();
export const commissionOverrideSchema = z.object({ bps: bps.nullable(), reason: shortText(500) });
export const payoutHoldSchema = z.object({ reason: shortText(500) });
export const payoutMarkPaidSchema = z.object({ paymentReference: shortText(100) });
export const reviewHideSchema = z.object({ reason: shortText(500) });

// --- admin queue filters -------------------------------------------------------------------------
export const adminRequestQuery = paginationQuery.extend({
  status: z.enum(REQUEST_STATUSES).optional(),
  categoryId: uuid.optional(),
  serviceAreaId: uuid.optional(),
  urgency: z.enum(URGENCIES).optional(),
  handler: z.enum(['me', 'unassigned']).optional(),
  safety: z.coerce.boolean().optional(),
});
export const adminListingQuery = paginationQuery.extend({
  status: z.enum(LISTING_STATUSES).optional(),
  edited: z.coerce.boolean().optional(),
});
export const adminBookingQuery = paginationQuery.extend({ status: z.enum(BOOKING_STATUSES).optional() });
export const adminIssueQuery = paginationQuery.extend({ status: z.enum(ISSUE_STATUSES).optional() });
export const adminPayoutQuery = paginationQuery.extend({ status: z.enum(PAYOUT_STATUSES).optional() });
export const workOrderQuery = paginationQuery.extend({ status: z.enum(WORK_ORDER_STATUSES).optional() });
export const providerQuery = paginationQuery.extend({
  q: z.string().max(100).optional(),
  categoryId: uuid.optional(),
  serviceAreaId: uuid.optional(),
  status: z.enum(PROVIDER_STATUSES).optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
});
export const auditQuery = paginationQuery.extend({
  entityType: z.string().max(40).optional(),
  entityId: uuid.optional(),
  actorId: uuid.optional(),
  action: z.string().max(80).optional(),
});

// --- AI ---------------------------------------------------------------------------------------------
export const aiSuggestSchema = z.object({
  featureKey: z.enum(AI_FEATURE_KEYS),
  subjectType: z.string().max(40).optional(),
  subjectId: uuid.optional(),
  params: z.record(z.string(), z.unknown()).default({}),
});
export const aiActionSchema = z.object({ feedback: optionalText(1000), editedOutput: z.unknown().optional() });
export const aiSuggestionStatusSchema = z.enum(AI_SUGGESTION_STATUSES);
