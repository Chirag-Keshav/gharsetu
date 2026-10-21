import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, diffDays, istDateOf, priceStay, type IsoDate, type SearchQuery } from '@propcare/shared';
import { CLOCK, type Clock } from '../../core/clock';
import { notFound, validation } from '../../core/errors';
import { PrismaService } from '../../core/prisma.service';
import { decodeCursor, encodeCursor, iso } from '../../core/serialize';
import { CatalogService } from '../catalog/catalog.service';
import { serializeListingPublic, type ListingWith, type PublicVariants } from './listing-serializers';
import { OccupancyService } from './occupancy.service';
import { StayPricingService } from './stay-pricing.service';

interface SearchRow {
  id: string;
  title: string;
  public_area_label: string;
  city: string;
  state: string;
  property_type: string;
  max_guests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  base_price_paise: bigint;
  price_from_paise: bigint;
  rating_avg: number | null;
  rating_count: number;
  approx_latitude: number | null;
  approx_longitude: number | null;
  booking_mode: string;
  cover: unknown;
}

const CACHE_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;

/**
 * Public discovery (SPEC §8.4). Only PUBLISHED listings of ACTIVE properties, public fields only,
 * no session involved. Search is deterministic PostgreSQL full-text + trigram matching.
 */
@Injectable()
export class PublicService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly occupancy: OccupancyService,
    private readonly pricing: StayPricingService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (CACHE_TTL_MS > 0 && hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value as T);
    return fn().then((value) => {
      if (CACHE_TTL_MS > 0) {
        if (this.cache.size > 500) this.cache.clear();
        this.cache.set(key, { at: Date.now(), value });
      }
      return value;
    });
  }

  async search(q: SearchQuery) {
    return this.cached(`search:${JSON.stringify(q)}`, () => this.runSearch(q));
  }

  private async runSearch(q: SearchQuery) {
    const now = this.clock.now();
    const where: Prisma.Sql[] = [Prisma.sql`l.status = 'PUBLISHED'`, Prisma.sql`p.status = 'ACTIVE'`];
    const text = q.q?.trim();
    if (text) {
      const like = `%${text.replace(/[%_]/g, '')}%`;
      where.push(Prisma.sql`(
        l.search_vector @@ plainto_tsquery('simple', ${text})
        OR l.search_vector @@ plainto_tsquery('english', ${text})
        OR l.public_area_label ILIKE ${like} OR p.city ILIKE ${like} OR p.district ILIKE ${like} OR p.state ILIKE ${like}
        OR similarity(l.public_area_label, ${text}) > 0.3 OR similarity(p.city, ${text}) > 0.4)`);
    }
    if (q.guests) where.push(Prisma.sql`l.max_guests >= ${q.guests}`);
    if (q.minPricePaise !== undefined) where.push(Prisma.sql`l.base_price_paise >= ${BigInt(q.minPricePaise)}`);
    if (q.maxPricePaise !== undefined) where.push(Prisma.sql`l.base_price_paise <= ${BigInt(q.maxPricePaise)}`);
    if (q.propertyType) where.push(Prisma.sql`p.property_type = ${q.propertyType}`);
    if (q.bedrooms !== undefined) where.push(Prisma.sql`l.bedrooms >= ${q.bedrooms}`);
    if (q.minRating !== undefined) where.push(Prisma.sql`l.rating_avg >= ${q.minRating}`);
    if (q.amenities.length) {
      where.push(Prisma.sql`(SELECT count(DISTINCT a.slug) FROM listing_amenities la JOIN amenities a ON a.id = la.amenity_id
        WHERE la.listing_id = l.id AND a.slug = ANY(${q.amenities})) = ${q.amenities.length}`);
    }
    if (q.checkIn && q.checkOut) {
      const nights = diffDays(q.checkIn, q.checkOut);
      // Half-open ranges: a stay ending on a date never blocks one starting that date.
      where.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM listing_occupancy o WHERE o.listing_id = l.id
        AND o.start_date < ${q.checkOut}::date AND o.end_date > ${q.checkIn}::date
        AND NOT (o.kind = 'BOOKING_HOLD' AND o.expires_at <= ${now}))`);
      where.push(Prisma.sql`l.min_nights <= ${nights} AND l.max_nights >= ${nights}`);
      where.push(Prisma.sql`${q.checkIn}::date <= (${istDateOf(now)}::date + l.max_advance_days)`);
    }
    const rank = text
      ? Prisma.sql`(ts_rank(l.search_vector, plainto_tsquery('simple', ${text})) + ts_rank(l.search_vector, plainto_tsquery('english', ${text})) + similarity(l.public_area_label, ${text}))`
      : Prisma.sql`(0)::real`;
    const order = {
      relevance: Prisma.sql`${rank} DESC, l.rating_avg DESC NULLS LAST, l.published_at DESC, l.id`,
      price_asc: Prisma.sql`l.base_price_paise ASC, l.id`,
      price_desc: Prisma.sql`l.base_price_paise DESC, l.id`,
      rating: Prisma.sql`l.rating_avg DESC NULLS LAST, l.rating_count DESC, l.id`,
      newest: Prisma.sql`l.published_at DESC NULLS LAST, l.id`,
    }[q.sort];
    const offset = q.cursor ? Math.max(0, Number(Buffer.from(q.cursor, 'base64url').toString('utf8')) || 0) : 0;

    const rows = await this.prisma.$queryRaw<SearchRow[]>`
      SELECT l.id, l.title, l.public_area_label, p.city, p.state, p.property_type, l.max_guests, l.bedrooms, l.beds, l.bathrooms,
             l.base_price_paise, LEAST(l.base_price_paise, COALESCE(l.weekend_price_paise, l.base_price_paise)) AS price_from_paise,
             l.rating_avg, l.rating_count, l.approx_latitude, l.approx_longitude, l.booking_mode::text AS booking_mode,
             (SELECT ph.public_variants FROM listing_photos ph WHERE ph.listing_id = l.id AND ph.public_variants IS NOT NULL
               ORDER BY ph.is_cover DESC, ph.position ASC LIMIT 1) AS cover
      FROM listings l JOIN properties p ON p.id = l.property_id
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY ${order}
      LIMIT ${q.limit + 1} OFFSET ${offset}`;

    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const totals = new Map<string, number>();
    if (q.checkIn && q.checkOut && page.length) {
      const listings = await this.prisma.listing.findMany({ where: { id: { in: page.map((r) => r.id) } } });
      for (const l of listings) {
        totals.set(l.id, priceStay(await this.pricing.pricingInput(l), q.checkIn, q.checkOut).totalPaise);
      }
    }
    return {
      items: page.map((r) => ({
        id: r.id,
        title: r.title,
        publicAreaLabel: r.public_area_label,
        city: r.city,
        state: r.state,
        propertyType: r.property_type,
        maxGuests: r.max_guests,
        bedrooms: r.bedrooms,
        beds: r.beds,
        bathrooms: r.bathrooms,
        priceFromPaise: Number(r.price_from_paise),
        stayTotalPaise: totals.get(r.id) ?? null,
        ratingAvg: r.rating_avg,
        ratingCount: r.rating_count,
        approxLatitude: r.approx_latitude,
        approxLongitude: r.approx_longitude,
        bookingMode: r.booking_mode,
        coverPhoto: (r.cover as PublicVariants | null) ?? null,
      })),
      nextCursor: hasMore ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
    };
  }

  private async publishedListing(id: string) {
    const l = (await this.prisma.listing.findFirst({
      where: { id, status: 'PUBLISHED', property: { status: 'ACTIVE' } },
      include: { photos: true, amenities: { include: { amenity: true } }, property: { select: { propertyType: true, city: true, district: true, state: true } } },
    })) as ListingWith | null;
    if (!l) throw notFound();
    return l;
  }

  async detail(id: string) {
    return this.cached(`detail:${id}`, async () => {
      const l = await this.publishedListing(id);
      const policy = l.cancellationPolicyKey ? await this.catalog.cancellationPolicy(l.cancellationPolicyKey) : null;
      return { ...serializeListingPublic(l, policy), reviews: await this.reviews(id, undefined, 5) };
    });
  }

  async availability(id: string, from?: IsoDate, to?: IsoDate) {
    const l = await this.publishedListing(id);
    const start = from ?? istDateOf(this.clock.now());
    const end = to ?? addDays(start, 183);
    if (end <= start || diffDays(start, end) > 200) throw validation({ code: 'RANGE_INVALID' });
    return {
      from: start,
      to: end,
      unavailable: await this.occupancy.unavailableNights(l.id, start, end),
      minNights: l.minNights,
      maxNights: l.maxNights,
      advanceNoticeHours: l.advanceNoticeHours,
      maxAdvanceDays: l.maxAdvanceDays,
    };
  }

  /** Customer-facing price quote: no commission is ever shown (SPEC §8.5). */
  async priceQuote(id: string, body: { checkIn: IsoDate; checkOut: IsoDate; guests: number }) {
    const l = await this.prisma.listing.findFirst({ where: { id, status: 'PUBLISHED', property: { status: 'ACTIVE' } } });
    if (!l) throw notFound();
    const price = await this.pricing.quote(l, body);
    return {
      currency: price.currency,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      guests: body.guests,
      nights: price.nights,
      nightsTotalPaise: price.nightsTotalPaise,
      cleaningFeePaise: price.cleaningFeePaise,
      taxPaise: price.taxPaise,
      totalPaise: price.totalPaise,
      bookingMode: l.bookingMode,
    };
  }

  async suggest(q: string) {
    const text = q.trim();
    if (text.length < 2) return { items: [] };
    const like = `${text.replace(/[%_]/g, '')}%`;
    const rows = await this.prisma.$queryRaw<Array<{ label: string }>>`
      SELECT label FROM (
        SELECT DISTINCT l.public_area_label AS label FROM listings l JOIN properties p ON p.id = l.property_id
          WHERE l.status = 'PUBLISHED' AND (l.public_area_label ILIKE ${'%' + like} OR similarity(l.public_area_label, ${text}) > 0.3)
        UNION SELECT DISTINCT p.city FROM listings l JOIN properties p ON p.id = l.property_id
          WHERE l.status = 'PUBLISHED' AND (p.city ILIKE ${like} OR similarity(p.city, ${text}) > 0.4)
        UNION SELECT DISTINCT p.state FROM listings l JOIN properties p ON p.id = l.property_id
          WHERE l.status = 'PUBLISHED' AND p.state ILIKE ${like}
      ) s ORDER BY similarity(label, ${text}) DESC LIMIT 8`;
    return { items: rows.map((r) => r.label) };
  }

  async reviews(listingId: string, cursor: string | undefined, limit = 10) {
    const c = decodeCursor(cursor);
    const rows = await this.prisma.review.findMany({
      where: {
        listingId,
        status: 'PUBLISHED',
        listing: { status: 'PUBLISHED' },
        ...(c ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.customerUserId) } }, select: { id: true, fullName: true } });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        rating: r.rating,
        body: r.body,
        // First name only; no other personal data is public.
        authorFirstName: users.find((u) => u.id === r.customerUserId)?.fullName?.split(' ')[0] ?? 'Guest',
        createdAt: iso(r.createdAt),
      })),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    };
  }
}
