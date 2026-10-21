import { Inject, Injectable } from '@nestjs/common';
import type { Issue, IssueStatus, Prisma } from '@prisma/client';
import { issueCreateSchema, issueMachine, issueResolveSchema } from '@propcare/shared';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../core/clock';
import { hasFlag, isAdmin, SYSTEM_ACTOR, type Actor, type UserActor } from '../../core/context';
import { AppError, forbidden, notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { afterCursor, iso, num, pageOrder, toPage } from '../../core/serialize';
import { AttachmentsService } from '../attachments/attachments.service';
import { WorkOrdersService } from '../maintenance/work-orders.service';
import { PaymentsService } from '../payments/payments.service';
import { PayoutsService } from '../payouts/payouts.service';
import { ThreadsService } from '../threads/threads.service';

/** Issues on work orders and bookings (SPEC §6.6, §8.8 ISS-01). Issues are never deleted. */
@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly policy: PolicyService,
    private readonly attachments: AttachmentsService,
    private readonly threads: ThreadsService,
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly workOrders: WorkOrdersService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private canSee(actor: Actor, i: Issue): boolean {
    if (actor.kind === 'SYSTEM' || isAdmin(actor)) return true;
    return (actor.role === 'OWNER' && i.ownerUserId === actor.userId) || (actor.role === 'CUSTOMER' && i.customerUserId === actor.userId);
  }

  async findVisible(actor: Actor, id: string): Promise<Issue> {
    const i = await this.prisma.issue.findUnique({ where: { id } });
    if (!i || !this.canSee(actor, i)) throw notFound();
    return i;
  }

  serialize(i: Issue, actor: Actor) {
    const admin = actor.kind === 'SYSTEM' || isAdmin(actor);
    return {
      id: i.id,
      reference: i.reference,
      subjectType: i.subjectType,
      subjectId: i.subjectId,
      category: i.category,
      description: i.description,
      status: i.status,
      raisedByRole: i.raisedByRole,
      resolutionCode: i.resolutionCode,
      visibleSummary: i.visibleSummary,
      resolvedAt: iso(i.resolvedAt),
      closedAt: iso(i.closedAt),
      createdAt: iso(i.createdAt),
      mine: actor.userId === i.raisedByUserId,
      ...(admin ? { internalNote: i.internalNote, handledByAdminId: i.handledByAdminId, ownerUserId: i.ownerUserId, customerUserId: i.customerUserId } : {}),
    };
  }

  private async create(tx: Tx, actor: UserActor, base: Pick<Issue, 'subjectType' | 'subjectId' | 'ownerUserId' | 'customerUserId'>, input: z.infer<typeof issueCreateSchema>) {
    const issue = await tx.issue.create({
      data: {
        ...base,
        reference: await this.records.nextReference(tx, 'ISS'),
        raisedByUserId: actor.userId,
        raisedByRole: actor.role,
        category: input.category,
        description: input.description,
      },
    });
    await this.records.transition(tx, issueMachine, { entityId: issue.id, from: null, to: 'OPEN', actor });
    await this.attachments.link(tx, actor, input.attachmentIds, 'ISSUE', issue.id);
    await this.records.audit(tx, actor, { action: 'issue.opened', entityType: 'ISSUE', entityId: issue.id, metadata: { subjectType: base.subjectType, subjectId: base.subjectId } });
    await this.records.emit(tx, 'issue.opened', {
      issueId: issue.id,
      reference: issue.reference,
      subjectType: base.subjectType,
      subjectId: base.subjectId,
      ownerUserId: base.ownerUserId,
      customerUserId: base.customerUserId,
      raisedBy: actor.userId,
    });
    return issue;
  }

  async raiseOnWorkOrder(actor: UserActor, workOrderId: string, input: z.infer<typeof issueCreateSchema>) {
    const w = await this.workOrders.findVisible(actor, workOrderId);
    if (!isAdmin(actor) && (actor.role !== 'OWNER' || w.ownerUserId !== actor.userId)) throw notFound();
    if (!['READY_FOR_OWNER_REVIEW', 'COMPLETED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW', 'REWORK_REQUIRED', 'BLOCKED'].includes(w.status)) {
      throw new AppError('INVALID_STATE_TRANSITION', [{ code: `WORK_ORDER_${w.status}` }]);
    }
    if (w.status === 'COMPLETED' && w.completedAt) {
      const days = await this.policy.get('issue.complaint_window_days');
      if (this.clock.now().getTime() > w.completedAt.getTime() + days * 86_400_000) throw validation({ code: 'COMPLAINT_WINDOW_CLOSED' });
    }
    const issue = await this.prisma.tx((tx) => this.create(tx, actor, { subjectType: 'WORK_ORDER', subjectId: w.id, ownerUserId: w.ownerUserId, customerUserId: null }, input));
    return this.serialize(issue, actor);
  }

  async raiseOnBooking(actor: UserActor, bookingId: string, input: z.infer<typeof issueCreateSchema>) {
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    const participant = b && (isAdmin(actor) || (actor.role === 'CUSTOMER' && b.customerUserId === actor.userId) || (actor.role === 'OWNER' && b.ownerUserId === actor.userId));
    if (!b || !participant) throw notFound();
    if (!['CONFIRMED', 'COMPLETED'].includes(b.status)) throw new AppError('INVALID_STATE_TRANSITION', [{ code: `BOOKING_${b.status}` }]);
    if (b.status === 'COMPLETED' && b.completedAt) {
      const days = await this.policy.get('issue.complaint_window_days');
      if (this.clock.now().getTime() > b.completedAt.getTime() + days * 86_400_000) throw validation({ code: 'COMPLAINT_WINDOW_CLOSED' });
    }
    const issue = await this.prisma.tx(async (tx) => {
      const created = await this.create(tx, actor, { subjectType: 'BOOKING', subjectId: b.id, ownerUserId: b.ownerUserId, customerUserId: b.customerUserId }, input);
      // An open booking issue holds the related payout (SPEC §6.6, §7 rule 17).
      await this.payouts.holdForIssue(tx, b.id);
      return created;
    });
    return this.serialize(issue, actor);
  }

  async list(actor: UserActor, status: IssueStatus | undefined, cursor: string | undefined, limit: number) {
    const scope: Prisma.IssueWhereInput = isAdmin(actor)
      ? {}
      : actor.role === 'OWNER'
        ? { ownerUserId: actor.userId }
        : { customerUserId: actor.userId };
    const rows = await this.prisma.issue.findMany({
      where: { ...scope, ...(status ? { status } : {}), ...afterCursor(cursor) },
      orderBy: pageOrder,
      take: limit + 1,
    });
    return toPage(rows, limit, (i) => this.serialize(i, actor));
  }

  async get(actor: UserActor, id: string) {
    const i = await this.findVisible(actor, id);
    const events = await this.prisma.statusEvent.findMany({ where: { entityType: 'ISSUE', entityId: id }, orderBy: { createdAt: 'asc' } });
    const attachments = await this.attachments.listFor('ISSUE', id, { includeInternal: isAdmin(actor) });
    const reopenDays = await this.policy.get('issue.reopen_window_days');
    const reworkOrders = await this.prisma.workOrder.findMany({ where: { issueId: id }, select: { id: true, reference: true, status: true } });
    let subject: Record<string, unknown> | null = null;
    if (i.subjectType === 'BOOKING') {
      const b = await this.prisma.booking.findUnique({ where: { id: i.subjectId }, include: { payout: true, payments: true } });
      subject = b
        ? {
            reference: b.reference,
            status: b.status,
            totalPaise: num(b.totalPaise),
            refundPaise: num(b.refundPaise),
            ...(isAdmin(actor) ? { payout: b.payout ? { id: b.payout.id, status: b.payout.status, amountPaise: num(b.payout.amountPaise) } : null } : {}),
          }
        : null;
    } else {
      const w = await this.prisma.workOrder.findUnique({ where: { id: i.subjectId } });
      subject = w ? { reference: w.reference, status: w.status, requestId: w.requestId } : null;
    }
    return {
      ...this.serialize(i, actor),
      subject,
      timeline: events.map((e) => ({ from: e.fromStatus, to: e.toStatus, actorRole: e.actorRole, at: iso(e.createdAt) })),
      attachments: attachments.map((a) => this.attachments.receipt(a)),
      reworkOrders,
      canReopen: i.status === 'RESOLVED' && i.raisedByUserId === actor.userId && !!i.resolvedAt && this.clock.now().getTime() <= i.resolvedAt.getTime() + reopenDays * 86_400_000,
    };
  }

  private async move(tx: Tx, i: Issue, to: IssueStatus, actor: Actor, data: Prisma.IssueUpdateInput = {}, reason?: string | null) {
    await this.records.transition(tx, issueMachine, { entityId: i.id, from: i.status, to, actor, reason });
    const res = await tx.issue.updateMany({ where: { id: i.id, status: i.status }, data: { status: to, ...(data as Prisma.IssueUpdateManyMutationInput) } });
    if (res.count !== 1) throw new AppError('INVALID_STATE_TRANSITION');
  }

  async postMessage(actor: UserActor, id: string, input: { body: string; visibility: 'PARTICIPANT' | 'INTERNAL'; attachmentIds: string[] }) {
    await this.findVisible(actor, id);
    await this.prisma.tx((tx) => this.threads.post(tx, actor, 'ISSUE', id, input));
    return this.threads.list(actor, 'ISSUE', id);
  }

  async take(actor: UserActor, id: string) {
    await this.prisma.tx(async (tx) => {
      const i = await tx.issue.findUniqueOrThrow({ where: { id } });
      await this.move(tx, i, 'IN_PROGRESS', actor, { handledByAdminId: actor.userId });
    });
    return this.get(actor, id);
  }

  /** Resolve with a resolution code and internal note; refunds and payout adjustments need FINANCE. */
  async resolve(actor: UserActor, id: string, input: z.infer<typeof issueResolveSchema>) {
    const financial = (input.refundPaise ?? 0) > 0 || (input.payoutAdjustmentPaise ?? 0) > 0;
    if (financial && !hasFlag(actor, 'FINANCE')) throw forbidden('FLAG_REQUIRED:FINANCE');
    const refundIds: string[] = [];
    await this.prisma.tx(async (tx) => {
      const i = await tx.issue.findUnique({ where: { id } });
      if (!i) throw notFound();
      if (financial && i.subjectType !== 'BOOKING') throw validation({ code: 'FINANCIAL_REMEDY_BOOKING_ONLY' });
      if (input.refundPaise) {
        const payment = await tx.payment.findFirst({ where: { bookingId: i.subjectId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } } });
        if (!payment) throw validation({ path: 'refundPaise', code: 'NO_PAYMENT' });
        const refund = await this.payments.createRefund(tx, {
          paymentId: payment.id,
          amountPaise: input.refundPaise,
          reason: `ISSUE_${i.reference}`,
          approvedBy: actor.userId,
          idempotencyKey: `issue:${i.id}:${input.refundPaise}`,
        });
        if (refund) refundIds.push(refund.id);
        await tx.booking.update({ where: { id: i.subjectId }, data: { refundPaise: { increment: BigInt(input.refundPaise) } } });
      }
      if (input.payoutAdjustmentPaise) await this.payouts.adjust(tx, actor, i.subjectId, input.payoutAdjustmentPaise);
      await this.move(tx, i, 'RESOLVED', actor, {
        resolutionCode: input.resolutionCode,
        internalNote: input.internalNote,
        visibleSummary: input.visibleSummary ?? null,
        resolvedAt: this.clock.now(),
        handledByAdminId: i.handledByAdminId ?? actor.userId,
      });
      if (i.subjectType === 'BOOKING') await this.payouts.releaseIssueHold(tx, i.subjectId);
      await this.records.audit(tx, actor, {
        action: 'issue.resolved',
        entityType: 'ISSUE',
        entityId: id,
        metadata: { resolutionCode: input.resolutionCode, refundPaise: input.refundPaise ?? 0, payoutAdjustmentPaise: input.payoutAdjustmentPaise ?? 0 },
      });
      await this.records.emit(tx, 'issue.resolved', { issueId: id, reference: i.reference, raisedBy: i.raisedByUserId, subjectType: i.subjectType, subjectId: i.subjectId });
    });
    if (refundIds.length) await this.payments.processRefunds(refundIds);
    return this.get(actor, id);
  }

  async close(actor: Actor, id: string) {
    await this.prisma.tx(async (tx) => {
      const i = await tx.issue.findUniqueOrThrow({ where: { id } });
      if (!i.resolutionCode || !i.internalNote) throw validation({ code: 'RESOLUTION_REQUIRED' });
      await this.move(tx, i, 'CLOSED', actor, { closedAt: this.clock.now() });
    });
  }

  async reopen(actor: UserActor, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const i = await tx.issue.findUnique({ where: { id } });
      if (!i || !this.canSee(actor, i) || i.raisedByUserId !== actor.userId) throw notFound();
      const days = await this.policy.get('issue.reopen_window_days');
      if (!i.resolvedAt || this.clock.now().getTime() > i.resolvedAt.getTime() + days * 86_400_000) throw validation({ code: 'REOPEN_WINDOW_CLOSED' });
      await this.move(tx, i, 'OPEN', actor, { resolvedAt: null }, reason);
      if (i.subjectType === 'BOOKING') await this.payouts.holdForIssue(tx, i.subjectId);
      await this.records.audit(tx, actor, { action: 'issue.reopened', entityType: 'ISSUE', entityId: id, metadata: { reason } });
      await this.records.emit(tx, 'issue.opened', { issueId: id, reference: i.reference, subjectType: i.subjectType, subjectId: i.subjectId, ownerUserId: i.ownerUserId, customerUserId: i.customerUserId, raisedBy: actor.userId, reopened: true });
    });
    return this.get(actor, id);
  }

  async createRework(actor: UserActor, id: string) {
    const woId = await this.prisma.tx(async (tx) => {
      const i = await tx.issue.findUnique({ where: { id } });
      if (!i) throw notFound();
      if (i.subjectType !== 'WORK_ORDER') throw validation({ code: 'WORK_ORDER_ISSUES_ONLY' });
      if (i.status === 'CLOSED') throw new AppError('INVALID_STATE_TRANSITION');
      const parent = await tx.workOrder.findUniqueOrThrow({ where: { id: i.subjectId } });
      const w = await this.workOrders.createRework(tx, actor, i.id, parent);
      if (i.status === 'OPEN') await this.move(tx, i, 'IN_PROGRESS', actor, { handledByAdminId: actor.userId });
      return w.id;
    });
    return { workOrderId: woId };
  }

  /** Scheduled: resolved issues close once the reopen window passes. */
  async closeLapsed(): Promise<number> {
    const days = await this.policy.get('issue.reopen_window_days');
    const cutoff = new Date(this.clock.now().getTime() - days * 86_400_000);
    const due = await this.prisma.issue.findMany({ where: { status: 'RESOLVED', resolvedAt: { lte: cutoff } }, select: { id: true }, take: 200 });
    for (const d of due) await this.close(SYSTEM_ACTOR, d.id).catch(() => undefined);
    return due.length;
  }
}
