import { formatInr, statusLabel } from '@propcare/shared';

export { statusLabel };

/** Paise → "₹12,907.50". */
export const inr = (paise: number | null | undefined, withPaise?: boolean) => (paise == null ? '—' : formatInr(paise, { withPaise }));

const TZ = 'Asia/Kolkata';

/** Calendar date shown as a date, never as an instant (SPEC §14.4). */
export function dateLabel(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : TZ, ...opts });
}

/** Instants in IST with an explicit zone suffix. */
export function dateTimeLabel(iso: string | null | undefined) {
  if (!iso) return '—';
  return `${new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ })} IST`;
}

export function ago(iso: string | null | undefined) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const pct = (bps: number | null | undefined) => (bps == null ? '—' : `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`);

export const rupeesInput = (paise: number | null | undefined) => (paise == null ? '' : String(paise / 100));

export function todayIst(offsetDays = 0) {
  return new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** <input type="datetime-local"> value (IST) ↔ ISO instant. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16);
}
export function fromLocalInput(v: string) {
  return new Date(`${v}:00+05:30`).toISOString();
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brand';

const TONES: Record<string, Tone> = {
  PUBLISHED: 'ok', CONFIRMED: 'ok', COMPLETED: 'ok', APPROVED: 'ok', PAID: 'ok', SUCCEEDED: 'ok', RESOLVED: 'ok', AVAILABLE: 'ok', ACTIVE: 'ok', READY: 'ok', ACCEPTED: 'ok',
  SUBMITTED: 'info', UNDER_REVIEW: 'info', SCHEDULED: 'info', ASSIGNED: 'info', IN_PROGRESS: 'info', INSPECTION_SCHEDULED: 'info', QUOTATION_DRAFT: 'info', WORK_ORDER_CREATED: 'info', ELIGIBLE: 'info', SENT: 'info', SUBMITTED_FOR_REVIEW: 'info',
  REQUESTED: 'warn', AWAITING_PAYMENT: 'warn', PENDING: 'warn', NEEDS_INFORMATION: 'warn', CHANGES_REQUESTED: 'warn', QUOTATION_SENT: 'warn', READY_FOR_OWNER_REVIEW: 'warn', REWORK_REQUIRED: 'warn', ON_HOLD: 'warn', PAUSED: 'warn', OPEN: 'warn', URGENT: 'warn', DRAFT: 'neutral',
  REJECTED: 'danger', CANCELLED: 'danger', DECLINED: 'danger', EXPIRED: 'danger', FAILED: 'danger', BLOCKED: 'danger', SAFETY_RISK: 'danger', NOT_SERVICEABLE: 'danger', VOID: 'neutral', SUSPENDED: 'danger', WITHDRAWN: 'neutral', SUPERSEDED: 'neutral', ARCHIVED: 'neutral', CLOSED: 'neutral', STANDARD: 'neutral',
};

export const toneOf = (status: string | null | undefined): Tone => (status ? (TONES[status] ?? 'neutral') : 'neutral');
