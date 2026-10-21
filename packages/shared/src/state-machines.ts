/**
 * Shared transition tables (SPEC §6). The API validates every status change against these tables
 * inside a transaction and records a status_event; illegal transitions return 409.
 * Permission flags (e.g. COMPLETION_APPROVE) are checked by the services on top of the actor kind.
 */
import type {
  BookingStatus,
  InspectionStatus,
  IssueStatus,
  ListingStatus,
  PayoutStatus,
  QuoteStatus,
  RequestStatus,
  VerificationStatus,
  WorkOrderStatus,
} from './enums';

export type ActorKind = 'OWNER' | 'CUSTOMER' | 'ADMIN' | 'SYSTEM';

export interface TransitionRule<S extends string> {
  from: S | null;
  to: S;
  actors: readonly ActorKind[];
}

export interface StateMachine<S extends string> {
  entity: string;
  terminal: readonly S[];
  rules: readonly TransitionRule<S>[];
}

function expand<S extends string>(from: readonly (S | null)[], to: S, actors: readonly ActorKind[]): TransitionRule<S>[] {
  return from.map((f) => ({ from: f, to, actors }));
}

export function findTransition<S extends string>(
  machine: StateMachine<S>,
  from: S | null,
  to: S,
  actor: ActorKind,
): TransitionRule<S> | undefined {
  return machine.rules.find((r) => r.from === from && r.to === to && r.actors.includes(actor));
}

export function canTransition<S extends string>(machine: StateMachine<S>, from: S | null, to: S, actor: ActorKind): boolean {
  return findTransition(machine, from, to, actor) !== undefined;
}

export function allowedTargets<S extends string>(machine: StateMachine<S>, from: S | null, actor: ActorKind): S[] {
  return [...new Set(machine.rules.filter((r) => r.from === from && r.actors.includes(actor)).map((r) => r.to))];
}

// --- Service request (§6.3) --------------------------------------------------------------------
const REQ_BEFORE_WO: RequestStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_INFORMATION',
  'INSPECTION_SCHEDULED',
  'QUOTATION_DRAFT',
  'QUOTATION_SENT',
  'APPROVED',
];
const REQ_BEFORE_APPROVED: RequestStatus[] = REQ_BEFORE_WO.filter((s) => s !== 'APPROVED');

export const serviceRequestMachine: StateMachine<RequestStatus> = {
  entity: 'SERVICE_REQUEST',
  terminal: ['REJECTED', 'CANCELLED', 'NOT_SERVICEABLE'],
  rules: [
    ...expand<RequestStatus>([null], 'SUBMITTED', ['OWNER', 'ADMIN', 'SYSTEM']),
    ...expand<RequestStatus>(['SUBMITTED'], 'UNDER_REVIEW', ['ADMIN']),
    ...expand<RequestStatus>(['SUBMITTED', 'UNDER_REVIEW'], 'NEEDS_INFORMATION', ['ADMIN']),
    ...expand<RequestStatus>(['NEEDS_INFORMATION'], 'UNDER_REVIEW', ['OWNER', 'ADMIN']),
    ...expand<RequestStatus>(['UNDER_REVIEW'], 'INSPECTION_SCHEDULED', ['ADMIN']),
    ...expand<RequestStatus>(['INSPECTION_SCHEDULED'], 'UNDER_REVIEW', ['ADMIN']),
    ...expand<RequestStatus>(['UNDER_REVIEW'], 'QUOTATION_DRAFT', ['ADMIN']),
    // Deleting the only draft returns the request to review (docs/DECISIONS.md).
    ...expand<RequestStatus>(['QUOTATION_DRAFT'], 'UNDER_REVIEW', ['ADMIN']),
    ...expand<RequestStatus>(['QUOTATION_DRAFT'], 'QUOTATION_SENT', ['ADMIN']),
    ...expand<RequestStatus>(['QUOTATION_SENT'], 'APPROVED', ['OWNER']),
    ...expand<RequestStatus>(['QUOTATION_SENT'], 'UNDER_REVIEW', ['OWNER', 'ADMIN']),
    ...expand<RequestStatus>(['QUOTATION_SENT'], 'REJECTED', ['OWNER']),
    ...expand<RequestStatus>(['APPROVED'], 'WORK_ORDER_CREATED', ['ADMIN']),
    ...expand<RequestStatus>(REQ_BEFORE_WO, 'CANCELLED', ['OWNER', 'ADMIN']),
    ...expand<RequestStatus>(['WORK_ORDER_CREATED'], 'CANCELLED', ['SYSTEM']),
    ...expand<RequestStatus>(REQ_BEFORE_APPROVED, 'REJECTED', ['ADMIN']),
    ...expand<RequestStatus>([...REQ_BEFORE_WO, 'WORK_ORDER_CREATED'], 'NOT_SERVICEABLE', ['ADMIN']),
  ],
};

