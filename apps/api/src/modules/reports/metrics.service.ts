import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../core/clock';
import { PrismaService } from '../../core/prisma.service';
import { CommissionService } from '../commission/commission.service';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPEN_REQUEST = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'INSPECTION_SCHEDULED', 'QUOTATION_DRAFT', 'QUOTATION_SENT', 'APPROVED'] as const;

/**
 * Aggregates for the admin dashboard, reports (REP-01) and the AI briefing. Only counts, ageing
 * and identifiers with neutral labels — no personal data (SPEC §8.10, §8.11).
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commission: CommissionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private hours(from: Date | null, now: Date) {
    return from ? Math.max(0, Math.round((now.getTime() - from.getTime()) / HOUR)) : 0;
  }

  async queues() {
    const now = this.clock.now();
    const soon = new Date(now.getTime() + 4 * HOUR);
    const [
      listingsAwaitingReview,
      editedListings,
      verificationsPending,
      requestsByStatus,
      safetyRequests,
      bookingRequestsNearExpiry,
      bookingsRequested,
      bookingsAwaitingPayment,
      blockedWorkOrders,
      workOrdersAwaitingApproval,
      openIssues,
      payoutsEligible,
      payoutsOnHold,
      unresolvedAlerts,
    ] = await Promise.all([
      this.prisma.listing.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.listing.count({ where: { status: 'PUBLISHED', editedSinceReview: true } }),
      this.prisma.verification.count({ where: { status: 'PENDING' } }),
      this.prisma.serviceRequest.groupBy({ by: ['status'], _count: true }),
      this.prisma.serviceRequest.count({ where: { safetyFlag: true, status: { in: [...OPEN_REQUEST] } } }),
      this.prisma.booking.count({ where: { status: 'REQUESTED', requestExpiresAt: { lte: soon } } }),
      this.prisma.booking.count({ where: { status: 'REQUESTED' } }),
      this.prisma.booking.count({ where: { status: 'AWAITING_PAYMENT' } }),
      this.prisma.workOrder.count({ where: { status: 'BLOCKED' } }),
      this.prisma.workOrder.count({ where: { status: 'SUBMITTED_FOR_REVIEW' } }),
      this.prisma.issue.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.payout.count({ where: { status: 'ELIGIBLE' } }),
      this.prisma.payout.count({ where: { status: 'ON_HOLD' } }),
      this.prisma.adminAlert.count({ where: { resolvedAt: null } }),
    ]);
    return {
      listingsAwaitingReview,
      editedListings,
      verificationsPending,
      requestsByStatus: Object.fromEntries(requestsByStatus.map((r) => [r.status, r._count])),
      openRequests: requestsByStatus.filter((r) => (OPEN_REQUEST as readonly string[]).includes(r.status)).reduce((s, r) => s + r._count, 0),
      safetyRequests,
      bookingRequestsNearExpiry,
      bookingsRequested,
      bookingsAwaitingPayment,
      blockedWorkOrders,
      workOrdersAwaitingApproval,
      openIssues,
      payoutsEligible,
      payoutsOnHold,
      unresolvedAlerts,
    };
  }

  /** Top-N items with ids and neutral labels for "needs attention" and AI suggested actions. */
  async attention() {
    const now = this.clock.now();
    const [safety, expiring, listings, blocked, issues, oldRequests] = await Promise.all([
      this.prisma.serviceRequest.findMany({ where: { safetyFlag: true, status: { in: [...OPEN_REQUEST] } }, orderBy: { submittedAt: 'asc' }, take: 5 }),
      this.prisma.booking.findMany({ where: { status: 'REQUESTED' }, orderBy: { requestExpiresAt: 'asc' }, take: 5 }),
      this.prisma.listing.findMany({ where: { status: 'SUBMITTED' }, include: { property: { select: { verificationStatus: true } } }, orderBy: { submittedAt: 'asc' }, take: 5 }),
      this.prisma.workOrder.findMany({ where: { status: 'BLOCKED' }, orderBy: { updatedAt: 'asc' }, take: 5 }),
      this.prisma.issue.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'asc' }, take: 5 }),
      this.prisma.serviceRequest.findMany({ where: { status: 'SUBMITTED' }, orderBy: { submittedAt: 'asc' }, take: 5 }),
    ]);
    return {
      safetyRequests: safety.map((r) => ({ id: r.id, reference: r.reference, ageHours: this.hours(r.submittedAt, now), unassigned: !r.handledByAdminId })),
      unclaimedRequests: oldRequests.map((r) => ({ id: r.id, reference: r.reference, ageHours: this.hours(r.submittedAt, now), urgency: r.urgency })),
      expiringBookingRequests: expiring.map((b) => ({ id: b.id, reference: b.reference, hoursLeft: b.requestExpiresAt ? Math.max(0, Math.round((b.requestExpiresAt.getTime() - now.getTime()) / HOUR)) : null })),
      oldestListings: listings.map((l) => ({ id: l.id, reference: l.reference, waitingHours: this.hours(l.submittedAt, now), propertyVerified: l.property.verificationStatus === 'APPROVED' })),
      blockedWorkOrders: blocked.map((w) => ({ id: w.id, reference: w.reference, reason: w.blockedReason })),
      openIssues: issues.map((i) => ({ id: i.id, reference: i.reference, ageHours: this.hours(i.createdAt, now), subjectType: i.subjectType })),
    };
  }

  async marketplace(from: Date, to: Date) {
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
    const [created, confirmed, cancelled, publishedListings, nightsAgg] = await Promise.all([
      this.prisma.booking.count({ where: { createdAt: { gte: from, lt: to } } }),
      this.prisma.booking.aggregate({
        where: { confirmedAt: { gte: from, lt: to } },
        _count: true,
        _sum: { totalPaise: true, commissionPaise: true, nightsTotalPaise: true, nights: true },
      }),
      this.prisma.booking.count({ where: { cancelledAt: { gte: from, lt: to } } }),
      this.prisma.listing.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.booking.aggregate({ where: { status: { in: ['CONFIRMED', 'COMPLETED'] }, checkInDate: { gte: from, lt: to } }, _sum: { nights: true } }),
    ]);
    const [payoutsDue, payoutsPaid] = await Promise.all([
      this.prisma.payout.aggregate({ where: { status: { in: ['PENDING', 'ELIGIBLE', 'ON_HOLD'] } }, _sum: { amountPaise: true }, _count: true }),
      this.prisma.payout.aggregate({ where: { status: 'PAID', paidAt: { gte: from, lt: to } }, _sum: { amountPaise: true }, _count: true }),
    ]);
    const nights = confirmed._sum.nights ?? 0;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bookingsCreated: created,
      bookingsConfirmed: confirmed._count,
      grossBookingValuePaise: Number(confirmed._sum.totalPaise ?? 0n),
      commissionEarnedPaise: Number(confirmed._sum.commissionPaise ?? 0n),
      cancellations: cancelled,
      cancellationRate: confirmed._count ? Math.round((cancelled / confirmed._count) * 1000) / 10 : 0,
      occupancyRate: publishedListings ? Math.round(((nightsAgg._sum.nights ?? 0) / (publishedListings * days)) * 1000) / 10 : 0,
      averageDailyRatePaise: nights ? Math.round(Number(confirmed._sum.nightsTotalPaise ?? 0n) / nights) : 0,
      requestToBookingConversion: created ? Math.round((confirmed._count / created) * 1000) / 10 : 0,
      publishedListings,
      payoutsDuePaise: Number(payoutsDue._sum.amountPaise ?? 0n),
      payoutsDueCount: payoutsDue._count,
      payoutsPaidPaise: Number(payoutsPaid._sum.amountPaise ?? 0n),
      payoutsPaidCount: payoutsPaid._count,
    };
  }

  async care(from: Date, to: Date) {
    const [received, responded, quotesSent, quotesApproved, completed, rework] = await Promise.all([
      this.prisma.serviceRequest.count({ where: { submittedAt: { gte: from, lt: to } } }),
      this.prisma.serviceRequest.findMany({ where: { submittedAt: { gte: from, lt: to }, firstResponseAt: { not: null } }, select: { submittedAt: true, firstResponseAt: true } }),
      this.prisma.quote.count({ where: { sentAt: { gte: from, lt: to }, quoteType: 'ORIGINAL' } }),
      this.prisma.quote.count({ where: { approvedAt: { gte: from, lt: to }, quoteType: 'ORIGINAL' } }),
      this.prisma.workOrder.count({ where: { completedAt: { gte: from, lt: to }, kind: 'STANDARD' } }),
      this.prisma.workOrder.count({ where: { createdAt: { gte: from, lt: to }, kind: 'REWORK' } }),
    ]);
    const minutes = responded.map((r) => (r.firstResponseAt!.getTime() - r.submittedAt.getTime()) / 60_000).sort((a, b) => a - b);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      requestsReceived: received,
      medianFirstResponseMinutes: minutes.length ? Math.round(minutes[Math.floor(minutes.length / 2)]) : null,
      quotesSent,
      quotesApproved,
      quoteConversion: quotesSent ? Math.round((quotesApproved / quotesSent) * 1000) / 10 : 0,
      workOrdersCompleted: completed,
      reworkOrders: rework,
      reworkRate: completed ? Math.round((rework / completed) * 1000) / 10 : 0,
    };
  }

  async commissionSummary() {
    const c = await this.commission.effective(null);
    return { effectiveBps: c.effectiveBps, benchmarkBps: c.benchmarkBps, undercutBps: c.settings.undercutBps, benchmarkMode: c.settings.benchmarkMode, benchmarks: c.benchmarks };
  }

  /** Everything the dashboard and briefing need, in one object. */
  async snapshot() {
    const now = this.clock.now();
    const from = new Date(now.getTime() - 30 * DAY);
    const [queues, attention, marketplace, care, commission] = await Promise.all([
      this.queues(),
      this.attention(),
      this.marketplace(from, now),
      this.care(from, now),
      this.commissionSummary(),
    ]);
    return { generatedAt: now.toISOString(), queues, attention, marketplace, care, commission };
  }
}
