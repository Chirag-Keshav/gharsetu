import { Inject, Injectable } from '@nestjs/common';
import type { Booking, Payout, PayoutStatus } from '@prisma/client';
import { dateToIso, payoutMachine } from '@propcare/shared';
import { CLOCK, type Clock } from '../../core/clock';
import { SYSTEM_ACTOR, type Actor, type UserActor } from '../../core/context';
import { AppError, forbidden, notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService, type Db, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { afterCursor, iso, num, pageOrder, toPage } from '../../core/serialize';

const OPEN_ISSUE = { in: ['OPEN', 'IN_PROGRESS'] as Array<'OPEN' | 'IN_PROGRESS'> };

/** Owner payouts (SPEC §6.10, §7 rule 17, §8.9 PAYO-01). Writes require FINANCE at the controller. */
@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly policy: PolicyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  serialize(p: Payout & { booking?: Pick<Booking, 'reference' | 'checkInDate' | 'checkOutDate' | 'status'> | null }, audience: 'owner' | 'finance') {
    return {
      id: p.id,
      reference: p.reference,
      bookingId: p.bookingId,
      bookingReference: p.booking?.reference ?? null,
      checkIn: p.booking ? dateToIso(p.booking.checkInDate) : null,
      checkOut: p.booking ? dateToIso(p.booking.checkOutDate) : null,
      amountPaise: num(p.amountPaise),
      adjustmentPaise: num(p.adjustmentPaise),
      status: p.status,
      eligibleAt: iso(p.eligibleAt),
      paidAt: iso(p.paidAt),
      paymentReference: p.paymentReference,
      holdReason: p.status === 'ON_HOLD' ? (audience === 'finance' ? p.holdReason : 'Under review') : null,
      ...(audience === 'finance'
        ? { ownerUserId: p.ownerUserId, requiresDualApproval: p.requiresDualApproval, approvedBy: p.approvedBy, approvedAt: iso(p.approvedAt), heldBySystem: p.heldBySystem }
        : {}),
      createdAt: iso(p.createdAt),
    };
  }

  private async move(db: Db, payout: Payout, to: PayoutStatus, actor: Actor, reason: string | null, data: Record<string, unknown> = {}) {
    await this.records.transition(db, payoutMachine, { entityId: payout.id, from: payout.status, to, actor, reason });
    const res = await db.payout.updateMany({ where: { id: payout.id, status: payout.status }, data: { status: to, ...data } });
    if (res.count !== 1) throw new AppError('INVALID_STATE_TRANSITION');
  }

  async createForBooking(tx: Tx, booking: Booking): Promise<void> {
    if (await tx.payout.findUnique({ where: { bookingId: booking.id } })) return;
    const delay = await this.policy.get('payout.release_delay_hours');
    const threshold = await this.policy.get('payout.dual_approval_threshold_paise');
    const payout = await tx.payout.create({
      data: {
        reference: await this.records.nextReference(tx, 'PYT'),
        bookingId: booking.id,
        ownerUserId: booking.ownerUserId,
        amountPaise: booking.ownerPayoutPaise,
        status: 'PENDING',
        eligibleAt: new Date(booking.checkInAt.getTime() + delay * 3_600_000),
        requiresDualApproval: num(booking.ownerPayoutPaise) > threshold,
      },
    });
    await this.records.transition(tx, payoutMachine, { entityId: payout.id, from: null, to: 'PENDING', actor: SYSTEM_ACTOR });
  }

  /** After a cancellation: void when nothing is retained, otherwise adjust to the retained payout. */
  async adjustForCancellation(tx: Tx, bookingId: string, ownerPayoutPaise: bigint): Promise<void> {
    const payout = await tx.payout.findUnique({ where: { bookingId } });
    if (!payout) return;
    if (payout.status === 'PAID') {
      await this.records.alert(tx, 'PAYOUT_ALREADY_PAID_ON_CANCEL', 'PAYOUT', payout.id, { bookingId });
      return;
    }
    if (payout.status === 'VOID') return;
    if (ownerPayoutPaise === 0n) await this.move(tx, payout, 'VOID', SYSTEM_ACTOR, 'BOOKING_CANCELLED');
    else await tx.payout.update({ where: { id: payout.id }, data: { amountPaise: ownerPayoutPaise - payout.adjustmentPaise > 0n ? ownerPayoutPaise - payout.adjustmentPaise : 0n } });
  }

  /** An open booking issue holds the related payout (SPEC §7 rule 17). */
  async holdForIssue(tx: Tx, bookingId: string): Promise<void> {
    const payout = await tx.payout.findUnique({ where: { bookingId } });
    if (!payout || (payout.status !== 'PENDING' && payout.status !== 'ELIGIBLE')) return;
    await this.move(tx, payout, 'ON_HOLD', SYSTEM_ACTOR, 'OPEN_ISSUE', { holdReason: 'Open issue on booking', heldBySystem: true });
  }

  async releaseIssueHold(tx: Tx, bookingId: string): Promise<void> {
    const payout = await tx.payout.findUnique({ where: { bookingId } });
    if (!payout || payout.status !== 'ON_HOLD' || !payout.heldBySystem) return;
    const open = await tx.issue.count({ where: { subjectType: 'BOOKING', subjectId: bookingId, status: OPEN_ISSUE } });
    if (open > 0) return;
    await this.move(tx, payout, 'PENDING', SYSTEM_ACTOR, 'ISSUE_RESOLVED', { holdReason: null, heldBySystem: false });
  }

  /** Payout adjustment from an issue resolution (FINANCE checked by the caller). */
  async adjust(tx: Tx, actor: UserActor, bookingId: string, adjustmentPaise: number): Promise<void> {
    const payout = await tx.payout.findUnique({ where: { bookingId } });
    if (!payout) throw validation({ path: 'payoutAdjustmentPaise', code: 'NO_PAYOUT' });
    if (payout.status === 'PAID' || payout.status === 'VOID') throw validation({ path: 'payoutAdjustmentPaise', code: `PAYOUT_${payout.status}` });
    if (BigInt(adjustmentPaise) > payout.amountPaise) throw validation({ path: 'payoutAdjustmentPaise', code: 'EXCEEDS_PAYOUT' });
    await tx.payout.update({
      where: { id: payout.id },
      data: { amountPaise: payout.amountPaise - BigInt(adjustmentPaise), adjustmentPaise: payout.adjustmentPaise + BigInt(adjustmentPaise) },
    });
    await this.records.audit(tx, actor, { action: 'payout.adjusted', entityType: 'PAYOUT', entityId: payout.id, metadata: { adjustmentPaise } });
  }

  /** Scheduled: PENDING → ELIGIBLE once the release time passes with no open issue. */
  async runEligibility(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.payout.findMany({ where: { status: 'PENDING', eligibleAt: { lte: now } }, take: 200 });
    let moved = 0;
    for (const p of due) {
      await this.prisma.tx(async (tx) => {
        const fresh = await tx.payout.findUniqueOrThrow({ where: { id: p.id } });
        if (fresh.status !== 'PENDING') return;
        const open = await tx.issue.count({ where: { subjectType: 'BOOKING', subjectId: p.bookingId, status: OPEN_ISSUE } });
        if (open > 0) {
          await this.move(tx, fresh, 'ON_HOLD', SYSTEM_ACTOR, 'OPEN_ISSUE', { holdReason: 'Open issue on booking', heldBySystem: true });
          return;
        }
        await this.move(tx, fresh, 'ELIGIBLE', SYSTEM_ACTOR, null);
        await this.records.emit(tx, 'payout.eligible', { payoutId: p.id, ownerUserId: p.ownerUserId, reference: p.reference });
        moved++;
      });
    }
    return moved;
  }

  // --- admin (FINANCE) --------------------------------------------------------------------------
  async adminList(status: PayoutStatus | undefined, cursor: string | undefined, limit: number) {
    const rows = await this.prisma.payout.findMany({
      where: { ...(status ? { status } : {}), ...afterCursor(cursor) },
      include: { booking: { select: { reference: true, checkInDate: true, checkOutDate: true, status: true } } },
      orderBy: pageOrder,
      take: limit + 1,
    });
    const owners = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.ownerUserId) } }, select: { id: true, fullName: true } });
    const profiles = await this.prisma.ownerProfile.findMany({ where: { userId: { in: rows.map((r) => r.ownerUserId) } }, select: { userId: true, payoutAccountRef: true } });
    return toPage(rows, limit, (p) => ({
      ...this.serialize(p, 'finance'),
      ownerName: owners.find((o) => o.id === p.ownerUserId)?.fullName ?? null,
      payoutAccountRef: profiles.find((x) => x.userId === p.ownerUserId)?.payoutAccountRef ?? null,
    }));
  }

  private async load(id: string, db: Db = this.prisma) {
    const p = await db.payout.findUnique({ where: { id } });
    if (!p) throw notFound();
    return p;
  }

  async hold(actor: UserActor, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      const p = await this.load(id, tx);
      await this.move(tx, p, 'ON_HOLD', actor, reason, { holdReason: reason, heldBySystem: false });
      await this.records.audit(tx, actor, { action: 'payout.held', entityType: 'PAYOUT', entityId: id, metadata: { reason } });
      return { id, status: 'ON_HOLD' };
    });
  }

  async release(actor: UserActor, id: string) {
    return this.prisma.tx(async (tx) => {
      const p = await this.load(id, tx);
      const open = await tx.issue.count({ where: { subjectType: 'BOOKING', subjectId: p.bookingId, status: OPEN_ISSUE } });
      if (open > 0) throw validation({ code: 'OPEN_ISSUE_ON_BOOKING' });
      const to: PayoutStatus = p.eligibleAt <= this.clock.now() ? 'ELIGIBLE' : 'PENDING';
      await this.move(tx, p, to, actor, 'RELEASED', { holdReason: null, heldBySystem: false });
      await this.records.audit(tx, actor, { action: 'payout.released', entityType: 'PAYOUT', entityId: id });
      return { id, status: to };
    });
  }

  /** First approval for payouts above the dual-approval threshold. */
  async approve(actor: UserActor, id: string) {
    const p = await this.load(id);
    if (p.status !== 'ELIGIBLE') throw new AppError('INVALID_STATE_TRANSITION');
    if (p.approvedBy) throw validation({ code: 'ALREADY_APPROVED' });
    await this.prisma.payout.update({ where: { id }, data: { approvedBy: actor.userId, approvedAt: this.clock.now() } });
    await this.records.audit(this.prisma, actor, { action: 'payout.approved', entityType: 'PAYOUT', entityId: id });
    return { id, approvedBy: actor.userId };
  }

  async markPaid(actor: UserActor, id: string, paymentReference: string) {
    return this.prisma.tx(async (tx) => {
      const p = await this.load(id, tx);
      if (p.requiresDualApproval) {
        if (!p.approvedBy) throw validation({ code: 'SECOND_APPROVAL_REQUIRED' });
        if (p.approvedBy === actor.userId) throw forbidden('DIFFERENT_FINANCE_ADMIN_REQUIRED');
      }
      await this.move(tx, p, 'PAID', actor, null, { paidAt: this.clock.now(), paymentReference, recordedBy: actor.userId });
      await this.records.audit(tx, actor, { action: 'payout.paid', entityType: 'PAYOUT', entityId: id, metadata: { amountPaise: num(p.amountPaise) } });
      await this.records.emit(tx, 'payout.paid', { payoutId: id, ownerUserId: p.ownerUserId, reference: p.reference });
      return { id, status: 'PAID' };
    });
  }

  async ownerList(actor: UserActor, cursor: string | undefined, limit: number) {
    const rows = await this.prisma.payout.findMany({
      where: { ownerUserId: actor.userId, ...afterCursor(cursor) },
      include: { booking: { select: { reference: true, checkInDate: true, checkOutDate: true, status: true } } },
      orderBy: pageOrder,
      take: limit + 1,
    });
    return toPage(rows, limit, (p) => this.serialize(p, 'owner'));
  }
}