// --- Quote (§6.4) ------------------------------------------------------------------------------
export const quoteMachine: StateMachine<QuoteStatus> = {
  entity: 'QUOTE',
  terminal: ['APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN', 'EXPIRED'],
  rules: [
    ...expand<QuoteStatus>([null], 'DRAFT', ['ADMIN']),
    ...expand<QuoteStatus>(['DRAFT'], 'SENT', ['ADMIN']),
    ...expand<QuoteStatus>(['SENT'], 'APPROVED', ['OWNER']),
    ...expand<QuoteStatus>(['SENT'], 'REJECTED', ['OWNER']),
    ...expand<QuoteStatus>(['SENT'], 'SUPERSEDED', ['ADMIN', 'SYSTEM']),
    ...expand<QuoteStatus>(['SENT'], 'WITHDRAWN', ['ADMIN']),
    ...expand<QuoteStatus>(['SENT'], 'EXPIRED', ['SYSTEM']),
  ],
};

// --- Work order (§6.5) -------------------------------------------------------------------------
export const workOrderMachine: StateMachine<WorkOrderStatus> = {
  entity: 'WORK_ORDER',
  terminal: ['COMPLETED', 'CANCELLED'],
  rules: [
    ...expand<WorkOrderStatus>([null], 'DRAFT', ['ADMIN']),
    ...expand<WorkOrderStatus>(['DRAFT'], 'SCHEDULED', ['ADMIN']),
    ...expand<WorkOrderStatus>(['SCHEDULED'], 'ASSIGNED', ['ADMIN']),
    ...expand<WorkOrderStatus>(['ASSIGNED'], 'IN_PROGRESS', ['ADMIN']),
    ...expand<WorkOrderStatus>(['IN_PROGRESS'], 'BLOCKED', ['ADMIN']),
    ...expand<WorkOrderStatus>(['BLOCKED'], 'IN_PROGRESS', ['ADMIN']),
    ...expand<WorkOrderStatus>(['IN_PROGRESS'], 'SUBMITTED_FOR_REVIEW', ['ADMIN']),
    ...expand<WorkOrderStatus>(['SUBMITTED_FOR_REVIEW'], 'REWORK_REQUIRED', ['ADMIN']),
    ...expand<WorkOrderStatus>(['REWORK_REQUIRED'], 'IN_PROGRESS', ['ADMIN']),
    ...expand<WorkOrderStatus>(['SUBMITTED_FOR_REVIEW'], 'READY_FOR_OWNER_REVIEW', ['ADMIN']),
    ...expand<WorkOrderStatus>(['READY_FOR_OWNER_REVIEW'], 'COMPLETED', ['OWNER', 'SYSTEM']),
    ...expand<WorkOrderStatus>(['DRAFT', 'SCHEDULED', 'ASSIGNED'], 'CANCELLED', ['OWNER', 'ADMIN']),
    ...expand<WorkOrderStatus>(['IN_PROGRESS', 'BLOCKED'], 'CANCELLED', ['ADMIN']),
  ],
};

// --- Issue (§6.6) ------------------------------------------------------------------------------
export const issueMachine: StateMachine<IssueStatus> = {
  entity: 'ISSUE',
  terminal: ['CLOSED'],
  rules: [
    ...expand<IssueStatus>([null], 'OPEN', ['OWNER', 'CUSTOMER', 'ADMIN']),
    ...expand<IssueStatus>(['OPEN'], 'IN_PROGRESS', ['ADMIN']),
    ...expand<IssueStatus>(['OPEN', 'IN_PROGRESS'], 'RESOLVED', ['ADMIN']),
    ...expand<IssueStatus>(['RESOLVED'], 'OPEN', ['OWNER', 'CUSTOMER']),
    ...expand<IssueStatus>(['RESOLVED'], 'CLOSED', ['ADMIN', 'SYSTEM']),
  ],
};

// --- Inspection, verification (§6.7) ------------------------------------------------------------
export const inspectionMachine: StateMachine<InspectionStatus> = {
  entity: 'INSPECTION',
  terminal: ['COMPLETED', 'CANCELLED', 'NO_ACCESS'],
  rules: [
    ...expand<InspectionStatus>([null], 'SCHEDULED', ['ADMIN']),
    ...expand<InspectionStatus>(['SCHEDULED'], 'COMPLETED', ['ADMIN']),
    ...expand<InspectionStatus>(['SCHEDULED'], 'CANCELLED', ['ADMIN']),
    ...expand<InspectionStatus>(['SCHEDULED'], 'NO_ACCESS', ['ADMIN']),
  ],
};

export const verificationMachine: StateMachine<VerificationStatus> = {
  entity: 'VERIFICATION',
  terminal: [],
  rules: [
    ...expand<VerificationStatus>([null, 'NOT_SUBMITTED', 'REJECTED', 'EXPIRED'], 'PENDING', ['OWNER']),
    ...expand<VerificationStatus>(['PENDING'], 'APPROVED', ['ADMIN']),
    ...expand<VerificationStatus>(['PENDING'], 'REJECTED', ['ADMIN']),
    ...expand<VerificationStatus>(['APPROVED'], 'EXPIRED', ['SYSTEM']),
  ],
};

