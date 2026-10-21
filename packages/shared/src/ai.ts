/**
 * AI feature catalogue and output schemas (SPEC §8.11). Every model output is validated with these
 * schemas; anything off-schema is discarded.
 */
import { z } from 'zod';
import { LINE_DIRECTIONS, LINE_TYPES, PROPERTY_TYPES, URGENCIES } from './enums';
import type { AiFeatureKey } from './policies';
import type { Role } from './enums';

const severity = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const text = (max: number) => z.string().max(max);
const ENTITY_TYPES = ['LISTING', 'SERVICE_REQUEST', 'BOOKING', 'WORK_ORDER', 'ISSUE', 'PAYOUT', 'VERIFICATION'] as const;
export type AiEntityType = (typeof ENTITY_TYPES)[number];

export const briefingOutputSchema = z.object({
  summary: text(1500),
  highlights: z
    .array(z.object({ label: text(200), severity, metric: z.record(z.string(), z.union([z.number(), z.string()])).optional() }))
    .max(10),
  risks: z.array(z.object({ label: text(200), severity })).max(10),
  suggestedActions: z
    .array(
      z.object({
        label: text(200),
        entityType: z.enum(ENTITY_TYPES),
        entityId: z.string().uuid(),
        rationale: text(500),
        priority: z.number().int().min(1).max(5),
      }),
    )
    .max(10),
});

export const triageOutputSchema = z.object({
  summary: text(1000),
  suggestedCategorySlug: z.string().max(60).nullable(),
  suggestedUrgency: z.enum(URGENCIES),
  inspectionNeeded: z.boolean(),
  missingInformation: z.array(text(300)).max(8),
  draftOwnerMessage: text(2000).nullable(),
});

export const listingReviewOutputSchema = z.object({
  overall: z.enum(['LOOKS_GOOD', 'NEEDS_CHANGES', 'CONCERNS']),
  completeness: z.array(z.object({ item: text(80), status: z.enum(['OK', 'MISSING', 'WEAK']), note: text(300) })).max(20),
  qualityFindings: z.array(text(300)).max(10),
  redFlags: z
    .array(
      z.object({
        type: z.enum(['CONTACT_DETAILS', 'MISLEADING_CLAIM', 'CAPACITY_ANOMALY', 'PRICE_ANOMALY', 'OTHER']),
        detail: text(300),
      }),
    )
    .max(10),
  suggestedChangeRequests: z.array(text(300)).max(10),
});

export const quoteDraftOutputSchema = z.object({
  lineItems: z
    .array(
      z.object({
        description: text(300),
        quantity: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
        unit: text(30),
        unitPricePaise: z.number().int().min(0),
        lineType: z.enum(LINE_TYPES),
        direction: z.enum(LINE_DIRECTIONS),
      }),
    )
    .max(30),
  outlierWarnings: z.array(text(300)).max(10),
  rationale: text(1000),
});

export const providerShortlistOutputSchema = z.object({
  ranked: z.array(z.object({ providerId: z.string().uuid(), rank: z.number().int().min(1), reason: text(300) })).max(20),
});

export const evidenceReviewOutputSchema = z.object({
  completeness: z.enum(['COMPLETE', 'INCOMPLETE']),
  summary: text(1000),
  concerns: z.array(text(300)).max(10),
});

export const issueSummaryOutputSchema = z.object({
  summary: text(1000),
  urgency: severity,
  resolutionOptions: z.array(z.object({ option: text(300), policyReference: text(100).nullable() })).max(6),
});

export const commissionInsightsOutputSchema = z.object({
  observations: z.array(text(400)).max(8),
  suggestions: z.array(text(400)).max(8),
});

export const leakageFlagOutputSchema = z.object({
  flagged: z.boolean(),
  reason: text(300).nullable(),
});

export const listingWriterOutputSchema = z.object({
  title: text(120),
  description: text(4000),
  highlights: z.array(text(150)).max(8),
});

export const priceSuggestionOutputSchema = z
  .object({
    minNightlyPaise: z.number().int().min(0),
    maxNightlyPaise: z.number().int().min(0),
    suggestedNightlyPaise: z.number().int().min(0),
    rationale: text(1000),
  })
  .refine((v) => v.minNightlyPaise <= v.suggestedNightlyPaise && v.suggestedNightlyPaise <= v.maxNightlyPaise);

export const requestAssistantOutputSchema = z.object({
  categorySlug: z.string().max(60).nullable(),
  title: text(150),
  intakeAnswers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  suggestedUrgency: z.enum(URGENCIES),
  notes: text(500).nullable(),
});

