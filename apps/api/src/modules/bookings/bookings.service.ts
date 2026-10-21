import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { Booking, BookingStatus, Payment, Prisma } from '@prisma/client';
import {
  bookingCreateSchema,
  bookingMachine,
  cancellationRulesSchema,
  computeBookingCommission,
  computeCancellationRefund,
  dateToIso,
  diffDays,
  istDateOf,
  isoToDate,
  maskPhone,
  priceStay,
  type CancellationInitiator,
  type StayPrice,
} from '@propcare/shared';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../core/clock';
import { hasFlag, isAdmin, SYSTEM_ACTOR, type Actor, type UserActor } from '../../core/context';
import { AppError, forbidden, notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { afterCursor, iso, num, pageOrder, toPage } from '../../core/serialize';
import { CatalogService } from '../catalog/catalog.service';
import { CommissionService } from '../commission/commission.service';
import { publicPhotos } from '../listings/listing-serializers';
import { OccupancyService } from '../listings/occupancy.service';
import { StayPricingService } from '../listings/stay-pricing.service';
import { PaymentsService } from '../payments/payments.service';
import { PayoutsService } from '../payouts/payouts.service';

type BookingFull = Prisma.BookingGetPayload<{
  include: { listing: { include: { photos: true; property: true } }; payout: true; review: true };
}>;

const BOOKING_INCLUDE = { listing: { include: { photos: true, property: true } }, payout: true, review: true } as const;

/**
 * Bookings (SPEC §6.9, §8.5). Prices, commission and the cancellation policy are snapshotted at
 * creation; CONFIRMED is set only by a verified payment webhook, never by the browser.
 */
@Injectable()
export class BookingsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly policy: PolicyService,
    private readonly catalog: CatalogService,
    private readonly occupancy: OccupancyService,
    private readonly pricing: StayPricingService,
    private readonly commission: CommissionService,
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit() {
    this.payments.registerSettlement('BOOKING', {
      onSucceeded: (tx, payment) => this.onPaymentSucceeded(tx, payment),
    });
  }

  // --- serializers --------------------------------------------------------------------------------
  private async serialize(actor: Actor, b: BookingFull) {
    const now = this.clock.now();
    const pricing = b.pricingSnapshot as unknown as StayPrice;
    const confirmed = b.status === 'CONFIRMED' || b.status === 'COMPLETED';
    const cover = publicPhotos(b.listing.photos)[0] ?? null;
    const base = {
      id: b.id,
      reference: b.reference,
      status: b.status,
      listing: {
        id: b.listingId,
        title: b.listing.title,
        publicAreaLabel: b.listing.publicAreaLabel,
        coverPhoto: cover?.variants ?? null,
        checkInTime: b.listing.checkInTime,
        checkOutTime: b.listing.checkOutTime,
      },
      checkIn: dateToIso(b.checkInDate),
      checkOut: dateToIso(b.checkOutDate),
      checkInAt: iso(b.checkInAt),
      checkOutAt: iso(b.checkOutAt),
      nights: b.nights,
      guests: b.guestsCount,
      specialRequests: b.specialRequests,
      bookingMode: b.bookingModeSnapshot,
      cancellationPolicy: b.cancellationPolicySnapshot,
      holdExpiresAt: b.status === 'AWAITING_PAYMENT' ? iso(b.holdExpiresAt) : null,
      requestExpiresAt: b.status === 'REQUESTED' ? iso(b.requestExpiresAt) : null,
      requestedAt: iso(b.requestedAt),
      confirmedAt: iso(b.confirmedAt),
      cancelledAt: iso(b.cancelledAt),
      cancelledByRole: b.cancelledByRole,
      refundPaise: num(b.refundPaise),
      completedAt: iso(b.completedAt),
      createdAt: iso(b.createdAt),
    };
    const money = {
      nightsBreakdown: pricing.nights,
      nightsTotalPaise: num(b.nightsTotalPaise),
      cleaningFeePaise: num(b.cleaningFeePaise),
      taxPaise: num(b.taxPaise),
      totalPaise: num(b.totalPaise),
    };

    if (actor.kind === 'USER' && actor.role === 'CUSTOMER') {
      const accessHours = await this.policy.get('disclosure.access_hours_before_checkin');
      const reviewDays = await this.policy.get('stay_review.window_days');
      const property = b.listing.property;
      const showAccess = confirmed && now.getTime() >= b.checkInAt.getTime() - accessHours * 3_600_000;
      return {
        ...base,
        ...money,
        // Exact address only once CONFIRMED; access instructions only inside the disclosure window.
        exactAddress: confirmed
          ? { line1: property.addressLine1, line2: property.addressLine2, locality: property.locality, city: property.city, state: property.state, pinCode: property.pinCode }
          : null,
        checkinInstructions: showAccess ? (b.listing.checkinInstructions ?? null) : null,
        checkinInstructionsAvailableAt: confirmed && !showAccess ? new Date(b.checkInAt.getTime() - accessHours * 3_600_000).toISOString() : null,
        canPay: b.status === 'AWAITING_PAYMENT' && !!b.holdExpiresAt && b.holdExpiresAt > now,
        canCancel: ['REQUESTED', 'AWAITING_PAYMENT', 'CONFIRMED'].includes(b.status),
        canReview:
          b.status === 'COMPLETED' && !b.review && !!b.completedAt && now.getTime() <= b.completedAt.getTime() + reviewDays * 86_400_000,
        review: b.review ? { rating: b.review.rating, body: b.review.body, status: b.review.status } : null,
      };
    }

    const customer = await this.prisma.user.findUnique({ where: { id: b.customerUserId }, select: { fullName: true, phoneE164: true } });
    if (actor.kind === 'USER' && actor.role === 'OWNER') {
      const phoneHours = await this.policy.get('disclosure.guest_phone_hours_before_checkin');
      const revealPhone = confirmed && now.getTime() >= b.checkInAt.getTime() - phoneHours * 3_600_000;
      return {
        ...base,
        ...money,
        roomRevenuePaise: num(b.nightsTotalPaise) + num(b.cleaningFeePaise),
        commissionBpsApplied: b.commissionBpsApplied,
        commissionPaise: num(b.commissionPaise),
        ownerPayoutPaise: num(b.ownerPayoutPaise),
        payout: b.payout ? { id: b.payout.id, status: b.payout.status, amountPaise: num(b.payout.amountPaise), eligibleAt: iso(b.payout.eligibleAt) } : null,
        // First name and a masked phone until confirmation and the disclosure window (SPEC §7 rule 18).
        guest: {
          firstName: customer?.fullName?.split(' ')[0] ?? 'Guest',
          phone: revealPhone ? customer?.phoneE164 : maskPhone(customer?.phoneE164),
          phoneRevealed: revealPhone,
        },
        canApprove: b.status === 'REQUESTED',
        canCancel: b.status === 'CONFIRMED',
      };
    }

    // admin / finance view
    const owner = await this.prisma.user.findUnique({ where: { id: b.ownerUserId }, select: { fullName: true } });
    return {
      ...base,
      ...money,
      roomRevenuePaise: num(b.nightsTotalPaise) + num(b.cleaningFeePaise),
      commissionBpsApplied: b.commissionBpsApplied,
      commissionBenchmarkSnapshot: b.commissionBenchmarkSnapshot,
      commissionPaise: num(b.commissionPaise),
      ownerPayoutPaise: num(b.ownerPayoutPaise),
      cancelReason: b.cancelReason,
      payout: b.payout ? { id: b.payout.id, reference: b.payout.reference, status: b.payout.status, amountPaise: num(b.payout.amountPaise) } : null,
      customer: { id: b.customerUserId, name: customer?.fullName ?? null, phone: customer?.phoneE164 ?? null },
      owner: { id: b.ownerUserId, name: owner?.fullName ?? null },
      propertyId: b.listing.propertyId,
    };
  }

  private async loadVisible(actor: UserActor, id: string): Promise<BookingFull> {
    const b = await this.prisma.booking.findUnique({ where: { id }, include: BOOKING_INCLUDE });
    if (!b) throw notFound();
    const ok =
      isAdmin(actor) || (actor.role === 'CUSTOMER' && b.customerUserId === actor.userId) || (actor.role === 'OWNER' && b.ownerUserId === actor.userId);
    if (!ok) throw notFound();
    return b;
  }

  async get(actor: UserActor, id: string) {
    return this.serialize(actor, await this.loadVisible(actor, id));
  }

  async list(actor: UserActor, scope: 'requests' | 'upcoming' | 'past' | 'all', cursor: string | undefined, limit: number) {
    const today = isoToDate(istDateOf(this.clock.now()));
    const scoped: Prisma.BookingWhereInput =
      actor.role === 'CUSTOMER' ? { customerUserId: actor.userId } : actor.role === 'OWNER' ? { ownerUserId: actor.userId } : {};
    const filter: Prisma.BookingWhereInput =
      scope === 'requests'
        ? { status: 'REQUESTED' }
        : scope === 'upcoming'
          ? { status: { in: ['REQUESTED', 'AWAITING_PAYMENT', 'CONFIRMED'] }, checkOutDate: { gte: today } }
          : scope === 'past'
            ? { OR: [{ status: { in: ['COMPLETED', 'CANCELLED', 'DECLINED', 'EXPIRED'] } }, { checkOutDate: { lt: today } }] }
            : {};
    const rows = await this.prisma.booking.findMany({
      where: { AND: [scoped, filter, afterCursor(cursor)] },
      include: BOOKING_INCLUDE,
      orderBy: pageOrder,
      take: limit + 1,
    });
    const page = toPage(rows, limit, (r) => r);
    return { items: await Promise.all(page.items.map((b) => this.serialize(actor, b))), nextCursor: page.nextCursor };
  }

  // --- create -------------------------------------------------------------------------------------
  async create(actor: UserActor, input: z.infer<typeof bookingCreateSchema>) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.phoneVerifiedAt) throw forbidden('PHONE_NOT_VERIFIED');
    const listing = await this.prisma.listing.findFirst({ where: { id: input.listingId, status: 'PUBLISHED', property: { status: 'ACTIVE' } } });
    if (!listing) throw notFound();
    if (listing.ownerUserId === actor.userId) throw validation({ code: 'OWN_LISTING' });
    const guestDetailsEnabled = await this.policy.get('features.guest_details_enabled');
    this.pricing.validate(listing, input);

    const bookingId = await this.prisma.tx(async (tx) => {
      await this.occupancy.lockListing(tx, listing.id);
      await this.occupancy.purgeExpiredHolds(tx, listing.id);
      const fresh = await tx.listing.findUniqueOrThrow({ where: { id: listing.id } });
      if (fresh.status !== 'PUBLISHED') throw validation({ code: 'LISTING_UNAVAILABLE' });
      const checkInAt = this.pricing.checkInAt(fresh, input.checkIn);
      const checkOutAt = this.pricing.checkOutAt(fresh, input.checkOut);
      if (
        (await this.occupancy.conflicts(tx, fresh.id, input.checkIn, input.checkOut)).length ||
        (await this.occupancy.maintenanceOnCheckoutDay(tx, fresh.id, input.checkOut, checkOutAt))
      ) {
        throw new AppError('DATES_UNAVAILABLE');
      }
      const price = priceStay(await this.pricing.pricingInput(fresh, tx), input.checkIn, input.checkOut);
      const commission = await this.commission.effective(fresh.ownerUserId, tx);
      const { commissionPaise, ownerPayoutPaise } = computeBookingCommission(price.roomRevenuePaise, commission.appliedBps);
      const policy = fresh.cancellationPolicyKey ? await this.catalog.cancellationPolicy(fresh.cancellationPolicyKey) : null;
      if (!policy) throw validation({ code: 'LISTING_MISSING_CANCELLATION_POLICY' });
      const instant = fresh.bookingMode === 'INSTANT';
      const status: BookingStatus = instant ? 'AWAITING_PAYMENT' : 'REQUESTED';
      const now = this.clock.now();
      const holdMinutes = await this.policy.get('booking.hold_minutes');
      const responseHours = await this.policy.get('booking.request_response_hours');
      const booking = await tx.booking.create({
        data: {
          reference: await this.records.nextReference(tx, 'BKG'),
          listingId: fresh.id,
          customerUserId: actor.userId,
          ownerUserId: fresh.ownerUserId,
          status,
          checkInDate: isoToDate(input.checkIn),
          checkOutDate: isoToDate(input.checkOut),
          checkInAt,
          checkOutAt,
          nights: diffDays(input.checkIn, input.checkOut),
          guestsCount: input.guests,
          specialRequests: input.specialRequests ?? null,
          guestDetails: guestDetailsEnabled && input.guestDetails ? (input.guestDetails as Prisma.InputJsonValue) : undefined,
          bookingModeSnapshot: fresh.bookingMode,
          cancellationPolicySnapshot: { key: policy.key, name: policy.name, rules: policy.rules } as Prisma.InputJsonValue,
          pricingSnapshot: price as unknown as Prisma.InputJsonValue,
          nightsTotalPaise: BigInt(price.nightsTotalPaise),
          cleaningFeePaise: BigInt(price.cleaningFeePaise),
          taxPaise: BigInt(price.taxPaise),
          totalPaise: BigInt(price.totalPaise),
          commissionBpsApplied: commission.appliedBps,
          commissionBenchmarkSnapshot: this.commission.snapshotOf(commission),
          commissionPaise: BigInt(commissionPaise),
          ownerPayoutPaise: BigInt(ownerPayoutPaise),
          holdExpiresAt: instant ? new Date(now.getTime() + holdMinutes * 60_000) : null,
          requestExpiresAt: instant ? null : new Date(now.getTime() + responseHours * 3_600_000),
          requestedAt: now,
        },
      });
      await this.records.transition(tx, bookingMachine, { entityId: booking.id, from: null, to: status, actor });
      if (instant) {
        await this.occupancy.insert(tx, {
          listingId: fresh.id,
          startDate: input.checkIn,
          endDate: input.checkOut,
          kind: 'BOOKING_HOLD',
          bookingId: booking.id,
          expiresAt: booking.holdExpiresAt,
          createdBy: actor.userId,
        });
      }
      await this.records.audit(tx, actor, {
        action: 'booking.created',
        entityType: 'BOOKING',
        entityId: booking.id,
        metadata: { listingId: fresh.id, status, totalPaise: price.totalPaise, commissionBps: commission.appliedBps },
      });
      await this.records.emit(tx, 'booking.created', {
        bookingId: booking.id,
        status,
        reference: booking.reference,
        customerUserId: actor.userId,
        ownerUserId: fresh.ownerUserId,
        deadline: booking.requestExpiresAt?.toISOString() ?? null,
      });
      return booking.id;
    });
    return this.get(actor, bookingId);
  }

  // --- owner decision -----------------------------------------------------------------------------
  private async lockBooking(tx: Tx, id: string): Promise<Booking> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound();
    return tx.booking.findUniqueOrThrow({ where: { id } });
  }

  private assertOwnerOrAdmin(actor: UserActor, b: Booking) {
    if (!(isAdmin(actor) || (actor.role === 'OWNER' && b.ownerUserId === actor.userId))) throw notFound();
  }

  async approve(actor: UserActor, id: string, reason?: string | null) {
    await this.prisma.tx(async (tx) => {
      const pre = await tx.booking.findUnique({ where: { id } });
      if (!pre) throw notFound();
      this.assertOwnerOrAdmin(actor, pre);
      await this.occupancy.lockListing(tx, pre.listingId);
      const b = await this.lockBooking(tx, id);
      await this.records.transition(tx, bookingMachine, { entityId: id, from: b.status, to: 'AWAITING_PAYMENT', actor, reason });
      await this.occupancy.purgeExpiredHolds(tx, b.listingId);
      // Availability is re-checked inside the transaction before the hold is created (SPEC §6.9).
      if ((await this.occupancy.conflicts(tx, b.listingId, dateToIso(b.checkInDate), dateToIso(b.checkOutDate))).length) {
        throw new AppError('DATES_UNAVAILABLE');
      }
      const holdExpiresAt = new Date(this.clock.now().getTime() + (await this.policy.get('booking.hold_minutes')) * 60_000);
      await this.occupancy.insert(tx, {
        listingId: b.listingId,
        startDate: dateToIso(b.checkInDate),
        endDate: dateToIso(b.checkOutDate),
        kind: 'BOOKING_HOLD',
        bookingId: b.id,
        expiresAt: holdExpiresAt,
        createdBy: actor.userId,
      });
      await tx.booking.update({ where: { id }, data: { status: 'AWAITING_PAYMENT', holdExpiresAt } });
      await this.records.audit(tx, actor, {
        action: 'booking.approved',
        entityType: 'BOOKING',
        entityId: id,
        onBehalfOf: isAdmin(actor) ? { type: 'OWNER', id: b.ownerUserId } : null,
        metadata: { reason: reason ?? null },
      });
      await this.records.emit(tx, 'booking.approved', { bookingId: id, reference: b.reference, customerUserId: b.customerUserId });
    });
    return this.get(actor, id);
  }

  async decline(actor: UserActor, id: string, reason?: string | null) {
    await this.prisma.tx(async (tx) => {
      const b = await this.lockBooking(tx, id);
      this.assertOwnerOrAdmin(actor, b);
      await this.records.transition(tx, bookingMachine, { entityId: id, from: b.status, to: 'DECLINED', actor, reason });
      await tx.booking.update({ where: { id }, data: { status: 'DECLINED', cancelReason: reason ?? null } });
      await this.records.audit(tx, actor, { action: 'booking.declined', entityType: 'BOOKING', entityId: id, onBehalfOf: isAdmin(actor) ? { type: 'OWNER', id: b.ownerUserId } : null });
      await this.records.emit(tx, 'booking.declined', { bookingId: id, reference: b.reference, customerUserId: b.customerUserId });
    });
    return this.get(actor, id);
  }

  // --- payment --------------------------------------------------------------------------------------
  async initiatePayment(actor: UserActor, id: string) {
    const b = await this.prisma.booking.findUnique({ where: { id } });
    if (!b || b.customerUserId !== actor.userId) throw notFound();
    if (b.status !== 'AWAITING_PAYMENT') throw new AppError('INVALID_STATE_TRANSITION');
    if (!b.holdExpiresAt || b.holdExpiresAt <= this.clock.now()) throw validation({ code: 'HOLD_EXPIRED' });
    return this.payments.initiate({
      payerUserId: actor.userId,
      amountPaise: num(b.totalPaise),
      bookingId: b.id,
      reference: b.reference,
      returnPath: `/trips/${b.id}`,
    });
  }

  /** Runs inside the verified-webhook transaction (SPEC §8.9 "Booking payments"). */
  private async onPaymentSucceeded(tx: Tx, payment: Payment): Promise<{ refundIds: string[] }> {
    const pre = await tx.booking.findUniqueOrThrow({ where: { id: payment.bookingId! } });
    await this.occupancy.lockListing(tx, pre.listingId);
    const b = await this.lockBooking(tx, pre.id);
    const refundAll = async (alert: string | null) => {
      const refund = await this.payments.createRefund(tx, {
        paymentId: payment.id,
        amountPaise: num(payment.amountPaise),
        reason: alert ?? 'PAYMENT_AFTER_CANCELLATION',
        approvedBy: null,
        idempotencyKey: `auto-refund:${payment.id}`,
      });
      if (alert) await this.records.alert(tx, alert, 'BOOKING', b.id, { paymentId: payment.id });
      await this.records.emit(tx, 'admin.late_payment', { bookingId: b.id, reference: b.reference, alert });
      return { refundIds: refund ? [refund.id] : [] };
    };
    if (payment.amountPaise !== b.totalPaise) {
      await this.records.alert(tx, 'WEBHOOK_UNMATCHED', 'BOOKING', b.id, { reason: 'AMOUNT_MISMATCH' });
      return refundAll(null);
    }
    const start = dateToIso(b.checkInDate);
    const end = dateToIso(b.checkOutDate);

    if (b.status === 'AWAITING_PAYMENT' || b.status === 'EXPIRED') {
      const hold = await tx.listingOccupancy.findFirst({ where: { bookingId: b.id, kind: 'BOOKING_HOLD' } });
      if (hold) {
        await tx.listingOccupancy.update({ where: { id: hold.id }, data: { kind: 'BOOKING_CONFIRMED', expiresAt: null } });
      } else {
        // Late payment: re-acquire the dates if they are still free, otherwise refund and alert.
        await this.occupancy.purgeExpiredHolds(tx, b.listingId);
        const conflicts = await this.occupancy.conflicts(tx, b.listingId, start, end);
        if (conflicts.length) return refundAll('LATE_PAYMENT_DATES_TAKEN');
        await this.occupancy.insert(tx, { listingId: b.listingId, startDate: start, endDate: end, kind: 'BOOKING_CONFIRMED', bookingId: b.id });
      }
      const current = (await tx.booking.findUniqueOrThrow({ where: { id: b.id } })).status;
      await this.records.transition(tx, bookingMachine, { entityId: b.id, from: current, to: 'CONFIRMED', actor: SYSTEM_ACTOR, reason: 'PAYMENT_VERIFIED' });
      const confirmed = await tx.booking.update({ where: { id: b.id }, data: { status: 'CONFIRMED', confirmedAt: this.clock.now(), holdExpiresAt: null } });
      await this.payouts.createForBooking(tx, confirmed);
      await this.records.emit(tx, 'booking.confirmed', {
        bookingId: b.id,
        reference: b.reference,
        customerUserId: b.customerUserId,
        ownerUserId: b.ownerUserId,
        checkIn: start,
      });
      return { refundIds: [] };
    }
    if (b.status === 'CONFIRMED' || b.status === 'COMPLETED') return { refundIds: [] };
    // Cancelled, declined or otherwise closed before the money arrived.
    return refundAll(b.status === 'CANCELLED' ? null : 'LATE_PAYMENT_DATES_TAKEN');
  }

  // --- cancellation -----------------------------------------------------------------------------------
  private initiatorFor(actor: UserActor, b: Booking): CancellationInitiator {
    if (isAdmin(actor)) return 'ADMIN';
    if (actor.role === 'CUSTOMER' && b.customerUserId === actor.userId) return 'CUSTOMER';
    if (actor.role === 'OWNER' && b.ownerUserId === actor.userId) return 'OWNER';
    throw notFound();
  }

  private refundFor(b: Booking, initiator: CancellationInitiator, adminRefundBps?: number) {
    const rules = cancellationRulesSchema.parse((b.cancellationPolicySnapshot as { rules?: unknown }).rules ?? []);
    return computeCancellationRefund({
      rules,
      checkInAt: b.checkInAt,
      cancelAt: this.clock.now(),
      roomRevenuePaise: num(b.nightsTotalPaise) + num(b.cleaningFeePaise),
      taxPaise: num(b.taxPaise),
      commissionBps: b.commissionBpsApplied,
      initiator,
      adminRefundBps,
    });
  }

  /** Shows the refund the actor would trigger before they confirm (SPEC §8.5). */
  async cancellationPreview(actor: UserActor, id: string) {
    const b = await this.loadVisible(actor, id);
    const initiator = this.initiatorFor(actor, b);
    if (b.status !== 'CONFIRMED') return { status: b.status, refundPaise: 0, refundBps: 0, charged: false };
    const r = this.refundFor(b, initiator);
    return { status: b.status, charged: true, refundPaise: r.refundPaise, refundBps: r.refundBps, hoursBeforeCheckIn: Math.floor(r.hoursBeforeCheckIn), totalPaise: num(b.totalPaise) };
  }

  async cancel(actor: UserActor, id: string, input: { reason?: string | null; refundBps?: number }) {
    if (input.refundBps !== undefined && !(hasFlag(actor, 'FINANCE') && input.reason)) {
      throw forbidden('FINANCE_AND_REASON_REQUIRED_FOR_CUSTOM_REFUND');
    }
    const refundIds: string[] = [];
    await this.prisma.tx(async (tx) => {
      const pre = await tx.booking.findUnique({ where: { id } });
      if (!pre) throw notFound();
      const initiator = this.initiatorFor(actor, pre);
      await this.occupancy.lockListing(tx, pre.listingId);
      const b = await this.lockBooking(tx, id);
      if (initiator === 'OWNER' && b.status !== 'CONFIRMED') throw new AppError('INVALID_STATE_TRANSITION', [{ code: 'USE_DECLINE' }]);
      await this.records.transition(tx, bookingMachine, { entityId: id, from: b.status, to: 'CANCELLED', actor, reason: input.reason });
      const now = this.clock.now();
      const data: Prisma.BookingUpdateInput = {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledByRole: initiator,
        cancelReason: input.reason ?? null,
        holdExpiresAt: null,
      };
      let refundPaise = 0;
      if (b.status === 'CONFIRMED') {
        const r = this.refundFor(b, initiator, input.refundBps);
        refundPaise = r.refundPaise;
        data.refundPaise = BigInt(r.refundPaise);
        data.commissionPaise = BigInt(r.commissionPaise);
        data.ownerPayoutPaise = BigInt(r.ownerPayoutPaise);
        const payment = await tx.payment.findFirst({ where: { bookingId: id, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } }, orderBy: { createdAt: 'asc' } });
        if (payment && r.refundPaise > 0) {
          const refund = await this.payments.createRefund(tx, {
            paymentId: payment.id,
            amountPaise: r.refundPaise,
            reason: `CANCELLATION_${initiator}`,
            approvedBy: actor.userId,
            idempotencyKey: `cancel:${id}`,
          });
          if (refund) refundIds.push(refund.id);
        }
        await this.payouts.adjustForCancellation(tx, id, BigInt(r.ownerPayoutPaise));
      }
      await tx.booking.update({ where: { id }, data });
      await tx.listingOccupancy.deleteMany({ where: { bookingId: id } });
      await this.records.audit(tx, actor, {
        action: 'booking.cancelled',
        entityType: 'BOOKING',
        entityId: id,
        metadata: { from: b.status, initiator, refundPaise, refundBps: input.refundBps ?? null },
      });
      await this.records.emit(tx, 'booking.cancelled', {
        bookingId: id,
        reference: b.reference,
        customerUserId: b.customerUserId,
        ownerUserId: b.ownerUserId,
        refundPaise,
      });
    });
    if (refundIds.length) await this.payments.processRefunds(refundIds);
    return this.get(actor, id);
  }

  // --- reviews (REVW-01) -------------------------------------------------------------------------
  async review(actor: UserActor, id: string, input: { rating: number; body: string }) {
    const b = await this.prisma.booking.findUnique({ where: { id }, include: { review: true } });
    if (!b || b.customerUserId !== actor.userId) throw notFound();
    if (b.status !== 'COMPLETED' || !b.completedAt) throw new AppError('INVALID_STATE_TRANSITION', [{ code: 'STAY_NOT_COMPLETED' }]);
    if (b.review) throw validation({ code: 'ALREADY_REVIEWED' });
    const windowDays = await this.policy.get('stay_review.window_days');
    if (this.clock.now().getTime() > b.completedAt.getTime() + windowDays * 86_400_000) throw validation({ code: 'REVIEW_WINDOW_CLOSED' });
    await this.prisma.tx(async (tx) => {
      await tx.review.create({ data: { bookingId: id, listingId: b.listingId, customerUserId: actor.userId, rating: input.rating, body: input.body } });
      await this.recomputeRating(tx, b.listingId);
      await this.records.audit(tx, actor, { action: 'review.created', entityType: 'BOOKING', entityId: id, metadata: { rating: input.rating } });
    });
    return this.get(actor, id);
  }

  async hideReview(actor: UserActor, reviewId: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const r = await tx.review.findUnique({ where: { id: reviewId } });
      if (!r) throw notFound();
      await tx.review.update({ where: { id: reviewId }, data: { status: 'HIDDEN', hiddenReason: reason, moderatedBy: actor.userId } });
      await this.recomputeRating(tx, r.listingId);
      await this.records.audit(tx, actor, { action: 'review.hidden', entityType: 'REVIEW', entityId: reviewId, metadata: { reason } });
    });
    return { id: reviewId, status: 'HIDDEN' };
  }

  /** Aggregates come only from published reviews and are computed server-side. */
  private async recomputeRating(tx: Tx, listingId: string) {
    const agg = await tx.review.aggregate({ where: { listingId, status: 'PUBLISHED' }, _avg: { rating: true }, _count: true });
    await tx.listing.update({
      where: { id: listingId },
      data: { ratingAvg: agg._avg.rating ? Math.round(agg._avg.rating * 100) / 100 : null, ratingCount: agg._count },
    });
  }

  // --- scheduled jobs -------------------------------------------------------------------------------
  async expireHolds(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.booking.findMany({ where: { status: 'AWAITING_PAYMENT', holdExpiresAt: { lte: now } }, select: { id: true, listingId: true }, take: 200 });
    for (const b of due) {
      await this.prisma.tx(async (tx) => {
        await this.occupancy.lockListing(tx, b.listingId);
        await this.occupancy.purgeExpiredHolds(tx, b.listingId);
        const fresh = await tx.booking.findUniqueOrThrow({ where: { id: b.id } });
        if (fresh.status === 'AWAITING_PAYMENT' && fresh.holdExpiresAt && fresh.holdExpiresAt <= now) {
          await this.records.transition(tx, bookingMachine, { entityId: b.id, from: 'AWAITING_PAYMENT', to: 'EXPIRED', actor: SYSTEM_ACTOR, reason: 'HOLD_LAPSED' });
          await tx.booking.update({ where: { id: b.id }, data: { status: 'EXPIRED' } });
          await tx.listingOccupancy.deleteMany({ where: { bookingId: b.id, kind: 'BOOKING_HOLD' } });
          await this.records.emit(tx, 'booking.expired', { bookingId: b.id, reason: 'HOLD_LAPSED' });
        }
      });
    }
    return due.length;
  }

  async expireRequests(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.booking.findMany({ where: { status: 'REQUESTED', requestExpiresAt: { lte: now } }, take: 200 });
    for (const b of due) {
      await this.prisma.tx(async (tx) => {
        const fresh = await this.lockBooking(tx, b.id);
        if (fresh.status !== 'REQUESTED') return;
        await this.records.transition(tx, bookingMachine, { entityId: b.id, from: 'REQUESTED', to: 'EXPIRED', actor: SYSTEM_ACTOR, reason: 'NO_OWNER_RESPONSE' });
        await tx.booking.update({ where: { id: b.id }, data: { status: 'EXPIRED' } });
        await this.records.emit(tx, 'booking.expired', { bookingId: b.id, reason: 'NO_OWNER_RESPONSE' });
      });
    }
    return due.length;
  }

  async completeStays(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.booking.findMany({ where: { status: 'CONFIRMED', checkOutAt: { lte: now } }, include: { listing: true }, take: 200 });
    for (const b of due) {
      await this.prisma.tx(async (tx) => {
        const fresh = await this.lockBooking(tx, b.id);
        if (fresh.status !== 'CONFIRMED') return;
        await this.records.transition(tx, bookingMachine, { entityId: b.id, from: 'CONFIRMED', to: 'COMPLETED', actor: SYSTEM_ACTOR });
        await tx.booking.update({ where: { id: b.id }, data: { status: 'COMPLETED', completedAt: now } });
        await this.records.emit(tx, 'booking.completed', {
          bookingId: b.id,
          reference: b.reference,
          customerUserId: b.customerUserId,
          listingId: b.listingId,
          propertyId: b.listing.propertyId,
          turnoverCleaning: b.listing.turnoverCleaningEnabled,
        });
      });
    }
    return due.length;
  }

  // --- admin ----------------------------------------------------------------------------------------
  async adminList(actor: UserActor, status: BookingStatus | undefined, cursor: string | undefined, limit: number) {
    const rows = await this.prisma.booking.findMany({
      where: { ...(status ? { status } : {}), ...afterCursor(cursor) },
      include: BOOKING_INCLUDE,
      orderBy: pageOrder,
      take: limit + 1,
    });
    const page = toPage(rows, limit, (r) => r);
    return { items: await Promise.all(page.items.map((b) => this.serialize(actor, b))), nextCursor: page.nextCursor };
  }
}
