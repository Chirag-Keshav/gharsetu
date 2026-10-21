/**
 * English message catalog. Business logic refers to keys only; every brand reference is the
 * `{{productName}}` placeholder (SPEC §0.2). Legal and policy wording here is placeholder text.
 */
import type { ErrorCode } from '../errors';

export const errorMessages: Record<ErrorCode, string> = {
  BAD_REQUEST: 'The request could not be understood.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have permission to do that.',
  ROLE_REQUIRED: 'Choose how you want to use {{productName}} first.',
  CSRF_INVALID: 'Your session check failed. Refresh the page and try again.',
  NOT_FOUND: 'We could not find that.',
  INVALID_STATE_TRANSITION: 'That action is not possible right now. Refresh to see the latest status.',
  QUOTE_VERSION_STALE: 'This quote has changed. Refresh to review the latest version.',
  QUOTE_EXPIRED: 'This quote has expired. Ask for an updated quote.',
  DATES_UNAVAILABLE: 'Those dates are no longer available.',
  BOOKING_CONFLICT: 'This time overlaps a confirmed booking. Resolve the booking first.',
  CONFLICT: 'This change conflicts with a newer update. Refresh and try again.',
  VALIDATION_FAILED: 'Some details need attention.',
  OUT_OF_SERVICE_AREA: 'We do not offer this service at that PIN code yet.',
  IDEMPOTENCY_KEY_REUSED: 'This request was already sent with different details.',
  OTP_INVALID: 'That code is not valid. Check it or request a new one.',
  RATE_LIMITED: 'Too many attempts. Please wait a little and try again.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
  AI_UNAVAILABLE: 'The assistant is unavailable right now.',
};

export const smsTemplates = {
  otp: 'Your {{productName}} sign-in code is {{code}}. It expires in {{minutes}} minutes. Never share this code.',
  generic: '{{productName}}: {{title}}. Open the app for details.',
} as const;

/** Safe-guidance text shown when a danger rule triggers (SPEC §7 rule 8). Placeholder wording. */
export const guidanceMessages: Record<string, string> = {
  'electrical.sparking':
    'Stay away from the affected area. If it is safe to do so, switch off the main power supply. Do not touch wires, switches or appliances. If there is fire or smoke, leave the property and call emergency services (112).',
  'electrical.shock':
    'Do not touch the appliance, wiring or anyone who may be in contact with it. Switch off power at the main only if it is safe. Call emergency services (112) if anyone is hurt.',
  'plumbing.active_leak':
    'If it is safe, turn off the main water valve. Keep away from electrical points near the water. Do not attempt repairs on pressurised or concealed pipes yourself.',
  'plumbing.flooding':
    'Keep everyone away from standing water near electrical points. Switch off power at the main only if you can reach it safely and dry-shod.',
  'gas.smell':
    'Do not operate switches or flames. Open doors and windows if safe, leave the property and contact your gas supplier or emergency services (112).',
  'structural.risk':
    'Keep everyone away from the affected area. Do not climb onto roofs or investigate cracks, sagging or collapse personally. Contact emergency services (112) if there is immediate danger.',
  'height.risk':
    'Do not climb ladders, trees or roofs to inspect the problem. Our team will assess it with the right equipment.',
  'pest.hazard':
    'Keep children and pets away. Do not handle snakes, hives or nests, and do not apply chemicals yourself.',
};

export interface NotificationTemplate {
  title: string;
  body: string;
  link?: string;
  /** Critical notifications cannot be switched off and also go by SMS (SPEC §16). */
  critical: boolean;
}

const t = (title: string, body: string, link: string | undefined, critical = false): NotificationTemplate => ({
  title,
  body,
  link,
  critical,
});