// --- Listing (§6.8) ----------------------------------------------------------------------------
const LISTING_NON_TERMINAL: ListingStatus[] = ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'PUBLISHED', 'PAUSED', 'REJECTED'];

export const listingMachine: StateMachine<ListingStatus> = {
  entity: 'LISTING',
  terminal: ['ARCHIVED'],
  rules: [
    ...expand<ListingStatus>([null], 'DRAFT', ['OWNER', 'ADMIN']),
    ...expand<ListingStatus>(['DRAFT', 'CHANGES_REQUESTED'], 'SUBMITTED', ['OWNER', 'ADMIN']),
    ...expand<ListingStatus>(['SUBMITTED'], 'CHANGES_REQUESTED', ['ADMIN']),
    ...expand<ListingStatus>(['SUBMITTED'], 'PUBLISHED', ['ADMIN']),
    ...expand<ListingStatus>(['SUBMITTED'], 'REJECTED', ['ADMIN']),
    ...expand<ListingStatus>(['PUBLISHED'], 'PAUSED', ['OWNER', 'ADMIN']),
    ...expand<ListingStatus>(['PAUSED'], 'PUBLISHED', ['OWNER', 'ADMIN']),
    // A material location change forces re-review (also while paused; docs/DECISIONS.md).
    ...expand<ListingStatus>(['PUBLISHED', 'PAUSED'], 'SUBMITTED', ['SYSTEM']),
    ...expand<ListingStatus>(LISTING_NON_TERMINAL, 'ARCHIVED', ['OWNER', 'ADMIN']),
  ],
};

// --- Booking (§6.9) ----------------------------------------------------------------------------
export const bookingMachine: StateMachine<BookingStatus> = {
  entity: 'BOOKING',
  terminal: ['DECLINED', 'EXPIRED', 'CANCELLED', 'COMPLETED'],
  rules: [
    ...expand<BookingStatus>([null], 'REQUESTED', ['CUSTOMER']),
    ...expand<BookingStatus>([null], 'AWAITING_PAYMENT', ['CUSTOMER']),
    ...expand<BookingStatus>(['REQUESTED'], 'AWAITING_PAYMENT', ['OWNER', 'ADMIN']),
    ...expand<BookingStatus>(['REQUESTED'], 'DECLINED', ['OWNER', 'ADMIN']),
    ...expand<BookingStatus>(['REQUESTED'], 'EXPIRED', ['SYSTEM']),
    ...expand<BookingStatus>(['REQUESTED', 'AWAITING_PAYMENT'], 'CANCELLED', ['CUSTOMER', 'ADMIN']),
    ...expand<BookingStatus>(['AWAITING_PAYMENT'], 'CONFIRMED', ['SYSTEM']),
    ...expand<BookingStatus>(['AWAITING_PAYMENT'], 'EXPIRED', ['SYSTEM']),
    // A late payment re-acquires the dates if they are still free (§6.9).
    ...expand<BookingStatus>(['EXPIRED'], 'CONFIRMED', ['SYSTEM']),
    ...expand<BookingStatus>(['CONFIRMED'], 'CANCELLED', ['CUSTOMER', 'OWNER', 'ADMIN']),
    ...expand<BookingStatus>(['CONFIRMED'], 'COMPLETED', ['SYSTEM']),
  ],
};

// --- Payout (§6.10) ----------------------------------------------------------------------------
export const payoutMachine: StateMachine<PayoutStatus> = {
  entity: 'PAYOUT',
  terminal: ['PAID', 'VOID'],
  rules: [
    ...expand<PayoutStatus>([null], 'PENDING', ['SYSTEM']),
    ...expand<PayoutStatus>(['PENDING'], 'ELIGIBLE', ['SYSTEM']),
    ...expand<PayoutStatus>(['PENDING', 'ELIGIBLE'], 'ON_HOLD', ['ADMIN', 'SYSTEM']),
    ...expand<PayoutStatus>(['ON_HOLD'], 'PENDING', ['ADMIN', 'SYSTEM']),
    ...expand<PayoutStatus>(['ON_HOLD'], 'ELIGIBLE', ['ADMIN', 'SYSTEM']),
    ...expand<PayoutStatus>(['ELIGIBLE'], 'PAID', ['ADMIN']),
    ...expand<PayoutStatus>(['PENDING', 'ELIGIBLE', 'ON_HOLD'], 'VOID', ['ADMIN', 'SYSTEM']),
  ],
};

export const STATE_MACHINES = {
  SERVICE_REQUEST: serviceRequestMachine,
  QUOTE: quoteMachine,
  WORK_ORDER: workOrderMachine,
  ISSUE: issueMachine,
  INSPECTION: inspectionMachine,
  VERIFICATION: verificationMachine,
  LISTING: listingMachine,
  BOOKING: bookingMachine,
  PAYOUT: payoutMachine,
} as const;

export type MachineName = keyof typeof STATE_MACHINES;
