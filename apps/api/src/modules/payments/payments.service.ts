import { Inject, Injectable } from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';
import { MockPaymentProvider, PAYMENT_PROVIDER, type PaymentProvider, type WebhookEvent } from '../../adapters/payments';
import { CLOCK, type Clock } from '../../core/clock';
import { isAdmin, SYSTEM_ACTOR, type Actor, type UserActor } from '../../core/context';
import { sha256 } from '../../core/crypto';
import { AppError, notFound, validation } from '../../core/errors';
import { errorFields, log } from '../../core/logger';
import { isUniqueViolation, PrismaService, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { iso, num } from '../../core/serialize';

export type SettlementKind = 'BOOKING' | 'REQUIREMENT';

export interface SettlementHandler {
  /** Runs inside the webhook transaction after the payment is marked SUCCEEDED. Returns refund ids to process. */
  onSucceeded(tx: Tx, payment: Payment): Promise<{ refundIds?: string[] } | void>;
  onFailed?(tx: Tx, payment: Payment): Promise<void>;
}

const MAX_REFUND_ATTEMPTS = 5;

/**
 * Payments, webhooks and refunds (SPEC §8.9). A browser "success" is never trusted: state changes
 * only on a verified, deduplicated webhook. Card data and UPI PINs never reach this system.
 */
@Injectable()
export class PaymentsService {
  private readonly handlers = new Map<SettlementKind, SettlementHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  registerSettlement(kind: SettlementKind, handler: SettlementHandler): void {
    this.handlers.set(kind, handler);
  }

  serialize(p: Payment) {
    return {
      id: p.id,
      status: p.status,
      amountPaise: num(p.amountPaise),
      refundedPaise: num(p.refundedPaise),
      currency: p.currency,
      provider: p.provider,
      checkoutUrl: p.status === 'PENDING' ? p.checkoutUrl : null,
      paidAt: iso(p.paidAt),
      bookingId: p.bookingId,
      requirementId: p.requirementId,
      createdAt: iso(p.createdAt),
    };
  }

  /** Creates (or reuses) a pending payment for a booking or a maintenance requirement. */
  async initiate(input: {
    payerUserId: string;
    amountPaise: number;
    bookingId?: string;
    requirementId?: string;
    reference: string;
    returnPath: string;
  }) {
    if (input.amountPaise <= 0) throw validation({ code: 'NOTHING_TO_PAY' });
    const existing = await this.prisma.payment.findFirst({
      where: {
        bookingId: input.bookingId ?? null,
        requirementId: input.requirementId ?? null,
        status: 'PENDING',
        amountPaise: BigInt(input.amountPaise),
        provider: this.provider.name,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.serialize(existing);
    const idempotencyKey = sha256(`${input.bookingId ?? input.requirementId}:${input.amountPaise}:${Date.now()}`).slice(0, 32);
    const created = await this.provider.createPayment({
      amountPaise: input.amountPaise,
      reference: input.reference,
      idempotencyKey,
      returnPath: input.returnPath,
    });
    const payment = await this.prisma.payment.create({
      data: {
        bookingId: input.bookingId ?? null,
        requirementId: input.requirementId ?? null,
        payerUserId: input.payerUserId,
        provider: this.provider.name,
        providerPaymentId: created.providerPaymentId,
        amountPaise: BigInt(input.amountPaise),
        checkoutUrl: created.checkoutUrl,
        idempotencyKey,
      },
    });
    await this.records.audit(this.prisma, { kind: 'SYSTEM', userId: null, role: 'SYSTEM' }, {
      action: 'payment.initiated',
      entityType: 'PAYMENT',
      entityId: payment.id,
      metadata: { bookingId: input.bookingId ?? null, requirementId: input.requirementId ?? null, amountPaise: input.amountPaise },
    });
    return this.serialize(payment);
  }

  async get(actor: UserActor, id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p || (!isAdmin(actor) && p.payerUserId !== actor.userId)) throw notFound();
    return this.serialize(p);
  }

  /**
   * Verified, idempotent webhook processing: dedupe by provider event ID, then apply the event to
   * the payment under a row lock. Late or out-of-order events never move a payment backwards.
   */
  async handleWebhook(providerName: string, rawBody: Buffer | undefined, headers: Record<string, string | undefined>) {
    if (providerName !== this.provider.name || !rawBody) throw new AppError('NOT_FOUND');
    let event: WebhookEvent;
    try {
      event = this.provider.verifyWebhook(rawBody, headers);
    } catch {
      log.warn('webhook_signature_invalid', { provider: providerName });
      throw new AppError('UNAUTHENTICATED', [{ code: 'INVALID_SIGNATURE' }]);
    }
    try {
      await this.prisma.paymentEvent.create({
        data: {
          provider: providerName,
          providerEventId: event.eventId,
          eventType: event.type,
          providerPaymentId: event.providerPaymentId,
          payloadHash: sha256(rawBody),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { received: true, duplicate: true };
      throw err;
    }

    const refundIds: string[] = [];
    const note = await this.prisma.tx(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM payments WHERE provider = ${providerName} AND provider_payment_id = ${event.providerPaymentId} FOR UPDATE`;
      if (!locked.length) {
        await this.records.alert(tx, 'WEBHOOK_UNMATCHED', 'PAYMENT', null, { providerPaymentId: event.providerPaymentId, type: event.type });
        return 'UNMATCHED';
      }
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: locked[0].id } });
      switch (event.type) {
        case 'payment.succeeded': {
          if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED' || payment.status === 'PARTIALLY_REFUNDED') return 'ALREADY_SUCCEEDED';
          if (BigInt(event.amountPaise) !== payment.amountPaise) {
            await this.records.alert(tx, 'WEBHOOK_UNMATCHED', 'PAYMENT', payment.id, { reason: 'AMOUNT_MISMATCH' });
            return 'AMOUNT_MISMATCH';
          }
          const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', paidAt: this.clock.now(), failureReason: null } });
          await this.records.audit(tx, SYSTEM_ACTOR, { action: 'payment.succeeded', entityType: 'PAYMENT', entityId: payment.id, metadata: { eventId: event.eventId } });
          await this.issueReceipt(tx, updated);
          const handler = this.handlers.get(updated.bookingId ? 'BOOKING' : 'REQUIREMENT');
          const result = await handler?.onSucceeded(tx, updated);
          if (result && result.refundIds) refundIds.push(...result.refundIds);
          await this.records.emit(tx, 'payment.succeeded', { paymentId: payment.id, payerUserId: payment.payerUserId, bookingId: payment.bookingId, requirementId: payment.requirementId });
          return 'APPLIED';
        }
        case 'payment.failed': {
          // A failure that arrives after a success (out of order) is ignored.
          if (payment.status !== 'PENDING') return 'IGNORED_NOT_PENDING';
          const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'PROVIDER_DECLINED' } });
          await this.handlers.get(updated.bookingId ? 'BOOKING' : 'REQUIREMENT')?.onFailed?.(tx, updated);
          await this.records.emit(tx, 'payment.failed', { paymentId: payment.id, payerUserId: payment.payerUserId, bookingId: payment.bookingId, requirementId: payment.requirementId });
          return 'APPLIED';
        }
        case 'refund.succeeded':
        case 'refund.failed': {
          const refund = event.providerRefundId
            ? await tx.refund.findFirst({ where: { paymentId: payment.id, providerRefundId: event.providerRefundId } })
            : null;
          if (!refund || refund.status !== 'PENDING') return 'IGNORED';
          if (event.type === 'refund.succeeded') await this.applyRefundSuccess(tx, refund.id);
          else await tx.refund.update({ where: { id: refund.id }, data: { status: 'FAILED', lastError: 'PROVIDER_FAILED' } });
          return 'APPLIED';
        }
      }
    });
    await this.prisma.paymentEvent.update({
      where: { provider_providerEventId: { provider: providerName, providerEventId: event.eventId } },
      data: { processedAt: this.clock.now(), processingNote: note },
    });
    if (refundIds.length) await this.processRefunds(refundIds);
    return { received: true, duplicate: false, result: note };
  }

  // --- refunds --------------------------------------------------------------------------------
  /** Creates a refund row inside the caller's transaction; call processRefunds after commit. */
  async createRefund(tx: Tx, input: { paymentId: string; amountPaise: number; reason: string; approvedBy: string | null; idempotencyKey: string }) {
    if (input.amountPaise <= 0) return null;
    const existing = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
    const pending = await tx.refund.aggregate({ where: { paymentId: payment.id, status: 'PENDING' }, _sum: { amountPaise: true } });
    const available = payment.amountPaise - payment.refundedPaise - (pending._sum.amountPaise ?? 0n);
    if (BigInt(input.amountPaise) > available) throw validation({ path: 'amountPaise', code: 'EXCEEDS_REFUNDABLE', message: `Refundable: ${available}` });
    return tx.refund.create({
      data: {
        paymentId: payment.id,
        amountPaise: BigInt(input.amountPaise),
        reason: input.reason,
        approvedBy: input.approvedBy,
        idempotencyKey: input.idempotencyKey,
      },
    });
  }

  private async applyRefundSuccess(tx: Tx, refundId: string, providerRefundId?: string) {
    const refund = await tx.refund.update({ where: { id: refundId }, data: { status: 'SUCCEEDED', providerRefundId } });
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
    const refunded = payment.refundedPaise + refund.amountPaise;
    await tx.payment.update({
      where: { id: payment.id },
      data: { refundedPaise: refunded, status: refunded >= payment.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });
    await this.records.audit(tx, SYSTEM_ACTOR, { action: 'refund.succeeded', entityType: 'REFUND', entityId: refund.id, metadata: { paymentId: payment.id, amountPaise: num(refund.amountPaise) } });
    await this.records.emit(tx, 'refund.succeeded', { refundId: refund.id, paymentId: payment.id, bookingId: payment.bookingId, payerUserId: payment.payerUserId });
  }

  /** Calls the provider for pending refunds with idempotent keys; failures alert admins. */
  async processRefunds(ids?: string[]) {
    const refunds = await this.prisma.refund.findMany({
      where: { status: 'PENDING', attempts: { lt: MAX_REFUND_ATTEMPTS }, ...(ids ? { id: { in: ids } } : {}) },
      include: { payment: true },
      take: 50,
    });
    for (const r of refunds) {
      try {
        if (r.payment.provider === 'offline') {
          // Offline payments are refunded offline by finance; mark as recorded.
          await this.prisma.tx((tx) => this.applyRefundSuccess(tx, r.id, 'offline'));
          continue;
        }
        const result = await this.provider.refund({
          providerPaymentId: r.payment.providerPaymentId,
          amountPaise: num(r.amountPaise),
          idempotencyKey: r.idempotencyKey,
        });
        if (result.status === 'SUCCEEDED') {
          await this.prisma.tx((tx) => this.applyRefundSuccess(tx, r.id, result.providerRefundId));
        } else if (result.status === 'PENDING') {
          await this.prisma.refund.update({ where: { id: r.id }, data: { providerRefundId: result.providerRefundId, attempts: { increment: 1 } } });
        } else {
          throw new Error('REFUND_DECLINED');
        }
      } catch (err) {
        const attempts = r.attempts + 1;
        await this.prisma.refund.update({ where: { id: r.id }, data: { attempts, lastError: errorFields(err).errorMessage as string } });
        if (attempts >= MAX_REFUND_ATTEMPTS || attempts === 1) {
          await this.records.alert(this.prisma, 'REFUND_FAILED', 'REFUND', r.id, { paymentId: r.paymentId, attempts });
        }
      }
    }
  }

  /** Discretionary refund (FINANCE, reason, audited). */
  async manualRefund(actor: UserActor, paymentId: string, amountPaise: number, reason: string) {
    const refund = await this.prisma.tx(async (tx) => {
      const p = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!p) throw notFound();
      if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(p.status)) throw new AppError('INVALID_STATE_TRANSITION');
      const r = await this.createRefund(tx, { paymentId, amountPaise, reason, approvedBy: actor.userId, idempotencyKey: `manual:${paymentId}:${sha256(reason + amountPaise + Date.now()).slice(0, 12)}` });
      await this.records.audit(tx, actor, { action: 'refund.created', entityType: 'PAYMENT', entityId: paymentId, metadata: { amountPaise, reason } });
      if (p.bookingId) {
        await tx.booking.update({ where: { id: p.bookingId }, data: { refundPaise: { increment: BigInt(amountPaise) } } });
      }
      return r;
    });
    if (refund) await this.processRefunds([refund.id]);
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refund!.id } }).then((r) => ({ id: r.id, status: r.status, amountPaise: num(r.amountPaise) }));
  }

  /** Authorised offline payment (FINANCE, with reason) settles the subject like a webhook would. */
  async recordOffline(actor: UserActor, input: { requirementId?: string; bookingId?: string; amountPaise: number; reference: string; reason: string }) {
    return this.prisma.tx(async (tx) => {
      let payerUserId: string;
      if (input.bookingId) {
        const b = await tx.booking.findUnique({ where: { id: input.bookingId } });
        if (!b) throw notFound();
        payerUserId = b.customerUserId;
      } else {
        const r = await tx.paymentRequirement.findUnique({ where: { id: input.requirementId! }, include: { request: true } });
        if (!r) throw notFound();
        payerUserId = r.request.ownerUserId;
      }
      const payment = await tx.payment.create({
        data: {
          bookingId: input.bookingId ?? null,
          requirementId: input.requirementId ?? null,
          payerUserId,
          provider: 'offline',
          providerPaymentId: `offline_${input.reference}_${Date.now()}`,
          amountPaise: BigInt(input.amountPaise),
          status: 'SUCCEEDED',
          paidAt: this.clock.now(),
          recordedBy: actor.userId,
          offlineReason: input.reason,
        },
      });
      await this.records.audit(tx, actor, {
        action: 'payment.offline_recorded',
        entityType: 'PAYMENT',
        entityId: payment.id,
        metadata: { amountPaise: input.amountPaise, reason: input.reason, bookingId: input.bookingId ?? null, requirementId: input.requirementId ?? null },
      });
      await this.issueReceipt(tx, payment);
      await this.handlers.get(payment.bookingId ? 'BOOKING' : 'REQUIREMENT')?.onSucceeded(tx, payment);
      await this.records.emit(tx, 'payment.succeeded', { paymentId: payment.id, payerUserId, bookingId: payment.bookingId, requirementId: payment.requirementId });
      return this.serialize(payment);
    });
  }

  async adminList(cursor: string | undefined, limit: number) {
    const rows = await this.prisma.payment.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, include: { refunds: true } });
    return {
      items: rows.map((p) => ({
        ...this.serialize(p),
        refunds: p.refunds.map((r) => ({ id: r.id, status: r.status, amountPaise: num(r.amountPaise), reason: r.reason, attempts: r.attempts, createdAt: iso(r.createdAt) })),
      })),
      nextCursor: null,
      cursor,
    };
  }

  // --- receipts / invoices (placeholder layout; numbering Business-pending) ----------------------
  async issueReceipt(tx: Tx, payment: Payment) {
    const reference = await this.records.nextReference(tx, 'INV');
    let kind: 'BOOKING_RECEIPT' | 'MAINTENANCE_RECEIPT' = 'MAINTENANCE_RECEIPT';
    let lines: Array<{ label: string; amountPaise: number }> = [];
    let ownerUserId: string | null = null;
    let requestId: string | null = null;
    let workOrderId: string | null = null;
    if (payment.bookingId) {
      kind = 'BOOKING_RECEIPT';
      const b = await tx.booking.findUniqueOrThrow({ where: { id: payment.bookingId } });
      ownerUserId = b.ownerUserId;
      lines = [
        { label: `Stay ${b.reference} · ${b.nights} night(s)`, amountPaise: num(b.nightsTotalPaise) },
        { label: 'Cleaning fee', amountPaise: num(b.cleaningFeePaise) },
        { label: 'Tax (placeholder — pending accountant review)', amountPaise: num(b.taxPaise) },
      ];
    } else if (payment.requirementId) {
      const r = await tx.paymentRequirement.findUniqueOrThrow({ where: { id: payment.requirementId }, include: { request: true } });
      ownerUserId = r.request.ownerUserId;
      requestId = r.requestId;
      workOrderId = r.workOrderId;
      lines = [{ label: `${r.purpose.replace(/_/g, ' ').toLowerCase()} · ${r.request.reference}`, amountPaise: num(r.amountPaise) }];
    }
    await tx.invoice.create({
      data: {
        reference,
        kind,
        bookingId: payment.bookingId,
        paymentId: payment.id,
        requestId,
        workOrderId,
        ownerUserId,
        recipientUserId: payment.payerUserId,
        invoiceNumber: reference,
        amountPaise: payment.amountPaise,
        lines: lines as unknown as Prisma.InputJsonValue,
        taxMetadata: { status: 'PLACEHOLDER' },
      },
    });
  }

  /** Test/dev helper for the mock gateway: signs and delivers an event to our own webhook handler. */
  async deliverMockEvent(providerPaymentId: string, type: WebhookEvent['type'], eventId?: string) {
    if (!(this.provider instanceof MockPaymentProvider)) throw notFound();
    const payment = await this.prisma.payment.findFirst({ where: { provider: 'mock', providerPaymentId } });
    if (!payment) throw notFound();
    const { body, headers } = this.provider.buildEvent({ type, providerPaymentId, amountPaise: num(payment.amountPaise), eventId });
    return this.handleWebhook('mock', Buffer.from(body), headers);
  }

  actorCanSee(actor: Actor, payment: Payment): boolean {
    return actor.kind === 'SYSTEM' || isAdmin(actor) || payment.payerUserId === actor.userId;
  }
}
