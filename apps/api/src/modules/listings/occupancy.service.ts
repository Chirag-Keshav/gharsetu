import { Inject, Injectable } from '@nestjs/common';
import type { OccupancyKind } from '@prisma/client';
import { addDays, bookingMachine, dateToIso, eachNight, isoToDate, type IsoDate } from '@propcare/shared';
import { CLOCK, type Clock } from '../../core/clock';
import { SYSTEM_ACTOR } from '../../core/context';
import { AppError } from '../../core/errors';
import { isExclusionViolation, PrismaService, type Db, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';

export interface OccupancyInsert {
  listingId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  kind: OccupancyKind;
  bookingId?: string | null;
  workOrderId?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  expiresAt?: Date | null;
  note?: string | null;
  createdBy?: string | null;
}

/**
 * Listing occupancy (SPEC §7 rule 15). Every writer locks the listing row first, purges expired
 * holds, and inserts under the database exclusion constraint, which is the final guarantee that
 * two stays can never overlap.
 */
@Injectable()
export class OccupancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async lockListing(tx: Tx, listingId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM listings WHERE id = ${listingId}::uuid FOR UPDATE`;
  }

  /** Removes lapsed holds for a listing and expires their bookings (lazy expiry before inserts). */
  async purgeExpiredHolds(tx: Tx, listingId: string): Promise<void> {
    const now = this.clock.now();
    const expired = await tx.listingOccupancy.findMany({
      where: { listingId, kind: 'BOOKING_HOLD', expiresAt: { lte: now } },
    });
    for (const hold of expired) {
      await tx.listingOccupancy.delete({ where: { id: hold.id } });
      if (!hold.bookingId) continue;
      const booking = await tx.booking.findUnique({ where: { id: hold.bookingId } });
      if (booking?.status === 'AWAITING_PAYMENT') {
        await this.records.transition(tx, bookingMachine, { entityId: booking.id, from: 'AWAITING_PAYMENT', to: 'EXPIRED', actor: SYSTEM_ACTOR, reason: 'HOLD_LAPSED' });
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } });
        await this.records.emit(tx, 'booking.expired', { bookingId: booking.id, reason: 'HOLD_LAPSED' });
      }
    }
  }

  /** Occupancy rows overlapping [start, end), ignoring lapsed holds. */
  async conflicts(db: Db, listingId: string, start: IsoDate, end: IsoDate) {
    const now = this.clock.now();
    return db.listingOccupancy.findMany({
      where: {
        listingId,
        startDate: { lt: isoToDate(end) },
        endDate: { gt: isoToDate(start) },
        NOT: { kind: 'BOOKING_HOLD', expiresAt: { lte: now } },
      },
    });
  }

  /** A maintenance window starting on the check-out day before the guest leaves also conflicts. */
  async maintenanceOnCheckoutDay(db: Db, listingId: string, checkOut: IsoDate, checkOutAt: Date): Promise<boolean> {
    const block = await db.listingOccupancy.findFirst({
      where: { listingId, kind: 'BLOCK_MAINTENANCE', startDate: isoToDate(checkOut), startsAt: { lt: checkOutAt } },
    });
    return !!block;
  }

  async insert(tx: Tx, row: OccupancyInsert) {
    try {
      return await tx.listingOccupancy.create({
        data: {
          listingId: row.listingId,
          startDate: isoToDate(row.startDate),
          endDate: isoToDate(row.endDate),
          kind: row.kind,
          bookingId: row.bookingId ?? null,
          workOrderId: row.workOrderId ?? null,
          startsAt: row.startsAt ?? null,
          endsAt: row.endsAt ?? null,
          expiresAt: row.expiresAt ?? null,
          note: row.note ?? null,
          createdBy: row.createdBy ?? null,
        },
      });
    } catch (err) {
      if (isExclusionViolation(err)) throw new AppError('DATES_UNAVAILABLE');
      throw err;
    }
  }

  /** Lock, purge, check and insert in one step. */
  async acquire(tx: Tx, row: OccupancyInsert): Promise<void> {
    await this.lockListing(tx, row.listingId);
    await this.purgeExpiredHolds(tx, row.listingId);
    if ((await this.conflicts(tx, row.listingId, row.startDate, row.endDate)).length) throw new AppError('DATES_UNAVAILABLE');
    await this.insert(tx, row);
  }

  /** Nights that cannot be booked between from and to (exclusive), with no reason disclosed. */
  async unavailableNights(listingId: string, from: IsoDate, to: IsoDate): Promise<IsoDate[]> {
    const rows = await this.conflicts(this.prisma, listingId, from, to);
    const nights = new Set<IsoDate>();
    for (const r of rows) {
      for (const n of eachNight(dateToIso(r.startDate), dateToIso(r.endDate))) if (n >= from && n < to) nights.add(n);
    }
    return [...nights].sort();
  }

  /** Calendar for owner/admin views: kinds and generic labels, never job details. */
  async calendar(listingId: string, from: IsoDate, to: IsoDate) {
    const rows = await this.conflicts(this.prisma, listingId, from, addDays(to, 1));
    const bookingIds = rows.map((r) => r.bookingId).filter((x): x is string => !!x);
    const bookings = await this.prisma.booking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, reference: true, status: true } });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      startDate: dateToIso(r.startDate),
      endDate: dateToIso(r.endDate),
      label:
        r.kind === 'BLOCK_MAINTENANCE'
          ? 'Maintenance scheduled'
          : r.kind === 'BLOCK_OWNER'
            ? (r.note ?? 'Blocked by owner')
            : r.kind === 'BLOCK_ADMIN'
              ? 'Blocked'
              : (bookings.find((b) => b.id === r.bookingId)?.reference ?? 'Booking'),
      bookingId: r.bookingId,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      removable: r.kind === 'BLOCK_OWNER',
    }));
  }
}
