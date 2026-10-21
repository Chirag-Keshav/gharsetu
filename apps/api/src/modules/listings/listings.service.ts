import { Inject, Injectable } from '@nestjs/common';
import type { Listing, Prisma } from '@prisma/client';
import {
  calendarBlockSchema,
  dateToIso,
  diffDays,
  istDateOf,
  isoToDate,
  listingMachine,
  listingUpdateSchema,
  modeIncludesList,
  priceRuleSchema,
  type IsoDate,
} from '@propcare/shared';
import type { z } from 'zod';
import { OBJECT_STORAGE, type ObjectStorage } from '../../adapters/storage';
import { CLOCK, type Clock } from '../../core/clock';
import { isAdmin, type Actor, type UserActor } from '../../core/context';
import { AppError, forbidden, notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { isExclusionViolation, PrismaService, type Db, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { iso, num } from '../../core/serialize';
import { CatalogService } from '../catalog/catalog.service';
import { serializeListingOwner, type ListingWith } from './listing-serializers';
import { OccupancyService } from './occupancy.service';

const LISTING_INCLUDE = {
  photos: true,
  amenities: { include: { amenity: true } },
  property: true,
} satisfies Prisma.ListingInclude;

const CONTENT_FIELDS = ['title', 'description'];

/** Owner listing management (SPEC §8.3). Every read and write is scoped to the listing owner. */
@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly policy: PolicyService,
    private readonly catalog: CatalogService,
    private readonly occupancy: OccupancyService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async findVisible(actor: Actor, id: string, db: Db = this.prisma): Promise<Listing> {
    const l = await db.listing.findUnique({ where: { id } });
    if (!l) throw notFound();
    if (actor.kind === 'SYSTEM' || isAdmin(actor)) return l;
    if (actor.role === 'OWNER' && l.ownerUserId === actor.userId) return l;
    throw notFound();
  }

  /** Completeness required to submit or publish (SPEC §6.8, §7 rule 19). */
  async completeness(l: Listing & { photos?: unknown[] }, db: Db = this.prisma) {
    const minPhotos = await this.policy.get('listing.min_photos');
    const photoCount = l.photos ? l.photos.length : await db.listingPhoto.count({ where: { listingId: l.id } });
    const policy = l.cancellationPolicyKey ? await db.cancellationPolicy.findFirst({ where: { key: l.cancellationPolicyKey, isActive: true } }) : null;
    return [
      { item: 'title', ok: l.title.trim().length >= 5 },
      { item: 'description', ok: l.description.trim().length >= 50 },
      { item: 'photos', ok: photoCount >= minPhotos },
      { item: 'price', ok: l.basePricePaise > 0n },
      { item: 'capacity', ok: l.maxGuests >= 1 && l.beds >= 1 },
      { item: 'rules', ok: !!l.checkInTime && !!l.checkOutTime && l.houseRules !== null },
      { item: 'cancellationPolicy', ok: !!policy },
      { item: 'location', ok: l.publicAreaLabel.trim().length >= 3 },
    ];
  }

  async view(actor: Actor, id: string, db: Db = this.prisma) {
    await this.findVisible(actor, id, db);
    const l = (await db.listing.findUniqueOrThrow({ where: { id }, include: LISTING_INCLUDE })) as ListingWith;
    const attachments = await db.attachment.findMany({ where: { id: { in: (l.photos ?? []).map((p) => p.attachmentId) } } });
    const photoPreviews: Record<string, string> = {};
    for (const p of l.photos ?? []) {
      const a = attachments.find((x) => x.id === p.attachmentId);
      if (a) photoPreviews[p.id] = await this.storage.presignDownload(a.objectKey, 900, a.originalFilename);
    }
    return serializeListingOwner(l, { photoPreviews, completeness: await this.completeness(l, db) });
  }

  async create(actor: UserActor, propertyId: string) {
    return this.prisma.$transaction(async (tx) => {
      const property = await tx.property.findUnique({ where: { id: propertyId } });
      if (!property || (!isAdmin(actor) && property.ownerUserId !== actor.userId)) throw notFound();
      if (property.status !== 'ACTIVE') throw validation({ code: 'PROPERTY_ARCHIVED' });
      if (!modeIncludesList(property.serviceMode)) throw validation({ path: 'serviceMode', code: 'MODE_EXCLUDES_LIST' });
      const existing = await tx.listing.findUnique({ where: { propertyId } });
      if (existing) return this.view(actor, existing.id, tx);
      // The approximate position is rounded (~1 km) and never the exact pin (SPEC §11 listings).
      const approx = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
      const listing = await tx.listing.create({
        data: {
          reference: await this.records.nextReference(tx, 'LST'),
          propertyId,
          ownerUserId: property.ownerUserId,
          publicAreaLabel: `${property.locality}, ${property.city}`,
          approxLatitude: approx(property.latitude),
          approxLongitude: approx(property.longitude),
          cancellationPolicyKey: 'MODERATE',
          houseRules: { petsAllowed: false, smokingAllowed: false, eventsAllowed: false },
        },
      });
      await this.records.transition(tx, listingMachine, { entityId: listing.id, from: null, to: 'DRAFT', actor });
      await this.records.audit(tx, actor, {
        action: 'listing.created',
        entityType: 'LISTING',
        entityId: listing.id,
        onBehalfOf: isAdmin(actor) ? { type: 'OWNER', id: property.ownerUserId } : null,
      });
      return this.view(actor, listing.id, tx);
    });
  }

  async update(actor: UserActor, id: string, patch: z.infer<typeof listingUpdateSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const l = await this.findVisible(actor, id, tx);
      if (l.status === 'ARCHIVED' || l.status === 'REJECTED') throw new AppError('INVALID_STATE_TRANSITION', [{ code: `LISTING_${l.status}` }]);
      if (patch.cancellationPolicyKey && !(await tx.cancellationPolicy.findFirst({ where: { key: patch.cancellationPolicyKey, isActive: true } }))) {
        throw validation({ path: 'cancellationPolicyKey', code: 'UNKNOWN_POLICY' });
      }
      const minNights = patch.minNights ?? l.minNights;
      const maxNights = patch.maxNights ?? l.maxNights;
      if (maxNights < minNights) throw validation({ path: 'maxNights', code: 'LESS_THAN_MIN_NIGHTS' });
      const { basePricePaise, weekendPricePaise, cleaningFeePaise, houseRules, ...rest } = patch;
      const contentChanged = CONTENT_FIELDS.some((f) => (patch as Record<string, unknown>)[f] !== undefined && (patch as Record<string, unknown>)[f] !== (l as unknown as Record<string, unknown>)[f]);
      await tx.listing.update({
        where: { id },
        data: {
          ...rest,
          ...(houseRules ? { houseRules: houseRules as Prisma.InputJsonValue } : {}),
          ...(basePricePaise !== undefined ? { basePricePaise: BigInt(basePricePaise) } : {}),
          ...(weekendPricePaise !== undefined ? { weekendPricePaise: weekendPricePaise === null ? null : BigInt(weekendPricePaise) } : {}),
          ...(cleaningFeePaise !== undefined ? { cleaningFeePaise: BigInt(cleaningFeePaise) } : {}),
          // Content edits on a live listing apply immediately but go to the post-moderation queue.
          ...(contentChanged && l.status === 'PUBLISHED' ? { editedSinceReview: true } : {}),
        },
      });
      await this.records.audit(tx, actor, {
        action: 'listing.updated',
        entityType: 'LISTING',
        entityId: id,
        onBehalfOf: isAdmin(actor) ? { type: 'OWNER', id: l.ownerUserId } : null,
        metadata: { fields: Object.keys(patch) },
      });
      return this.view(actor, id, tx);
    });
  }

  async setAmenities(actor: UserActor, id: string, amenityIds: string[]) {
    await this.findVisible(actor, id);
    const valid = await this.prisma.amenity.count({ where: { id: { in: amenityIds }, isActive: true } });
    if (valid !== new Set(amenityIds).size) throw validation({ path: 'amenityIds', code: 'UNKNOWN_AMENITY' });
    await this.prisma.$transaction([
      this.prisma.listingAmenity.deleteMany({ where: { listingId: id } }),
      this.prisma.listingAmenity.createMany({ data: [...new Set(amenityIds)].map((amenityId) => ({ listingId: id, amenityId })) }),
    ]);
    return this.view(actor, id);
  }

  // --- photos -----------------------------------------------------------------------------------
  async addPhoto(actor: UserActor, id: string, attachmentId: string, caption?: string | null) {
    const result = await this.prisma.$transaction(async (tx) => {
      const l = await this.findVisible(actor, id, tx);
      if (l.status === 'ARCHIVED') throw new AppError('INVALID_STATE_TRANSITION');
      const att = await tx.attachment.findUnique({ where: { id: attachmentId } });
      if (!att || att.status !== 'AVAILABLE' || att.ownerType !== 'LISTING' || (att.ownerId && att.ownerId !== id) || (!isAdmin(actor) && att.uploadedBy !== actor.userId)) {
        throw validation({ path: 'attachmentId', code: 'INVALID_ATTACHMENT' });
      }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(att.mimeType)) throw validation({ path: 'attachmentId', code: 'PHOTO_TYPE_UNSUPPORTED' });
      if (await tx.listingPhoto.findFirst({ where: { attachmentId } })) throw validation({ path: 'attachmentId', code: 'ALREADY_ADDED' });
      await tx.attachment.update({ where: { id: attachmentId }, data: { ownerId: id } });
      const max = await tx.listingPhoto.aggregate({ where: { listingId: id }, _max: { position: true }, _count: true });
      await tx.listingPhoto.create({
        data: { listingId: id, attachmentId, caption: caption ?? null, position: (max._max.position ?? -1) + 1, isCover: max._count === 0 },
      });
      if (l.status === 'PUBLISHED') await tx.listing.update({ where: { id }, data: { editedSinceReview: true } });
      await this.records.emit(tx, 'listing.photos_changed', { listingId: id });
      return l;
    });
    return this.view(actor, result.id);
  }

  async updatePhoto(actor: UserActor, id: string, photoId: string, patch: { caption?: string | null; isCover?: boolean }) {
    await this.prisma.$transaction(async (tx) => {
      await this.findVisible(actor, id, tx);
      const photo = await tx.listingPhoto.findFirst({ where: { id: photoId, listingId: id } });
      if (!photo) throw notFound();
      if (patch.isCover) await tx.listingPhoto.updateMany({ where: { listingId: id }, data: { isCover: false } });
      await tx.listingPhoto.update({ where: { id: photoId }, data: { caption: patch.caption, isCover: patch.isCover } });
    });
    return this.view(actor, id);
  }

  async removePhoto(actor: UserActor, id: string, photoId: string) {
    await this.prisma.$transaction(async (tx) => {
      const l = await this.findVisible(actor, id, tx);
      const photo = await tx.listingPhoto.findFirst({ where: { id: photoId, listingId: id } });
      if (!photo) throw notFound();
      await tx.listingPhoto.delete({ where: { id: photoId } });
      if (photo.isCover) {
        const next = await tx.listingPhoto.findFirst({ where: { listingId: id }, orderBy: { position: 'asc' } });
        if (next) await tx.listingPhoto.update({ where: { id: next.id }, data: { isCover: true } });
      }
      if (l.status === 'PUBLISHED') await tx.listing.update({ where: { id }, data: { editedSinceReview: true } });
      await this.records.emit(tx, 'listing.photo_removed', { listingId: id, photoId });
    });
    return this.view(actor, id);
  }

  async reorderPhotos(actor: UserActor, id: string, photoIds: string[]) {
    await this.prisma.$transaction(async (tx) => {
      await this.findVisible(actor, id, tx);
      const photos = await tx.listingPhoto.findMany({ where: { listingId: id } });
      if (photos.length !== photoIds.length || photos.some((p) => !photoIds.includes(p.id))) throw validation({ path: 'photoIds', code: 'MUST_LIST_ALL_PHOTOS' });
      for (const [i, pid] of photoIds.entries()) await tx.listingPhoto.update({ where: { id: pid }, data: { position: i } });
    });
    return this.view(actor, id);
  }

  // --- lifecycle --------------------------------------------------------------------------------
  async submit(actor: UserActor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const l = await this.findVisible(actor, id, tx);
      const missing = (await this.completeness(l, tx)).filter((c) => !c.ok).map((c) => c.item);
      if (missing.length) throw validation(...missing.map((m) => ({ path: m, code: 'INCOMPLETE' })));
      const [profile, property] = await Promise.all([
        tx.ownerProfile.findUnique({ where: { userId: l.ownerUserId } }),
        tx.property.findUniqueOrThrow({ where: { id: l.propertyId } }),
      ]);
      const submitted = (s: string | undefined) => s === 'PENDING' || s === 'APPROVED';
      if (await this.policy.get('verification.require_for_listing')) {
        if (!submitted(profile?.verificationStatus) || !submitted(property.verificationStatus)) {
          throw validation({ path: 'verification', code: 'VERIFICATION_DOCUMENTS_REQUIRED' });
        }
      }
      await this.records.transition(tx, listingMachine, { entityId: id, from: l.status, to: 'SUBMITTED', actor });
      await tx.listing.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: this.clock.now() } });
      await this.records.audit(tx, actor, { action: 'listing.submitted', entityType: 'LISTING', entityId: id });
      await this.records.emit(tx, 'listing.submitted', { listingId: id, ownerUserId: l.ownerUserId, reference: l.reference, propertyId: l.propertyId });
      return this.view(actor, id, tx);
    });
  }

  async pause(actor: UserActor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const l = await this.findVisible(actor, id, tx);
      await this.records.transition(tx, listingMachine, { entityId: id, from: l.status, to: 'PAUSED', actor });
      await tx.listing.update({ where: { id }, data: { status: 'PAUSED', pausedBy: actor.role === 'ADMIN' ? 'ADMIN' : 'OWNER' } });
      await this.records.emit(tx, 'listing.status_changed', { listingId: id, from: l.status, to: 'PAUSED' });
      return this.view(actor, id, tx);
    });
  }

  async resume(actor: UserActor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const l = await this.findVisible(actor, id, tx);
      // An admin-paused listing can only be resumed by an admin (SPEC §6.8).
      if (l.pausedBy === 'ADMIN' && !isAdmin(actor)) throw forbidden('ADMIN_PAUSED');
      await this.records.transition(tx, listingMachine, { entityId: id, from: l.status, to: 'PUBLISHED', actor });
      await tx.listing.update({ where: { id }, data: { status: 'PUBLISHED', pausedBy: null } });
      await this.records.emit(tx, 'listing.status_changed', { listingId: id, from: l.status, to: 'PUBLISHED' });
      return this.view(actor, id, tx);
    });
  }

  async archive(actor: UserActor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const l = await this.findVisible(actor, id, tx);
      const today = isoToDate(istDateOf(this.clock.now()));
      const future = await tx.booking.count({ where: { listingId: id, status: 'CONFIRMED', checkOutDate: { gt: today } } });
      if (future > 0 && !isAdmin(actor)) throw validation({ code: 'FUTURE_BOOKINGS_EXIST' });
      await this.records.transition(tx, listingMachine, { entityId: id, from: l.status, to: 'ARCHIVED', actor });
      await tx.listing.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await this.records.audit(tx, actor, { action: 'listing.archived', entityType: 'LISTING', entityId: id });
      await this.records.emit(tx, 'listing.status_changed', { listingId: id, from: l.status, to: 'ARCHIVED' });
      return this.view(actor, id, tx);
    });
  }

  // --- calendar ---------------------------------------------------------------------------------
  async calendar(actor: UserActor, id: string, from: IsoDate, to: IsoDate) {
    await this.findVisible(actor, id);
    if (diffDays(from, to) > 400 || to < from) throw validation({ code: 'RANGE_TOO_LARGE' });
    return { items: await this.occupancy.calendar(id, from, to) };
  }

  async addBlock(actor: UserActor, id: string, input: z.infer<typeof calendarBlockSchema>) {
    return this.prisma.tx(async (tx: Tx) => {
      await this.findVisible(actor, id, tx);
      await this.occupancy.acquire(tx, {
        listingId: id,
        startDate: input.startDate,
        endDate: input.endDate,
        kind: isAdmin(actor) ? 'BLOCK_ADMIN' : 'BLOCK_OWNER',
        note: input.note ?? null,
        createdBy: actor.userId,
      });
      await this.records.audit(tx, actor, { action: 'listing.dates_blocked', entityType: 'LISTING', entityId: id, metadata: { startDate: input.startDate, endDate: input.endDate } });
      return { ok: true };
    });
  }

  async removeBlock(actor: UserActor, id: string, blockId: string) {
    await this.findVisible(actor, id);
    const res = await this.prisma.listingOccupancy.deleteMany({
      where: { id: blockId, listingId: id, kind: { in: isAdmin(actor) ? ['BLOCK_OWNER', 'BLOCK_ADMIN'] : ['BLOCK_OWNER'] } },
    });
    if (!res.count) throw notFound();
    await this.records.audit(this.prisma, actor, { action: 'listing.dates_unblocked', entityType: 'LISTING', entityId: id, metadata: { blockId } });
    return { ok: true };
  }

  // --- seasonal price rules (P1) ----------------------------------------------------------------
  async priceRules(actor: UserActor, id: string) {
    await this.findVisible(actor, id);
    const rows = await this.prisma.listingPriceRule.findMany({ where: { listingId: id }, orderBy: { startDate: 'asc' } });
    return {
      items: rows.map((r) => ({ id: r.id, startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), nightlyPricePaise: num(r.nightlyPricePaise), reason: r.reason })),
    };
  }

  async upsertPriceRule(actor: UserActor, id: string, ruleId: string | null, input: z.infer<typeof priceRuleSchema>) {
    await this.findVisible(actor, id);
    try {
      const data = { startDate: isoToDate(input.startDate), endDate: isoToDate(input.endDate), nightlyPricePaise: BigInt(input.nightlyPricePaise), reason: input.reason ?? null };
      if (ruleId) {
        const res = await this.prisma.listingPriceRule.updateMany({ where: { id: ruleId, listingId: id }, data });
        if (!res.count) throw notFound();
      } else {
        await this.prisma.listingPriceRule.create({ data: { ...data, listingId: id } });
      }
    } catch (err) {
      if (isExclusionViolation(err)) throw validation({ path: 'startDate', code: 'OVERLAPPING_PRICE_RULE' });
      throw err;
    }
    return this.priceRules(actor, id);
  }

  async deletePriceRule(actor: UserActor, id: string, ruleId: string) {
    await this.findVisible(actor, id);
    const res = await this.prisma.listingPriceRule.deleteMany({ where: { id: ruleId, listingId: id } });
    if (!res.count) throw notFound();
    return this.priceRules(actor, id);
  }

  // --- earnings ---------------------------------------------------------------------------------
  async earnings(actor: UserActor, id: string) {
    await this.findVisible(actor, id);
    const bookings = await this.prisma.booking.findMany({
      where: { listingId: id, status: { in: ['CONFIRMED', 'COMPLETED', 'CANCELLED'] }, confirmedAt: { not: null } },
      include: { payout: true },
      orderBy: { checkInDate: 'desc' },
      take: 200,
    });
    const rows = bookings.map((b) => ({
      bookingId: b.id,
      reference: b.reference,
      status: b.status,
      checkIn: dateToIso(b.checkInDate),
      checkOut: dateToIso(b.checkOutDate),
      roomRevenuePaise: num(b.nightsTotalPaise) + num(b.cleaningFeePaise),
      refundPaise: num(b.refundPaise),
      commissionBps: b.commissionBpsApplied,
      commissionPaise: num(b.commissionPaise),
      ownerPayoutPaise: num(b.ownerPayoutPaise),
      payout: b.payout
        ? { id: b.payout.id, reference: b.payout.reference, status: b.payout.status, amountPaise: num(b.payout.amountPaise), eligibleAt: iso(b.payout.eligibleAt), paidAt: iso(b.payout.paidAt) }
        : null,
    }));
    const totals = rows.reduce(
      (t, r) => ({
        commissionPaise: t.commissionPaise + r.commissionPaise,
        ownerPayoutPaise: t.ownerPayoutPaise + r.ownerPayoutPaise,
        paidPaise: t.paidPaise + (r.payout?.status === 'PAID' ? r.payout.amountPaise : 0),
      }),
      { commissionPaise: 0, ownerPayoutPaise: 0, paidPaise: 0 },
    );
    return { items: rows, totals };
  }

  /** Listing ids for the owner's properties, for scoping owner-wide queries. */
  async ownerListingIds(ownerUserId: string) {
    return (await this.prisma.listing.findMany({ where: { ownerUserId }, select: { id: true } })).map((l) => l.id);
  }
}
