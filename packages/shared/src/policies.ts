/**
 * Policy settings registry (SPEC §10). Values live in the `policy_settings` table; these are the
 * seed defaults, validation schemas and which admin flag may edit each key. Never hard-code a
 * policy value in business logic: read it through the API's PolicyService.
 */
import { z } from 'zod';
import { BENCHMARK_MODES, UNDERCUT_MODES, WEEKDAYS } from './enums';

export type PolicyStatus = 'DECISION' | 'POLICY_DEFAULT' | 'PLACEHOLDER';
export type PolicyEditFlag = 'USER_ADMIN' | 'FINANCE' | 'AI_ADMIN';

export interface PolicyDefinition<T> {
  schema: z.ZodType<T>;
  defaultValue: T;
  status: PolicyStatus;
  description: string;
  editFlag: PolicyEditFlag;
}

function def<T>(
  schema: z.ZodType<T>,
  defaultValue: T,
  status: PolicyStatus,
  description: string,
  editFlag: PolicyEditFlag = 'USER_ADMIN',
): PolicyDefinition<T> {
  return { schema, defaultValue, status, description, editFlag };
}

const int = (min = 0, max = Number.MAX_SAFE_INTEGER) => z.number().int().min(min).max(max);
const bool = z.boolean();

export const AI_FEATURE_KEYS = [
  'admin_briefing',
  'request_triage',
  'listing_review',
  'quote_draft',
  'provider_shortlist',
  'evidence_review',
  'issue_summary',
  'commission_insights',
  'leakage_flag',
  'listing_writer',
  'price_suggestion',
  'request_assistant',
  'nl_search',
] as const;
export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];