/** Never include access instructions, exact location, documents or payment details here. */
export const notificationTemplates: Record<string, NotificationTemplate> = {
  'listing.submitted': t('Listing submitted', 'Your listing {{reference}} is with our review team.', '/owner/properties/{{propertyId}}?tab=listing'),
  'listing.changes_requested': t('Changes requested', 'Our team asked for changes to {{reference}}.', '/owner/properties/{{propertyId}}?tab=listing', true),
  'listing.published': t('Listing published', '{{reference}} is now live on {{productName}}.', '/owner/properties/{{propertyId}}?tab=listing', true),
  'listing.rejected': t('Listing not approved', 'We could not approve {{reference}}.', '/owner/properties/{{propertyId}}?tab=listing', true),
  'listing.paused_by_admin': t('Listing paused', '{{reference}} was paused by our team.', '/owner/properties/{{propertyId}}?tab=listing', true),

  'booking.request_sent': t('Request sent', 'Your request {{reference}} was sent to the host.', '/trips/{{bookingId}}'),
  'booking.request_received': t('New booking request', 'Respond to {{reference}} by {{deadline}}.', '/owner/bookings/{{bookingId}}', true),
  'booking.payment_due': t('Payment due', 'Pay for {{reference}} to confirm your stay.', '/trips/{{bookingId}}', true),
  'booking.declined': t('Request declined', 'The host could not accept {{reference}}.', '/trips/{{bookingId}}', true),
  'booking.expired': t('Booking expired', '{{reference}} expired before it was confirmed.', '/trips/{{bookingId}}', true),
  'booking.confirmed': t('Booking confirmed', 'Your stay {{reference}} is confirmed.', '/trips/{{bookingId}}', true),
  'booking.confirmed_owner': t('Booking confirmed', '{{reference}} is confirmed for {{checkIn}}.', '/owner/bookings/{{bookingId}}', true),
  'booking.cancelled': t('Booking cancelled', '{{reference}} was cancelled.', '/trips/{{bookingId}}', true),
  'booking.cancelled_owner': t('Booking cancelled', '{{reference}} was cancelled.', '/owner/bookings/{{bookingId}}', true),
  'booking.refund_issued': t('Refund issued', 'A refund for {{reference}} is on its way.', '/trips/{{bookingId}}', true),
  'booking.checkin_details': t('Check-in details available', 'Check-in details for {{reference}} are ready in the app.', '/trips/{{bookingId}}', true),
  'booking.review_prompt': t('How was your stay?', 'Share a review of {{reference}}.', '/trips/{{bookingId}}'),
  'booking.message': t('New message', 'New message on booking {{reference}}.', '{{link}}'),

  'payment.succeeded': t('Payment received', 'We received your payment for {{reference}}.', '{{link}}', true),
  'payment.failed': t('Payment failed', 'Your payment for {{reference}} did not go through.', '{{link}}', true),
  'payout.eligible': t('Payout eligible', 'Payout {{reference}} is ready to be released.', '/owner/earnings'),
  'payout.paid': t('Payout sent', 'Payout {{reference}} has been recorded as paid.', '/owner/earnings', true),

  'request.submitted': t('Request received', 'We received {{reference}}. Our team will review it.', '/owner/requests/{{requestId}}', true),
  'request.information_requested': t('More information needed', 'Please answer a question about {{reference}}.', '/owner/requests/{{requestId}}', true),
  'request.inspection_scheduled': t('Inspection scheduled', 'An inspection for {{reference}} is scheduled.', '/owner/requests/{{requestId}}', true),
  'request.quote_sent': t('Quote ready', 'Quote {{quoteReference}} for {{reference}} is ready to review.', '/owner/requests/{{requestId}}', true),
  'request.message': t('New message', 'New message on {{reference}}.', '/owner/requests/{{requestId}}'),
  'request.closed': t('Request closed', '{{reference}} was closed.', '/owner/requests/{{requestId}}', true),

  'work.scheduled': t('Work scheduled', 'Work {{reference}} has been scheduled.', '/owner/requests/{{requestId}}', true),
  'work.rescheduled': t('Work rescheduled', 'Work {{reference}} has a new schedule.', '/owner/requests/{{requestId}}', true),
  'work.started': t('Work started', 'Our care team has started {{reference}}.', '/owner/requests/{{requestId}}'),
  'work.progress': t('Progress update', 'There is a progress update on {{reference}}.', '/owner/requests/{{requestId}}'),
  'work.ready_for_owner_review': t('Ready for your review', 'Work {{reference}} is complete. Please review it.', '/owner/requests/{{requestId}}', true),
  'work.completed': t('Work completed', 'Work {{reference}} is complete.', '/owner/requests/{{requestId}}', true),
  'work.cancelled': t('Work cancelled', 'Work {{reference}} was cancelled.', '/owner/requests/{{requestId}}', true),
  'work.change_order': t('Change order to approve', 'A change to {{reference}} needs your approval.', '/owner/requests/{{requestId}}', true),
  'work.safety_mitigation': t('Safety action taken', 'Our team took an immediate safety step on {{reference}}.', '/owner/requests/{{requestId}}', true),

  'issue.opened': t('Issue raised', 'Issue {{reference}} has been raised.', '{{link}}', true),
  'issue.resolved': t('Issue resolved', 'Issue {{reference}} has been resolved.', '{{link}}', true),
  'issue.message': t('Issue update', 'There is an update on issue {{reference}}.', '{{link}}'),
  'invoice.issued': t('Invoice issued', 'Invoice {{reference}} is available.', '{{link}}', true),

  'admin.listing_to_review': t('Listing to review', '{{reference}} is waiting for review.', '/admin/listings/{{listingId}}'),
  'admin.verification_pending': t('Verification pending', 'A verification is waiting for review.', '/admin/verifications'),
  'admin.new_request': t('New maintenance request', '{{reference}} was submitted.', '/admin/requests/{{requestId}}'),
  'admin.safety_flagged_request': t('Safety-flagged request', '{{reference}} was flagged as a safety risk.', '/admin/requests/{{requestId}}', true),
  'admin.booking_request_near_expiry': t('Booking request expiring', '{{reference}} expires soon without a host response.', '/admin/bookings/{{bookingId}}'),
  'admin.late_payment_dates_taken': t('Late payment refunded', 'A late payment for {{reference}} was refunded: the dates were taken.', '/admin/bookings/{{bookingId}}', true),
  'admin.payout_eligible': t('Payout eligible', 'Payout {{reference}} is eligible.', '/admin/payouts'),
  'admin.work_order_blocked': t('Work order blocked', '{{reference}} is blocked.', '/admin/work-orders/{{workOrderId}}'),
  'admin.issue_opened': t('Issue opened', '{{reference}} was raised.', '/admin/issues/{{issueId}}'),
  'admin.refund_failed': t('Refund failed', 'A refund for {{reference}} failed and needs attention.', '/admin/payments'),
  'admin.ai_briefing_ready': t('Briefing ready', "Today's operations briefing is ready.", '/admin'),
  'admin.owner_reply': t('Owner replied', 'The owner replied on {{reference}}.', '/admin/requests/{{requestId}}'),
};

