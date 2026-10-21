import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Quote, type QuoteLineItem, type QuoteType } from '@prisma/client';
import {
  computeQuoteTotals,
  formatQuantityMilli,
  istDateOf,
  istInstant,
  addDays,
  paymentPolicySchema,
  problemMessages,
  quoteDraftSchema,
  quoteMachine,
  quoteSendProblems,
} from '@propcare/shared';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../core/clock';
import { hasFlag, isAdmin, SYSTEM_ACTOR, type Actor, type UserActor } from '../../core/context';
import { AppError, notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { iso, num } from '../../core/serialize';
import { RequestsService } from './requests.service';

type QuoteDraft = z.infer<typeof quoteDraftSchema>;
type QuoteWithLines = Quote & { lineItems: QuoteLineItem[] };

/**
 * Itemised, versioned quotes and change orders (SPEC §6.4, §7 rules 2-5, §8.7 QUO-01/02). Totals
 * are always recomputed on the server; frozen quotes are protected by a database trigger.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly policy: PolicyService,
    private readonly requests: RequestsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Owner view omits drafts and internal cost; FINANCE admins also see cost and margin. */
  serialize(q: QuoteWithLines, actor: Actor) {
    const admin = actor.kind === 'SYSTEM' || isAdmin(actor);
    const finance = actor.kind === 'SYSTEM' || hasFlag(actor, 'FINANCE');
    const lines = [...q.lineItems].sort((a, b) => a.position - b.position);
    const internalCost = finance ? lines.reduce((s, l) => s + (l.internalCostPaise ? num(l.internalCostPaise) : 0), 0) : null;
    return {
      id: q.id,
      reference: q.reference,
      requestId: q.requestId,
      quoteType: q.quoteType,
      workOrderId: q.workOrderId,
      baseQuoteId: q.baseQuoteId,
      version: q.version,
      status: q.status,
      currency: q.currency,
      lineItems: lines.map((l) => ({
        id: l.id,
        position: l.position,
        description: l.description,
        quantity: l.quantity.toFixed(3),
        unit: l.unit,
        unitPricePaise: num(l.unitPricePaise),
        taxRateBps: l.taxRateBps,
        lineTotalPaise: num(l.lineTotalPaise),
        lineTaxPaise: num(l.lineTaxPaise),
        lineType: l.lineType,
        direction: l.direction,
        ...(finance ? { internalCostPaise: num(l.internalCostPaise, true) } : {}),
      })),
      subtotalPaise: num(q.subtotalPaise),
      taxPaise: num(q.taxPaise),
      totalPaise: num(q.totalPaise),
      scope: q.scope,
      exclusions: q.exclusions,
      assumptions: q.assumptions,
      estimatedDuration: q.estimatedDuration,
      validUntil: iso(q.validUntil),
      sentAt: iso(q.sentAt),
      approvedAt: iso(q.approvedAt),
      approvedTotalPaise: num(q.approvedTotalPaise, true),
      createdAt: iso(q.createdAt),
      ...(finance && internalCost !== null ? { internalCostPaise: internalCost, marginPaise: num(q.subtotalPaise) - internalCost } : {}),
      ...(admin ? { sentBy: q.sentBy, createdBy: q.createdBy } : {}),
    };
  }

  async listForRequest(actor: UserActor, requestId: string) {
    await this.requests.findVisible(actor, requestId);
    const rows = await this.prisma.quote.findMany({
      where: { requestId, ...(isAdmin(actor) ? {} : { status: { not: 'DRAFT' } }) },
      include: { lineItems: true },
      orderBy: [{ quoteType: 'asc' }, { version: 'desc' }],
    });
    return { items: rows.map((q) => this.serialize(q, actor)) };
  }

  async get(actor: UserActor, id: string) {
    const q = await this.prisma.quote.findUnique({ where: { id }, include: { lineItems: true } });
    if (!q) throw notFound();
    await this.requests.findVisible(actor, q.requestId);
    if (q.status === 'DRAFT' && !isAdmin(actor)) throw notFound();
    return this.serialize(q, actor);
  }

  private computeLines(lines: QuoteDraft['lineItems']) {
    const totals = computeQuoteTotals(lines.map((l) => ({ ...l, taxRateBps: l.taxRateBps ?? 0 })));
    if (totals.subtotalPaise < 0 || totals.totalPaise < 0) throw validation({ path: 'lineItems', code: 'NEGATIVE_AMOUNT', message: problemMessages.NEGATIVE_AMOUNT });
    return totals;
  }

  private async defaultValidUntil(): Promise<Date> {
    const days = await this.policy.get('quote.default_validity_days');
    return istInstant(addDays(istDateOf(this.clock.now()), days), '23:59');
  }

  private lineRows(quoteId: string, input: QuoteDraft['lineItems'], totals: ReturnType<typeof computeQuoteTotals>): Prisma.QuoteLineItemCreateManyInput[] {
    return totals.lines.map((l, i) => ({
      quoteId,
      position: i,
      description: input[i].description,
      quantity: new Prisma.Decimal(formatQuantityMilli(l.quantityMilli)),
      unit: input[i].unit,
      unitPricePaise: BigInt(l.unitPricePaise),
      taxRateBps: l.taxRateBps,
      lineTotalPaise: BigInt(l.lineTotalPaise),
      lineTaxPaise: BigInt(l.lineTaxPaise),
      lineType: l.lineType,
      direction: l.direction,
      internalCostPaise: input[i].internalCostPaise != null ? BigInt(input[i].internalCostPaise!) : null,
    }));
  }

  /** Creates a draft (ORIGINAL for a request, CHANGE_ORDER for a work order). */
  async createDraft(actor: UserActor, requestId: string, input: QuoteDraft, opts: { workOrderId?: string } = {}) {
    if (input.lineItems.some((l) => l.internalCostPaise != null) && !hasFlag(actor, 'FINANCE')) {
      throw new AppError('FORBIDDEN', [{ code: 'FLAG_REQUIRED:FINANCE' }]);
    }
    const quoteType: QuoteType = opts.workOrderId ? 'CHANGE_ORDER' : 'ORIGINAL';
    const id = await this.prisma.tx(async (tx) => {
      const r = await this.requests.lock(tx, requestId);
      let baseQuoteId: string | null = null;
      if (quoteType === 'ORIGINAL') {
        if (!['UNDER_REVIEW', 'QUOTATION_DRAFT', 'QUOTATION_SENT'].includes(r.status)) throw new AppError('INVALID_STATE_TRANSITION', [{ code: `REQUEST_${r.status}` }]);
        if (await tx.quote.count({ where: { requestId, quoteType, status: 'DRAFT' } })) throw validation({ code: 'DRAFT_EXISTS' });
        if (r.status === 'UNDER_REVIEW') await this.requests.move(tx, r, 'QUOTATION_DRAFT', actor);
      } else {
        const wo = await tx.workOrder.findUnique({ where: { id: opts.workOrderId } });
        if (!wo || wo.requestId !== requestId) throw notFound();
        if (!['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED'].includes(wo.status)) throw new AppError('INVALID_STATE_TRANSITION', [{ code: `WORK_ORDER_${wo.status}` }]);
        baseQuoteId = wo.quoteId;
      }
      const totals = this.computeLines(input.lineItems);
      const latest = await tx.quote.aggregate({ where: { requestId, quoteType }, _max: { version: true } });
      const q = await tx.quote.create({
        data: {
          reference: await this.records.nextReference(tx, 'QUO'),
          requestId,
          quoteType,
          workOrderId: opts.workOrderId ?? null,
          baseQuoteId,
          version: (latest._max.version ?? 0) + 1,
          subtotalPaise: BigInt(totals.subtotalPaise),
          taxPaise: BigInt(totals.taxPaise),
          totalPaise: BigInt(totals.totalPaise),
          scope: input.scope ?? null,
          exclusions: input.exclusions,
          assumptions: input.assumptions,
          estimatedDuration: input.estimatedDuration ?? null,
          validUntil: input.validUntil ? new Date(input.validUntil) : await this.defaultValidUntil(),
          createdBy: actor.userId,
        },
      });
      if (input.lineItems.length) await tx.quoteLineItem.createMany({ data: this.lineRows(q.id, input.lineItems, totals) });
      await this.records.transition(tx, quoteMachine, { entityId: q.id, from: null, to: 'DRAFT', actor, ownerVisible: false });
      await this.records.audit(tx, actor, { action: 'quote.drafted', entityType: 'QUOTE', entityId: q.id, metadata: { requestId, quoteType, version: q.version } });
      return q.id;
    });
    return this.get(actor, id);
  }

  async updateDraft(actor: UserActor, id: string, input: QuoteDraft) {
    if (input.lineItems.some((l) => l.internalCostPaise != null) && !hasFlag(actor, 'FINANCE')) {
      throw new AppError('FORBIDDEN', [{ code: 'FLAG_REQUIRED:FINANCE' }]);
    }
    await this.prisma.tx(async (tx) => {
      const q = await tx.quote.findUnique({ where: { id } });
      if (!q) throw notFound();
      if (q.status !== 'DRAFT') throw new AppError('INVALID_STATE_TRANSITION', [{ code: 'QUOTE_FROZEN' }]);
      const totals = this.computeLines(input.lineItems);
      await tx.quoteLineItem.deleteMany({ where: { quoteId: id } });
      if (input.lineItems.length) await tx.quoteLineItem.createMany({ data: this.lineRows(id, input.lineItems, totals) });
      await tx.quote.update({
        where: { id },
        data: {
          subtotalPaise: BigInt(totals.subtotalPaise),
          taxPaise: BigInt(totals.taxPaise),
          totalPaise: BigInt(totals.totalPaise),
          scope: input.scope ?? null,
          exclusions: input.exclusions,
          assumptions: input.assumptions,
          estimatedDuration: input.estimatedDuration ?? null,
          ...(input.validUntil ? { validUntil: new Date(input.validUntil) } : {}),
        },
      });
    });
    return this.get(actor, id);
  }

  /** Drafts may be hard-deleted with an audit event (SPEC §6.4). */
  async deleteDraft(actor: UserActor, id: string) {
    await this.prisma.tx(async (tx) => {
      const q = await tx.quote.findUnique({ where: { id } });
      if (!q) throw notFound();
      if (q.status !== 'DRAFT') throw new AppError('INVALID_STATE_TRANSITION', [{ code: 'QUOTE_FROZEN' }]);
      const r = await this.requests.lock(tx, q.requestId);
      await tx.quote.delete({ where: { id } });
      await this.records.audit(tx, actor, { action: 'quote.draft_deleted', entityType: 'QUOTE', entityId: id, metadata: { requestId: q.requestId, version: q.version } });
      if (q.quoteType === 'ORIGINAL' && r.status === 'QUOTATION_DRAFT' && !(await tx.quote.count({ where: { requestId: r.id, quoteType: 'ORIGINAL', status: 'DRAFT' } }))) {
        await this.requests.move(tx, r, 'UNDER_REVIEW', actor, 'DRAFT_DELETED');
      }
    });
    return { ok: true };
  }

  /** Freezes and sends a draft; any older SENT version becomes SUPERSEDED in the same transaction. */
  async send(actor: UserActor, id: string) {
    await this.prisma.tx(async (tx) => {
      const pre = await tx.quote.findUnique({ where: { id } });
      if (!pre) throw notFound();
      const r = await this.requests.lock(tx, pre.requestId);
      await tx.$queryRaw`SELECT id FROM quotes WHERE id = ${id}::uuid FOR UPDATE`;
      const q = await tx.quote.findUniqueOrThrow({ where: { id }, include: { lineItems: true } });
      const lines = q.lineItems.map((l) => ({
        quantity: l.quantity.toString(),
        unitPricePaise: num(l.unitPricePaise),
        taxRateBps: l.taxRateBps,
        direction: l.direction,
        lineType: l.lineType,
      }));
      const totals = computeQuoteTotals(lines);
      const problems = quoteSendProblems({ lines, totals, validUntil: q.validUntil, scope: q.scope, now: this.clock.now() });
      if (problems.length) throw validation(...problems.map((code) => ({ code, message: problemMessages[code] })));
      const threshold = await this.policy.get('quote.discount_approval_threshold_bps');
      if (totals.discountBps > threshold && !hasFlag(actor, 'QUOTE_DISCOUNT_APPROVE')) {
        throw new AppError('FORBIDDEN', [{ code: 'DISCOUNT_NEEDS_APPROVAL', message: problemMessages.DISCOUNT_NEEDS_APPROVAL }]);
      }
      if (q.quoteType === 'ORIGINAL' && !['QUOTATION_DRAFT', 'QUOTATION_SENT'].includes(r.status)) {
        throw new AppError('INVALID_STATE_TRANSITION', [{ code: `REQUEST_${r.status}` }]);
      }
      const older = await tx.quote.findMany({ where: { requestId: q.requestId, quoteType: q.quoteType, workOrderId: q.workOrderId, status: 'SENT', id: { not: id } } });
      for (const o of older) {
        await this.records.transition(tx, quoteMachine, { entityId: o.id, from: 'SENT', to: 'SUPERSEDED', actor, reason: `SUPERSEDED_BY_V${q.version}` });
        await tx.quote.update({ where: { id: o.id }, data: { status: 'SUPERSEDED' } });
      }
      await this.records.transition(tx, quoteMachine, { entityId: id, from: 'DRAFT', to: 'SENT', actor });
      await tx.quote.update({
        where: { id },
        data: {
          status: 'SENT',
          sentAt: this.clock.now(),
          sentBy: actor.userId,
          subtotalPaise: BigInt(totals.subtotalPaise),
          taxPaise: BigInt(totals.taxPaise),
          totalPaise: BigInt(totals.totalPaise),
        },
      });
      if (q.quoteType === 'ORIGINAL' && r.status === 'QUOTATION_DRAFT') await this.requests.move(tx, r, 'QUOTATION_SENT', actor);
      await this.records.audit(tx, actor, {
        action: 'quote.sent',
        entityType: 'QUOTE',
        entityId: id,
        metadata: { version: q.version, totalPaise: totals.totalPaise, discountBps: totals.discountBps, superseded: older.map((o) => o.id) },
      });
      await this.records.emit(tx, q.quoteType === 'ORIGINAL' ? 'request.quote_sent' : 'work.change_order', {
        requestId: r.id,
        reference: r.reference,
        ownerUserId: r.ownerUserId,
        quoteReference: q.reference,
        workOrderId: q.workOrderId,
      });
    });
    return this.get(actor, id);
  }

  async withdraw(actor: UserActor, id: string, reason?: string | null) {
    await this.prisma.tx(async (tx) => {
      const q = await tx.quote.findUnique({ where: { id } });
      if (!q) throw notFound();
      const r = await this.requests.lock(tx, q.requestId);
      await this.records.transition(tx, quoteMachine, { entityId: id, from: q.status, to: 'WITHDRAWN', actor, reason });
      const res = await tx.quote.updateMany({ where: { id, status: 'SENT' }, data: { status: 'WITHDRAWN' } });
      if (res.count !== 1) throw new AppError('INVALID_STATE_TRANSITION');
      if (q.quoteType === 'ORIGINAL' && r.status === 'QUOTATION_SENT' && !(await tx.quote.count({ where: { requestId: r.id, quoteType: 'ORIGINAL', status: 'SENT' } }))) {
        await this.requests.move(tx, r, 'UNDER_REVIEW', actor, 'QUOTE_WITHDRAWN');
      }
      await this.records.audit(tx, actor, { action: 'quote.withdrawn', entityType: 'QUOTE', entityId: id, metadata: { reason: reason ?? null } });
    });
    return this.get(actor, id);
  }

  /** Marks a quote EXPIRED in its own transaction so the state persists even though approval fails. */
  private async expire(id: string) {
    await this.prisma.tx(async (tx) => {
      const res = await tx.quote.updateMany({ where: { id, status: 'SENT' }, data: { status: 'EXPIRED' } });
      if (res.count === 1) await this.records.transition(tx, quoteMachine, { entityId: id, from: 'SENT', to: 'EXPIRED', actor: SYSTEM_ACTOR });
    });
  }

  /**
   * Owner approval bound to the exact version and displayed total (SPEC §7 rule 4). Admins can
   * never approve on an owner's behalf — the route only admits OWNER and the machine forbids ADMIN.
   */
  async approve(actor: UserActor, id: string, input: { version: number; displayedTotalPaise: number }, idempotencyKey: string | null) {
    const pre = await this.prisma.quote.findUnique({ where: { id } });
    if (!pre) throw notFound();
    const r0 = await this.requests.findVisible(actor, pre.requestId);
    if (actor.role !== 'OWNER' || r0.ownerUserId !== actor.userId) throw notFound();
    if (pre.status === 'SENT' && pre.validUntil <= this.clock.now()) {
      await this.expire(id);
      throw new AppError('QUOTE_EXPIRED');
    }
    await this.prisma.tx(async (tx) => {
      const r = await this.requests.lock(tx, pre.requestId);
      await tx.$queryRaw`SELECT id FROM quotes WHERE id = ${id}::uuid FOR UPDATE`;
      const q = await tx.quote.findUniqueOrThrow({ where: { id } });
      if (q.status === 'EXPIRED') throw new AppError('QUOTE_EXPIRED');
      const latest = await tx.quote.findFirst({ where: { requestId: q.requestId, quoteType: q.quoteType, workOrderId: q.workOrderId, status: 'SENT' }, orderBy: { version: 'desc' } });
      if (q.status !== 'SENT' || !latest || latest.id !== q.id || q.version !== input.version || num(q.totalPaise) !== input.displayedTotalPaise) {
        throw new AppError('QUOTE_VERSION_STALE');
      }
      if (q.validUntil <= this.clock.now()) throw new AppError('QUOTE_EXPIRED');
      await this.records.transition(tx, quoteMachine, { entityId: id, from: 'SENT', to: 'APPROVED', actor });
      await tx.quote.update({ where: { id }, data: { status: 'APPROVED', approvedBy: actor.userId, approvedAt: this.clock.now(), approvedTotalPaise: q.totalPaise } });
      await tx.quoteDecision.create({
        data: { quoteId: id, userId: actor.userId, version: q.version, decision: 'APPROVED', displayedTotalPaise: BigInt(input.displayedTotalPaise), idempotencyKey },
      });
      if (q.quoteType === 'ORIGINAL') {
        await this.requests.move(tx, r, 'APPROVED', actor);
        await this.createRequirements(tx, r.id, r.categoryId, num(q.totalPaise));
      } else {
        await this.applyChangeOrder(tx, q);
      }
      await this.records.audit(tx, actor, {
        action: 'quote.approved',
        entityType: 'QUOTE',
        entityId: id,
        metadata: { version: q.version, displayedTotalPaise: input.displayedTotalPaise, quoteType: q.quoteType },
      });
      await this.records.emit(tx, 'quote.approved', { quoteId: id, requestId: r.id, reference: r.reference, quoteType: q.quoteType, workOrderId: q.workOrderId });
    });
    return this.get(actor, id);
  }

  async reject(actor: UserActor, id: string, input: { reason?: string | null; requestRevision: boolean }, idempotencyKey: string | null) {
    const pre = await this.prisma.quote.findUnique({ where: { id } });
    if (!pre) throw notFound();
    const r0 = await this.requests.findVisible(actor, pre.requestId);
    if (actor.role !== 'OWNER' || r0.ownerUserId !== actor.userId) throw notFound();
    await this.prisma.tx(async (tx) => {
      const r = await this.requests.lock(tx, pre.requestId);
      const q = await tx.quote.findUniqueOrThrow({ where: { id } });
      await this.records.transition(tx, quoteMachine, { entityId: id, from: q.status, to: 'REJECTED', actor, reason: input.reason });
      const res = await tx.quote.updateMany({ where: { id, status: 'SENT' }, data: { status: 'REJECTED' } });
      if (res.count !== 1) throw new AppError('QUOTE_VERSION_STALE');
      await tx.quoteDecision.create({
        data: { quoteId: id, userId: actor.userId, version: q.version, decision: 'REJECTED', reason: input.reason ?? null, requestRevision: input.requestRevision, idempotencyKey },
      });
      if (q.quoteType === 'ORIGINAL' && r.status === 'QUOTATION_SENT') {
        const otherSent = await tx.quote.count({ where: { requestId: r.id, quoteType: 'ORIGINAL', status: 'SENT' } });
        if (!otherSent) await this.requests.move(tx, r, input.requestRevision ? 'UNDER_REVIEW' : 'REJECTED', actor, input.reason ?? (input.requestRevision ? 'REVISION_REQUESTED' : 'QUOTE_REJECTED'));
      }
      await this.records.audit(tx, actor, { action: 'quote.rejected', entityType: 'QUOTE', entityId: id, metadata: { version: q.version, requestRevision: input.requestRevision } });
      await this.records.emit(tx, 'quote.rejected', { quoteId: id, requestId: r.id, reference: r.reference, requestRevision: input.requestRevision, handledByAdminId: r.handledByAdminId });
    });
    return this.get(actor, id);
  }

  /** Payment requirements from the category payment policy (seed: 100 % on completion). */
  private async createRequirements(tx: Tx, requestId: string, categoryId: string, totalPaise: number) {
    const category = await tx.serviceCategory.findUniqueOrThrow({ where: { id: categoryId } });
    const policy = paymentPolicySchema.parse(category.paymentPolicy ?? {});
    let deposit = 0;
    if (policy.deposit) {
      deposit = Math.floor((totalPaise * policy.deposit.bps) / 10_000);
      if (deposit > 0) {
        await tx.paymentRequirement.create({
          data: { requestId, purpose: 'DEPOSIT', amountPaise: BigInt(deposit), dueTrigger: policy.deposit.dueTrigger, isDue: policy.deposit.dueTrigger === 'ON_QUOTE_APPROVAL' },
        });
      }
    }
    await tx.paymentRequirement.create({
      data: { requestId, purpose: 'FINAL', amountPaise: BigInt(totalPaise - deposit), dueTrigger: 'ON_COMPLETION_ACCEPTED', isDue: false },
    });
  }

  /** approved_total = base quote + approved change orders; the FINAL requirement grows with it. */
  private async applyChangeOrder(tx: Tx, q: Quote) {
    if (!q.workOrderId) return;
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: q.workOrderId } });
    await tx.workOrder.update({ where: { id: wo.id }, data: { approvedTotalPaise: wo.approvedTotalPaise + q.totalPaise } });
    const final = await tx.paymentRequirement.findFirst({ where: { workOrderId: wo.id, purpose: 'FINAL', status: 'PENDING' } });
    if (final) await tx.paymentRequirement.update({ where: { id: final.id }, data: { amountPaise: final.amountPaise + q.totalPaise } });
    else await tx.paymentRequirement.create({ data: { requestId: q.requestId, workOrderId: wo.id, purpose: 'MILESTONE', amountPaise: q.totalPaise, dueTrigger: 'ON_COMPLETION_ACCEPTED' } });
  }

  /** Scheduled: SENT quotes past valid_until become EXPIRED. */
  async expireDue(): Promise<number> {
    const due = await this.prisma.quote.findMany({ where: { status: 'SENT', validUntil: { lte: this.clock.now() } }, select: { id: true }, take: 200 });
    for (const q of due) await this.expire(q.id);
    return due.length;
  }
}
