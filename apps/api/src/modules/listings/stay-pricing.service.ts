import { Inject, Injectable } from '@nestjs/common';
import type { Listing } from '@prisma/client';
import {
  dateToIso,
  istDateOf,
  istInstant,
  priceStay,
  problemMessages,
  stayRequestProblems,
  type IsoDate,
  type StayPrice,
  type StayPricingInput,
  type StayRules,
} from '@propcare/shared';
import { CLOCK, type Clock } from '../../core/clock';
import { AppError } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService, type Db } from '../../core/prisma.service';
import { num } from '../../core/serialize';
import { OccupancyService } from './occupancy.service';

/** Server-side stay pricing (SPEC §7 rule 13). Totals are never accepted from clients. */
@Injectable()
export class StayPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly occupancy: OccupancyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async pricingInput(listing: Listing, db: Db = this.prisma): Promise<StayPricingInput> {
    const rules = await db.listingPriceRule.findMany({ where: { listingId: listing.id } });
    return {
      basePricePaise: num(listing.basePricePaise),
      weekendPricePaise: num(listing.weekendPricePaise, true),
      cleaningFeePaise: num(listing.cleaningFeePaise),
      priceRules: rules.map((r) => ({ startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), nightlyPricePaise: num(r.nightlyPricePaise) })),
      weekendNights: await this.policy.get('pricing.weekend_nights'),
      taxRateBps: await this.policy.get('pricing.stay_tax_bps'),
    };
  }

  rulesOf(listing: Listing): StayRules {
    return {
      minNights: listing.minNights,
      maxNights: listing.maxNights,
      maxGuests: listing.maxGuests,
      advanceNoticeHours: listing.advanceNoticeHours,
      maxAdvanceDays: listing.maxAdvanceDays,
      checkInTime: listing.checkInTime,
    };
  }

  /** Throws VALIDATION_FAILED with problem codes when the stay breaks the listing's rules. */
  validate(listing: Listing, req: { checkIn: IsoDate; checkOut: IsoDate; guests: number }): void {
    const now = this.clock.now();
    const problems = stayRequestProblems(this.rulesOf(listing), req, now, istDateOf(now));
    if (problems.length) {
      throw new AppError(
        'VALIDATION_FAILED',
        problems.map((code) => ({ code, message: problemMessages[code] })),
      );
    }
  }

  checkInAt(listing: Listing, checkIn: IsoDate): Date {
    return istInstant(checkIn, listing.checkInTime);
  }

  checkOutAt(listing: Listing, checkOut: IsoDate): Date {
    return istInstant(checkOut, listing.checkOutTime);
  }

  /** Public price quote: validated rules, availability, then the per-night breakdown. */
  async quote(listing: Listing, req: { checkIn: IsoDate; checkOut: IsoDate; guests: number }): Promise<StayPrice> {
    this.validate(listing, req);
    const conflicts = await this.occupancy.conflicts(this.prisma, listing.id, req.checkIn, req.checkOut);
    if (conflicts.length || (await this.occupancy.maintenanceOnCheckoutDay(this.prisma, listing.id, req.checkOut, this.checkOutAt(listing, req.checkOut)))) {
      throw new AppError('DATES_UNAVAILABLE');
    }
    return priceStay(await this.pricingInput(listing), req.checkIn, req.checkOut);
  }
}