/** Human labels for codes returned by the stay rule validator and quote send validator. */
export const problemMessages: Record<string, string> = {
  CHECKOUT_NOT_AFTER_CHECKIN: 'Check-out must be after check-in.',
  MIN_NIGHTS: 'The stay is shorter than the minimum number of nights.',
  MAX_NIGHTS: 'The stay is longer than the maximum number of nights.',
  TOO_MANY_GUESTS: 'This place does not fit that many guests.',
  ADVANCE_NOTICE: 'This place needs more notice before check-in.',
  BEYOND_BOOKING_WINDOW: 'Those dates are too far ahead to book yet.',
  NO_LINE_ITEMS: 'Add at least one line item.',
  VALID_UNTIL_NOT_FUTURE: 'Set a validity date in the future.',
  TOTAL_NOT_POSITIVE: 'The quote total must be greater than zero.',
  NEGATIVE_AMOUNT: 'Deductions cannot exceed the quoted work.',
  SCOPE_MISSING: 'Describe the scope of work.',
  QUANTITY_NOT_POSITIVE: 'Every line needs a quantity above zero.',
  DISCOUNT_NEEDS_APPROVAL: 'This discount needs an admin with discount approval.',
};

const LABEL_OVERRIDES: Record<string, string> = {
  LIST_AND_CARE: 'List and care',
  CARE: 'Care',
  LIST: 'List',
  READY_FOR_OWNER_REVIEW: 'Ready for your review',
  SAFETY_RISK: 'Safety risk',
  OWNER_APPROVAL: 'Owner approval',
  AWAITING_PAYMENT: 'Awaiting payment',
  WORK_ORDER_CREATED: 'Work order created',
  NOT_SERVICEABLE: 'Not serviceable',
};

/** "READY_FOR_OWNER_REVIEW" → "Ready for your review"; other codes become sentence case. */
export function statusLabel(code: string | null | undefined): string {
  if (!code) return '';
  if (LABEL_OVERRIDES[code]) return LABEL_OVERRIDES[code];
  const words = code.toLowerCase().split('_');
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

export const AI_LABEL = 'AI suggestion — review before use';
export const AI_NOTICE =
  'Some content you enter may be processed by an AI provider to generate suggestions. (Placeholder notice — pending legal review.)';