export const POLICIES = {
  'otp.length': def(int(4, 8), 6, 'DECISION', 'OTP code length'),
  'otp.ttl_seconds': def(int(60, 900), 300, 'DECISION', 'OTP validity in seconds'),
  'otp.max_attempts': def(int(1, 10), 5, 'DECISION', 'Verification attempts per OTP challenge'),
  'otp.resend_cooldown_seconds': def(int(0, 600), 30, 'DECISION', 'Minimum seconds between OTP requests for a phone'),
  'otp.max_requests_per_hour': def(int(1, 50), 5, 'DECISION', 'OTP requests per phone per hour'),
  'session.user_idle_days': def(int(1, 365), 30, 'POLICY_DEFAULT', 'Owner/customer session idle lifetime (days)'),
  'session.user_absolute_days': def(int(1, 365), 90, 'POLICY_DEFAULT', 'Owner/customer session absolute lifetime (days)'),
  'session.admin_idle_hours': def(int(1, 72), 12, 'POLICY_DEFAULT', 'Admin session idle lifetime (hours)'),
  'session.admin_absolute_days': def(int(1, 30), 7, 'POLICY_DEFAULT', 'Admin session absolute lifetime (days)'),
  'uploads.image_max_mb': def(int(1, 50), 10, 'POLICY_DEFAULT', 'Maximum image upload size (MB)'),
  'uploads.video_max_mb': def(int(1, 500), 100, 'POLICY_DEFAULT', 'Maximum video upload size (MB)'),
  'uploads.max_files_per_request': def(int(1, 50), 10, 'POLICY_DEFAULT', 'Maximum attachments per request'),
  'quote.default_validity_days': def(int(1, 90), 7, 'POLICY_DEFAULT', 'Default quote validity (days)'),
  'quote.discount_approval_threshold_bps': def(
    int(0, 10_000),
    1000,
    'PLACEHOLDER',
    'Discounts above this share of the quote need QUOTE_DISCOUNT_APPROVE',
  ),
  'work.owner_review_window_hours': def(int(1, 720), 72, 'PLACEHOLDER', 'Owner review window before auto-completion (hours)'),
  'work.require_different_admin': def(bool, false, 'PLACEHOLDER', 'Completion approver must differ from the admin who recorded submission'),
  'issue.complaint_window_days': def(int(1, 365), 30, 'PLACEHOLDER', 'Days after completion an issue can be raised'),
  'issue.reopen_window_days': def(int(0, 90), 7, 'PLACEHOLDER', 'Days a resolved issue can be reopened by the raiser'),
  'cancellation.fee_policy': def(z.enum(['NONE']), 'NONE' as const, 'PLACEHOLDER', 'Maintenance cancellation fee policy'),
  'cancellation.no_access_fee_paise': def(int(), 0, 'PLACEHOLDER', 'Fee charged when an inspection cannot access the property'),
  'sla.first_response_minutes': def(int(1, 10_000), 240, 'PLACEHOLDER', 'Target first admin response (minutes)'),
  'sla.staffed_hours_ist': def(z.string().max(100), '09:00-18:00 Mon-Sat', 'PLACEHOLDER', 'Staffed hours (IST)'),
  'safety.immediate_mitigation_allowed': def(bool, false, 'PLACEHOLDER', 'Allow admin-recorded immediate safety mitigation'),
  'payment.default_policy': def(
    z.enum(['FINAL_100_ON_COMPLETION']),
    'FINAL_100_ON_COMPLETION' as const,
    'PLACEHOLDER',
    'Default maintenance payment policy',
    'FINANCE',
  ),
  'verification.require_for_listing': def(bool, true, 'DECISION', 'Owner and property verification required to publish'),
  'verification.require_for_care': def(bool, false, 'PLACEHOLDER', 'Verification required before scheduling maintenance'),
  'stays.restrict_to_service_areas': def(bool, false, 'POLICY_DEFAULT', 'Publish listings only inside stay-enabled service areas'),
  'listing.min_photos': def(int(1, 50), 5, 'POLICY_DEFAULT', 'Minimum listing photos'),
  'pricing.weekend_nights': def(z.array(z.enum(WEEKDAYS)).max(7), ['FRI', 'SAT'] as Array<(typeof WEEKDAYS)[number]>, 'POLICY_DEFAULT', 'Nights priced at the weekend rate'),
  'pricing.stay_tax_bps': def(int(0, 5000), 0, 'PLACEHOLDER', 'Tax on stays (bps) — accountant to confirm', 'FINANCE'),
  'booking.hold_minutes': def(int(1, 120), 15, 'POLICY_DEFAULT', 'Date hold while awaiting payment (minutes)'),
  'booking.request_response_hours': def(int(1, 168), 24, 'PLACEHOLDER', 'Owner response window for booking requests (hours)'),
  'booking.payment_policy': def(z.enum(['FULL_UPFRONT']), 'FULL_UPFRONT' as const, 'DECISION', 'Booking payment policy'),
  'stay_review.window_days': def(int(1, 90), 14, 'POLICY_DEFAULT', 'Days after check-out a review can be left'),
  'commission.benchmark_mode': def(z.enum(BENCHMARK_MODES), 'MIN' as (typeof BENCHMARK_MODES)[number], 'POLICY_DEFAULT', 'How benchmarks combine', 'FINANCE'),
  'commission.specific_benchmark_id': def(z.string().uuid().nullable(), null as string | null, 'POLICY_DEFAULT', 'Benchmark used when mode is SPECIFIC', 'FINANCE'),
  'commission.undercut_mode': def(z.enum(UNDERCUT_MODES), 'RELATIVE' as (typeof UNDERCUT_MODES)[number], 'POLICY_DEFAULT', 'RELATIVE (% lower) or POINTS (bps lower)', 'FINANCE'),
  'commission.undercut_bps': def(int(0, 10_000), 1000, 'PLACEHOLDER', 'Discount versus benchmark; target 1000–1500 (10–15 % lower)', 'FINANCE'),
  'commission.floor_bps': def(int(0, 10_000), 500, 'PLACEHOLDER', 'Minimum commission (bps)', 'FINANCE'),
  'commission.ceiling_bps': def(int(0, 10_000), 2500, 'PLACEHOLDER', 'Maximum commission (bps)', 'FINANCE'),
  'commission.guest_fee_bps': def(int(0, 0), 0, 'DECISION', 'Guest service fee (not charged in the MVP)', 'FINANCE'),
  'payout.release_delay_hours': def(int(0, 720), 24, 'PLACEHOLDER', 'Hours after check-in before a payout is eligible', 'FINANCE'),
  'payout.dual_approval_threshold_paise': def(int(), 5_000_000, 'PLACEHOLDER', 'Payouts above this need a second FINANCE approval', 'FINANCE'),
  'disclosure.access_hours_before_checkin': def(int(0, 720), 24, 'PLACEHOLDER', 'Hours before check-in that access instructions are shown'),
  'disclosure.guest_phone_hours_before_checkin': def(int(0, 720), 48, 'PLACEHOLDER', "Hours before check-in that the guest's phone is shown to the owner"),
  'ai.enabled': def(bool, true, 'DECISION', 'Master AI switch (also requires AI_ENABLED=true)', 'AI_ADMIN'),
  'ai.timeout_seconds': def(int(1, 120), 15, 'POLICY_DEFAULT', 'AI call timeout (seconds)', 'AI_ADMIN'),
  'ai.cache_ttl_minutes': def(int(0, 1440), 60, 'POLICY_DEFAULT', 'Reuse identical AI results for this long', 'AI_ADMIN'),
  'ai.daily_calls_per_user': def(int(0, 10_000), 30, 'PLACEHOLDER', 'Daily AI calls per owner/customer', 'AI_ADMIN'),
  'ai.daily_calls_per_admin': def(int(0, 10_000), 200, 'PLACEHOLDER', 'Daily AI calls per admin', 'AI_ADMIN'),
  'ai.daily_calls_global': def(int(0, 1_000_000), 5000, 'PLACEHOLDER', 'Daily AI calls across all users', 'AI_ADMIN'),
  'ai.briefing_time_ist': def(z.string().regex(/^\d{2}:\d{2}$/), '07:00', 'POLICY_DEFAULT', 'Daily admin briefing time (IST)', 'AI_ADMIN'),
  'ai.briefing_refresh_per_hour': def(int(0, 60), 4, 'POLICY_DEFAULT', 'On-demand briefing refreshes per admin per hour', 'AI_ADMIN'),
  'ai.feature.admin_briefing.enabled': def(bool, true, 'DECISION', 'AI-ADM-01 admin briefing', 'AI_ADMIN'),
  'ai.feature.request_triage.enabled': def(bool, true, 'DECISION', 'AI-ADM-02 request triage assistant', 'AI_ADMIN'),
  'ai.feature.listing_review.enabled': def(bool, true, 'DECISION', 'AI-ADM-05 listing review assistant', 'AI_ADMIN'),
  'ai.feature.quote_draft.enabled': def(bool, true, 'DECISION', 'AI-ADM-03 quote drafting assistant', 'AI_ADMIN'),
  'ai.feature.provider_shortlist.enabled': def(bool, true, 'DECISION', 'AI-ADM-04 provider shortlist', 'AI_ADMIN'),
  'ai.feature.evidence_review.enabled': def(bool, true, 'DECISION', 'AI-ADM-06 evidence review summary', 'AI_ADMIN'),
  'ai.feature.issue_summary.enabled': def(bool, true, 'DECISION', 'AI-ADM-07 issue summariser', 'AI_ADMIN'),
  'ai.feature.commission_insights.enabled': def(bool, true, 'DECISION', 'AI-ADM-08 commission insights', 'AI_ADMIN'),
  'ai.feature.leakage_flag.enabled': def(bool, true, 'DECISION', 'AI-ADM-09 off-platform leakage flag', 'AI_ADMIN'),
  'ai.feature.listing_writer.enabled': def(bool, true, 'DECISION', 'AI-OWN-01 listing writer', 'AI_ADMIN'),
  'ai.feature.price_suggestion.enabled': def(bool, true, 'DECISION', 'AI-OWN-02 price suggestion', 'AI_ADMIN'),
  'ai.feature.request_assistant.enabled': def(bool, true, 'DECISION', 'AI-OWN-03 maintenance request assistant', 'AI_ADMIN'),
  'ai.feature.nl_search.enabled': def(bool, true, 'DECISION', 'AI-CUS-01 natural-language search', 'AI_ADMIN'),
  'notifications.progress_milestone_enabled': def(bool, true, 'POLICY_DEFAULT', 'Notify owners of progress milestones'),
  'features.delegates_enabled': def(bool, false, 'DECISION', 'Property delegate logins (Phase 2)'),
  'features.guest_details_enabled': def(bool, false, 'DECISION', 'Collect guest identity details on bookings'),
  'features.turnover_cleaning': def(bool, false, 'DECISION', 'Automatic turnover-cleaning requests after stays'),
} as const;

export type PolicyKey = keyof typeof POLICIES;
export type PolicyValue<K extends PolicyKey> = (typeof POLICIES)[K]['defaultValue'];
export const POLICY_KEYS = Object.keys(POLICIES) as PolicyKey[];

export function aiFeaturePolicyKey(feature: AiFeatureKey): PolicyKey {
  return `ai.feature.${feature}.enabled` as PolicyKey;
}

export function parsePolicyValue(key: PolicyKey, value: unknown): unknown {
  return (POLICIES[key].schema as z.ZodType<unknown>).parse(value);
}
