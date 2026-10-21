/**
 * Per-feature context builders (SPEC §8.11 principle 4). Each builder selects an explicit
 * allow-list of fields; identity/ownership documents are never read here. The Redactor then runs
 * over the result with the known sensitive values of the subject.
 */
import type { AiFeatureKey } from '@propcare/shared';
import { istDateOf, maskContactDetails, PROPERTY_TYPES } from '@propcare/shared';
import sharp from 'sharp';
import type { AiImage } from '../../adapters/ai';
import type { ObjectStorage } from '../../adapters/storage';
import type { Actor } from '../../core/context';
import { isAdmin } from '../../core/context';
import { notFound, validation } from '../../core/errors';
import type { PrismaService } from '../../core/prisma.service';
import { num } from '../../core/serialize';

export interface BuiltContext {
  context: Record<string, unknown>;
  knownSecrets: Array<string | null | undefined>;
  images?: AiImage[];
  subjectType: string | null;
  subjectId: string | null;
}

export interface BuilderDeps {
  prisma: PrismaService;
  storage: ObjectStorage;
  now: Date;
  decrypt: (v: string | null) => string | null;
  metrics: () => Promise<Record<string, unknown>>;
}

/** Downscaled, metadata-free JPEGs for vision (EXIF/GPS removed by re-encoding). */
async function images(deps: BuilderDeps, keys: string[]): Promise<AiImage[]> {
  const out: AiImage[] = [];
  for (const key of keys.slice(0, 3)) {
    const buf = await deps.storage.get('private', key);
    if (!buf) continue;
    try {
      const jpeg = await sharp(buf).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
      out.push({ mediaType: 'image/jpeg', base64: jpeg.toString('base64') });
    } catch {
      // unsupported image (e.g. HEIC): skip
    }
  }
  return out;
}

async function propertySecrets(deps: BuilderDeps, propertyId: string) {
  const p = await deps.prisma.property.findUnique({ where: { id: propertyId }, include: { owner: { select: { fullName: true, phoneE164: true, email: true } }, contacts: true } });
  if (!p) return { property: null, secrets: [] as Array<string | null> };
  return {
    property: p,
    secrets: [
      p.addressLine1,
      p.addressLine2,
      deps.decrypt(p.accessNotes),
      p.owner.fullName,
      p.owner.phoneE164,
      p.owner.email,
      ...p.contacts.flatMap((c) => [c.name, c.phone]),
    ],
  };
}