export const nlSearchOutputSchema = z.object({
  q: z.string().max(100).nullable(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  guests: z.number().int().min(1).max(50).nullable(),
  minPricePaise: z.number().int().min(0).nullable(),
  maxPricePaise: z.number().int().min(0).nullable(),
  propertyType: z.enum(PROPERTY_TYPES).nullable(),
  amenities: z.array(z.string().max(60)).max(10),
  bedrooms: z.number().int().min(0).max(50).nullable(),
  minRating: z.number().min(0).max(5).nullable(),
});

export interface AiFeatureDefinition {
  key: AiFeatureKey;
  id: string;
  audience: Role;
  priority: 'P0' | 'P1';
  model: 'fast' | 'smart';
  label: string;
  output: z.ZodTypeAny;
  /** Subject entity the feature attaches to, if any. */
  subjectType?: AiEntityType | 'PROPERTY' | 'SEARCH';
  background: boolean;
}

export const AI_FEATURES: Record<AiFeatureKey, AiFeatureDefinition> = {
  admin_briefing: { key: 'admin_briefing', id: 'AI-ADM-01', audience: 'ADMIN', priority: 'P0', model: 'smart', label: 'Daily briefing', output: briefingOutputSchema, background: true },
  request_triage: { key: 'request_triage', id: 'AI-ADM-02', audience: 'ADMIN', priority: 'P0', model: 'fast', label: 'Request triage', output: triageOutputSchema, subjectType: 'SERVICE_REQUEST', background: true },
  listing_review: { key: 'listing_review', id: 'AI-ADM-05', audience: 'ADMIN', priority: 'P0', model: 'fast', label: 'Listing review', output: listingReviewOutputSchema, subjectType: 'LISTING', background: true },
  quote_draft: { key: 'quote_draft', id: 'AI-ADM-03', audience: 'ADMIN', priority: 'P1', model: 'smart', label: 'Quote draft', output: quoteDraftOutputSchema, subjectType: 'SERVICE_REQUEST', background: true },
  provider_shortlist: { key: 'provider_shortlist', id: 'AI-ADM-04', audience: 'ADMIN', priority: 'P1', model: 'fast', label: 'Provider shortlist', output: providerShortlistOutputSchema, subjectType: 'WORK_ORDER', background: true },
  evidence_review: { key: 'evidence_review', id: 'AI-ADM-06', audience: 'ADMIN', priority: 'P1', model: 'fast', label: 'Evidence review', output: evidenceReviewOutputSchema, subjectType: 'WORK_ORDER', background: true },
  issue_summary: { key: 'issue_summary', id: 'AI-ADM-07', audience: 'ADMIN', priority: 'P1', model: 'fast', label: 'Issue summary', output: issueSummaryOutputSchema, subjectType: 'ISSUE', background: true },
  commission_insights: { key: 'commission_insights', id: 'AI-ADM-08', audience: 'ADMIN', priority: 'P1', model: 'fast', label: 'Commission insights', output: commissionInsightsOutputSchema, background: true },
  leakage_flag: { key: 'leakage_flag', id: 'AI-ADM-09', audience: 'ADMIN', priority: 'P1', model: 'fast', label: 'Off-platform leakage check', output: leakageFlagOutputSchema, subjectType: 'BOOKING', background: true },
  listing_writer: { key: 'listing_writer', id: 'AI-OWN-01', audience: 'OWNER', priority: 'P1', model: 'fast', label: 'Listing writer', output: listingWriterOutputSchema, subjectType: 'LISTING', background: true },
  price_suggestion: { key: 'price_suggestion', id: 'AI-OWN-02', audience: 'OWNER', priority: 'P1', model: 'fast', label: 'Price suggestion', output: priceSuggestionOutputSchema, subjectType: 'LISTING', background: true },
  request_assistant: { key: 'request_assistant', id: 'AI-OWN-03', audience: 'OWNER', priority: 'P1', model: 'fast', label: 'Request assistant', output: requestAssistantOutputSchema, subjectType: 'PROPERTY', background: true },
  nl_search: { key: 'nl_search', id: 'AI-CUS-01', audience: 'CUSTOMER', priority: 'P1', model: 'fast', label: 'Natural-language search', output: nlSearchOutputSchema, subjectType: 'SEARCH', background: false },
};

export type BriefingOutput = z.infer<typeof briefingOutputSchema>;
export type TriageOutput = z.infer<typeof triageOutputSchema>;
export type ListingReviewOutput = z.infer<typeof listingReviewOutputSchema>;
export type NlSearchOutput = z.infer<typeof nlSearchOutputSchema>;
