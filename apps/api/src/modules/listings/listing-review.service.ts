import { Inject, Injectable } from '@nestjs/common';
import { listingMachine, type ListingStatus } from '@propcare/shared';
import { CLOCK, type Clock } from '../../core/clock';
import type { UserActor } from '../../core/context';
import { notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { afterCursor, iso, num, pageOrder, toPage } from '../../core/serialize';
import { CatalogService } from '../catalog/catalog.service';
import { ThreadsService } from '../threads/threads.service';
import { serializeListingPublic, type ListingWith } from './listing-serializers';
import { ListingsService } from './listings.service';

/** Admin listing review workflow (SPEC §8.3 LST-02). Decisions require LISTING_REVIEW. */
@Injectable()
export class ListingReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly policy: PolicyService,
    private readonly listings: ListingsService,
    private readonly catalog: CatalogService,
    private readonly threads: ThreadsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async queue(status: ListingStatus | undefined, edited: boolean | undefined, cursor: string | undefined, limit: number) {
    const where = edited ? { status: 'PUBLISHED' as const, editedSinceReview: true } : { status: status ?? ('SUBMITTED' as const) };
    const rows = await this.prisma.listing.findMany({
      where: { ...where, ...afterCursor(cursor) },
      include: { property: { select: { nickname: true, city: true, state: true, verificationStatus: true } } },
      orderBy: pageOrder,
      take: limit + 1,
    });
    const owners = await this.prisma.ownerProfile.findMany({ where: { userId: { in: rows.map((r) => r.ownerUserId) } } });
    return toPage(rows, limit, (l) => ({
      id: l.id,
      reference: l.reference,
      title: l.title,
      status: l.status,
      city: l.property.city,
      state: l.property.state,
      basePricePaise: num(l.basePricePaise),
      editedSinceReview: l.editedSinceReview,
      submittedAt: iso(l.submittedAt),
      waitingHours: l.submittedAt ? Math.round((this.clock.now().getTime() - l.submittedAt.getTime()) / 3_600_000) : null,
      propertyVerification: l.property.verificationStatus,
      ownerVerification: owners.find((o) => o.userId === l.ownerUserId)?.verificationStatus ?? 'NOT_SUBMITTED',
      createdAt: iso(l.createdAt),
    }));
  }

  /** The workspace shows the listing exactly as customers will see it, plus private review context. */
  async workspace(actor: UserActor, id: string) {
    const l = (await this.prisma.listing.findUnique({
      where: { id },
      include: { photos: true, amenities: { include: { amenity: true } }, property: true },
    })) as ListingWith | null;
    if (!l) throw notFound();
    const [owner, profile, policy, comparables, ownerView] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: l.ownerUserId }, select: { fullName: true } }),
      this.prisma.ownerProfile.findUnique({ where: { userId: l.ownerUserId } }),
      l.cancellationPolicyKey ? this.catalog.cancellationPolicy(l.cancellationPolicyKey) : null,
      this.prisma.listing.findMany({
        where: { status: 'PUBLISHED', id: { not: l.id }, property: { city: l.property!.city } },
        select: { id: true, title: true, basePricePaise: true, maxGuests: true, bedrooms: true, ratingAvg: true },
        take: 8,
      }),
      this.listings.view(actor, id),
    ]);
    return {
      preview: serializeListingPublic(l, policy),
      listing: ownerView,
      owner: { id: l.ownerUserId, name: owner?.fullName ?? null, verificationStatus: profile?.verificationStatus ?? 'NOT_SUBMITTED' },
      property: {
        id: l.propertyId,
        nickname: l.property!.nickname,
        city: l.property!.city,
        state: l.property!.state,
        pinCode: l.property!.pinCode,
        verificationStatus: l.property!.verificationStatus,
      },
      comparables: comparables.map((c) => ({ id: c.id, title: c.title, basePricePaise: num(c.basePricePaise), maxGuests: c.maxGuests, bedrooms: c.bedrooms, ratingAvg: c.ratingAvg })),
      gate: await this.gateProblems(id),
    };
  }

  /** Publish gate (SPEC §7 rule 19). Returns the unmet conditions. */
  async gateProblems(id: string): Promise<string[]> {
    const l = await this.prisma.listing.findUniqueOrThrow({ where: { id }, include: { property: true } });
    const problems: string[] = [];
    const profile = await this.prisma.ownerProfile.findUnique({ where: { userId: l.ownerUserId } });
    if (await this.policy.get('verification.require_for_listing')) {
      if (profile?.verificationStatus !== 'APPROVED') problems.push('OWNER_NOT_VERIFIED');
      if (l.property.verificationStatus !== 'APPROVED') problems.push('PROPERTY_NOT_VERIFIED');
    }
    if (l.property.status !== 'ACTIVE') problems.push('PROPERTY_NOT_ACTIVE');
    for (const c of await this.listings.completeness(l)) if (!c.ok) problems.push(`INCOMPLETE_${c.item.toUpperCase()}`);
    if (await this.policy.get('stays.restrict_to_service_areas')) {
      const area = await this.prisma.serviceArea.findFirst({ where: { isActive: true, offersStays: true, pinCodes: { has: l.property.pinCode } } });
      if (!area) problems.push('OUTSIDE_STAY_AREAS');
    }
    return problems;
  }

  private async decide(actor: UserActor, id: string, to: ListingStatus, message: string | null, extra: Record<string, unknown> = {}) {
    return this.prisma.$transaction(async (tx) => {
      const l = await tx.listing.findUnique({ where: { id } });
      if (!l) throw notFound();
      await this.records.transition(tx, listingMachine, { entityId: id, from: l.status, to, actor, reason: message });
      await tx.listing.update({ where: { id }, data: { status: to, reviewedBy: actor.userId, reviewedAt: this.clock.now(), ...extra } });
      if (message) await this.threads.post(tx, actor, 'LISTING_REVIEW', id, { body: message });
      await this.records.audit(tx, actor, { action: `listing.${to.toLowerCase()}`, entityType: 'LISTING', entityId: id, metadata: { from: l.status } });
      await this.records.emit(tx, 'listing.status_changed', {
        listingId: id,
        from: l.status,
        to,
        byAdmin: true,
        ownerUserId: l.ownerUserId,
        reference: l.reference,
        propertyId: l.propertyId,
      });
      return { id, status: to };
    });
  }

  requestChanges(actor: UserActor, id: string, message: string) {
    return this.decide(actor, id, 'CHANGES_REQUESTED', message);
  }

  async publish(actor: UserActor, id: string) {
    const problems = await this.gateProblems(id);
    if (problems.length) throw validation(...problems.map((code) => ({ code })));
    return this.decide(actor, id, 'PUBLISHED', null, { publishedAt: this.clock.now(), editedSinceReview: false, pausedBy: null });
  }

  reject(actor: UserActor, id: string, message: string) {
    return this.decide(actor, id, 'REJECTED', message);
  }

  pause(actor: UserActor, id: string, message: string | null) {
    return this.decide(actor, id, 'PAUSED', message, { pausedBy: 'ADMIN' });
  }

  resume(actor: UserActor, id: string) {
    return this.decide(actor, id, 'PUBLISHED', null, { pausedBy: null });
  }

  async markReviewed(actor: UserActor, id: string) {
    const res = await this.prisma.listing.updateMany({ where: { id, editedSinceReview: true }, data: { editedSinceReview: false, reviewedBy: actor.userId, reviewedAt: this.clock.now() } });
    if (!res.count) throw notFound();
    await this.records.audit(this.prisma, actor, { action: 'listing.edits_reviewed', entityType: 'LISTING', entityId: id });
    return { id, editedSinceReview: false };
  }
}