export async function buildContext(
  feature: AiFeatureKey,
  actor: Actor,
  subjectId: string | undefined,
  params: Record<string, unknown>,
  deps: BuilderDeps,
): Promise<BuiltContext> {
  const { prisma } = deps;
  const requireSubject = () => {
    if (!subjectId) throw validation({ path: 'subjectId', code: 'REQUIRED' });
    return subjectId;
  };

  switch (feature) {
    case 'admin_briefing':
      return { context: await deps.metrics(), knownSecrets: [], subjectType: null, subjectId: null };

    case 'request_triage':
    case 'quote_draft': {
      const r = await prisma.serviceRequest.findUnique({ where: { id: requireSubject() } });
      if (!r) throw notFound();
      const [{ property, secrets }, category, categories, photos] = await Promise.all([
        propertySecrets(deps, r.propertyId),
        prisma.serviceCategory.findUniqueOrThrow({ where: { id: r.categoryId } }),
        prisma.serviceCategory.findMany({ where: { isActive: true }, select: { slug: true, name: true } }),
        prisma.attachment.findMany({ where: { ownerType: 'REQUEST', ownerId: r.id, status: 'AVAILABLE', mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] } }, select: { objectKey: true } }),
      ]);
      const base = {
        request: {
          title: r.title,
          description: r.description,
          intakeAnswers: r.intakeAnswers,
          urgency: r.urgency,
          safetyFlag: r.safetyFlag,
          preferredWindowsCount: Array.isArray(r.preferredWindows) ? r.preferredWindows.length : 0,
          photosCount: photos.length,
        },
        category: { slug: category.slug, name: category.name, inspectionUsuallyRequired: category.inspectionUsuallyRequired },
        property: { type: property?.propertyType ?? null, city: property?.city ?? null },
      };
      if (feature === 'request_triage') {
        return {
          context: { ...base, categories },
          knownSecrets: secrets,
          images: await images(deps, photos.map((p) => p.objectKey)),
          subjectType: 'SERVICE_REQUEST',
          subjectId: r.id,
        };
      }
      const similar = await prisma.quote.findMany({
        where: { status: 'APPROVED', quoteType: 'ORIGINAL', request: { categoryId: r.categoryId }, requestId: { not: r.id } },
        include: { lineItems: true },
        orderBy: { approvedAt: 'desc' },
        take: 5,
      });
      return {
        context: {
          ...base,
          similarApprovedQuotes: similar.map((q) => ({
            totalPaise: num(q.totalPaise),
            lines: q.lineItems.map((l) => ({ description: l.description, quantity: l.quantity.toFixed(3), unit: l.unit, unitPricePaise: num(l.unitPricePaise), lineType: l.lineType, direction: l.direction })),
          })),
        },
        knownSecrets: secrets,
        subjectType: 'SERVICE_REQUEST',
        subjectId: r.id,
      };
    }

    case 'listing_review':
    case 'listing_writer':
    case 'price_suggestion': {
      const l = await prisma.listing.findUnique({
        where: { id: requireSubject() },
        include: { amenities: { include: { amenity: true } }, photos: true, property: true },
      });
      if (!l) throw notFound();
      if (!isAdmin(actor) && !(actor.role === 'OWNER' && l.ownerUserId === actor.userId)) throw notFound();
      const { secrets } = await propertySecrets(deps, l.propertyId);
      const comparables = await prisma.listing.findMany({
        where: { status: 'PUBLISHED', id: { not: l.id }, property: { city: l.property.city } },
        select: { basePricePaise: true, maxGuests: true, bedrooms: true, ratingAvg: true, property: { select: { propertyType: true } } },
        take: 20,
      });
      const facts = {
        propertyType: l.property.propertyType,
        areaLabel: l.publicAreaLabel,
        city: l.property.city,
        state: l.property.state,
        maxGuests: l.maxGuests,
        bedrooms: l.bedrooms,
        beds: l.beds,
        bathrooms: l.bathrooms,
        amenities: l.amenities.map((a) => a.amenity.name),
        houseRules: l.houseRules,
        checkInTime: l.checkInTime,
        checkOutTime: l.checkOutTime,
      };
      const comps = comparables.map((c) => ({ basePricePaise: num(c.basePricePaise), maxGuests: c.maxGuests, bedrooms: c.bedrooms, ratingAvg: c.ratingAvg, propertyType: c.property.propertyType }));
      if (feature === 'listing_review') {
        const contact = maskContactDetails(`${l.title}\n${l.description}`);
        const [ownerProfile] = await Promise.all([prisma.ownerProfile.findUnique({ where: { userId: l.ownerUserId } })]);
        return {
          context: {
            listing: {
              ...facts,
              title: l.title,
              description: l.description,
              basePricePaise: num(l.basePricePaise),
              weekendPricePaise: num(l.weekendPricePaise, true),
              cleaningFeePaise: num(l.cleaningFeePaise),
              minNights: l.minNights,
              maxNights: l.maxNights,
              bookingMode: l.bookingMode,
              cancellationPolicyKey: l.cancellationPolicyKey,
              photoCount: l.photos.length,
              photoCaptions: l.photos.map((p) => p.caption).filter(Boolean),
            },
            containsContactDetails: contact.masked,
            contactDetailTypes: [...new Set(contact.hits)],
            verification: { owner: ownerProfile?.verificationStatus ?? 'NOT_SUBMITTED', property: l.property.verificationStatus },
            comparables: comps,
          },
          knownSecrets: secrets,
          subjectType: 'LISTING',
          subjectId: l.id,
        };
      }
      if (feature === 'listing_writer') {
        return {
          context: { facts, ownerNotes: typeof params.notes === 'string' ? params.notes.slice(0, 2000) : '', currentTitle: l.title, currentDescription: l.description },
          knownSecrets: secrets,
          subjectType: 'LISTING',
          subjectId: l.id,
        };
      }
      return {
        context: { facts, month: istDateOf(deps.now).slice(0, 7), comparables: comps, currentBasePricePaise: num(l.basePricePaise) },
        knownSecrets: secrets,
        subjectType: 'LISTING',
        subjectId: l.id,
      };
    }

    case 'provider_shortlist':
    case 'evidence_review': {
      const w = await prisma.workOrder.findUnique({ where: { id: requireSubject() } });
      if (!w) throw notFound();
      const r = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: w.requestId } });
      const { property, secrets } = await propertySecrets(deps, w.propertyId);
      if (feature === 'provider_shortlist') {
        // Only providers that already pass the deterministic eligibility checks (SPEC §8.8).
        const eligible = await prisma.serviceProvider.findMany({
          where: {
            status: 'ACTIVE',
            verificationStatus: 'APPROVED',
            skills: { some: { categoryId: r.categoryId } },
            areas: { some: { serviceArea: { isActive: true, pinCodes: { has: property?.pinCode ?? '' } } } },
          },
          include: { _count: { select: { assignments: true } } },
        });
        const providerSecrets = eligible.flatMap((p) => [p.name, p.contactName, p.phone]);
        return {
          context: {
            job: { category: r.categoryId, title: r.title, urgency: r.urgency, city: property?.city ?? null },
            providers: eligible.map((p) => ({ id: p.id, providerType: p.providerType, internalRating: p.internalRating, jobs: p._count.assignments, availabilityNotes: p.availabilityNotes ?? '' })),
          },
          knownSecrets: [...secrets, ...providerSecrets],
          subjectType: 'WORK_ORDER',
          subjectId: w.id,
        };
      }
      const [category, template, results, evidence, visits] = await Promise.all([
        prisma.serviceCategory.findUniqueOrThrow({ where: { id: r.categoryId } }),
        w.checklistTemplateId ? prisma.checklistTemplate.findUnique({ where: { id: w.checklistTemplateId } }) : null,
        prisma.workChecklistResult.findMany({ where: { workOrderId: w.id } }),
        prisma.attachment.findMany({ where: { ownerType: 'WORK_ORDER', ownerId: w.id, status: 'AVAILABLE' } }),
        prisma.workVisit.findMany({ where: { workOrderId: w.id } }),
      ]);
      return {
        context: {
          requiredEvidence: category.requiredEvidence,
          checklistTemplate: template?.items ?? [],
          checklistResults: results.map((x) => ({ itemKey: x.itemKey, result: x.result })),
          evidence: evidence.map((e) => ({ phase: e.evidencePhase, capturedAt: e.capturedAt?.toISOString() ?? null, uploadedAt: e.createdAt.toISOString(), mimeType: e.mimeType })),
          visits: visits.map((v) => ({ checkedInAt: v.checkedInAt.toISOString(), checkedOutAt: v.checkedOutAt?.toISOString() ?? null })),
        },
        knownSecrets: secrets,
        images: await images(deps, evidence.filter((e) => e.evidencePhase === 'AFTER' && e.mimeType.startsWith('image/')).map((e) => e.objectKey)),
        subjectType: 'WORK_ORDER',
        subjectId: w.id,
      };
    }

    case 'issue_summary': {
      const i = await prisma.issue.findUnique({ where: { id: requireSubject() } });
      if (!i) throw notFound();
      const messages = await prisma.message.findMany({ where: { threadType: 'ISSUE', threadId: i.id }, orderBy: { createdAt: 'asc' }, take: 20 });
      const people = await prisma.user.findMany({ where: { id: { in: [i.ownerUserId, i.customerUserId, i.raisedByUserId].filter((x): x is string => !!x) } }, select: { fullName: true, phoneE164: true, email: true } });
      return {
        context: {
          issue: { category: i.category, description: i.description, status: i.status, subjectType: i.subjectType, raisedByRole: i.raisedByRole },
          messages: messages.map((m) => ({ authorRole: m.authorRole, body: m.body })),
        },
        knownSecrets: people.flatMap((p) => [p.fullName, p.phoneE164, p.email]),
        subjectType: 'ISSUE',
        subjectId: i.id,
      };
    }

    case 'leakage_flag': {
      const b = await prisma.booking.findUnique({ where: { id: requireSubject() } });
      if (!b) throw notFound();
      const messages = await prisma.message.findMany({ where: { threadType: 'BOOKING', threadId: b.id, createdAt: { lte: b.confirmedAt ?? deps.now } }, orderBy: { createdAt: 'asc' }, take: 30 });
      const people = await prisma.user.findMany({ where: { id: { in: [b.ownerUserId, b.customerUserId] } }, select: { fullName: true, phoneE164: true, email: true } });
      return {
        context: { messages: messages.map((m) => ({ authorRole: m.authorRole, body: m.body })) },
        knownSecrets: people.flatMap((p) => [p.fullName, p.phoneE164, p.email]),
        subjectType: 'BOOKING',
        subjectId: b.id,
      };
    }

    case 'commission_insights': {
      const metrics = await deps.metrics();
      return { context: { commission: metrics.commission, marketplace: metrics.marketplace }, knownSecrets: [], subjectType: null, subjectId: null };
    }

    case 'request_assistant': {
      const propertyId = requireSubject();
      const p = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!p || (!isAdmin(actor) && p.ownerUserId !== actor.userId)) throw notFound();
      const { secrets } = await propertySecrets(deps, propertyId);
      const categories = await prisma.serviceCategory.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } });
      return {
        context: {
          ownerDescription: typeof params.text === 'string' ? params.text.slice(0, 3000) : '',
          propertyType: p.propertyType,
          categories: categories.map((c) => ({
            slug: c.slug,
            name: c.name,
            fields: ((c.intakeSchema as { fields?: Array<Record<string, unknown>> }).fields ?? []).map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options ?? null })),
          })),
        },
        knownSecrets: secrets,
        subjectType: 'PROPERTY',
        subjectId: p.id,
      };
    }

    case 'nl_search': {
      const amenities = await prisma.amenity.findMany({ where: { isActive: true }, select: { slug: true, name: true } });
      const places = await prisma.$queryRaw<Array<{ city: string; state: string }>>`
        SELECT DISTINCT p.city, p.state FROM listings l JOIN properties p ON p.id = l.property_id WHERE l.status = 'PUBLISHED' LIMIT 50`;
      return {
        context: {
          query: typeof params.query === 'string' ? params.query.slice(0, 300) : '',
          today: istDateOf(deps.now),
          amenities,
          propertyTypes: PROPERTY_TYPES,
          knownPlaces: places,
        },
        knownSecrets: [],
        subjectType: 'SEARCH',
        subjectId: null,
      };
    }
  }
}
