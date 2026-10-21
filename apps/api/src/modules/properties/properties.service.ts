import { Inject, Injectable } from '@nestjs/common';
import type { Property, PropertyContact, RequestStatus, VerificationStatus, WorkOrderStatus } from '@prisma/client';
import {
  dateToIso,
  istDateOf,
  isoToDate,
  listingMachine,
  modeIncludesCare,
  modeIncludesList,
  propertyContactSchema,
  propertyCreateSchema,
  propertyUpdateSchema,
  verificationMachine,
  verificationSubmitSchema,
  type ServiceMode,
} from '@propcare/shared';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../core/clock';
import { isAdmin, SYSTEM_ACTOR, type Actor, type UserActor } from '../../core/context';
import { FIELD_CIPHER, type FieldCipher } from '../../core/crypto';
import { AppError, notFound, validation } from '../../core/errors';
import { PrismaService, type Db } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { iso } from '../../core/serialize';
import { AttachmentsService } from '../attachments/attachments.service';

const OPEN_REQUEST = { notIn: ['REJECTED', 'CANCELLED', 'NOT_SERVICEABLE', 'WORK_ORDER_CREATED'] as RequestStatus[] };
const OPEN_WORK_ORDER = { notIn: ['COMPLETED', 'CANCELLED'] as WorkOrderStatus[] };

/** Properties are scoped by owner in every query (SPEC §0.3 rule 5). */
@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly attachments: AttachmentsService,
    @Inject(FIELD_CIPHER) private readonly cipher: FieldCipher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Loads a property the actor may see, or 404. */
  async findVisible(actor: Actor, id: string, db: Db = this.prisma): Promise<Property> {
    const p = await db.property.findUnique({ where: { id } });
    if (!p) throw notFound();
    if (actor.kind === 'SYSTEM' || isAdmin(actor)) return p;
    if (actor.role === 'OWNER' && p.ownerUserId === actor.userId) return p;
    throw notFound();
  }

  serialize(p: Property & { listing?: { id: string; status: string; reference: string } | null; contacts?: PropertyContact[] }, opts: { accessNotes?: boolean } = {}) {
    return {
      id: p.id,
      nickname: p.nickname,
      propertyType: p.propertyType,
      addressLine1: p.addressLine1,
      addressLine2: p.addressLine2,
      locality: p.locality,
      city: p.city,
      district: p.district,
      state: p.state,
      pinCode: p.pinCode,
      latitude: p.latitude,
      longitude: p.longitude,
      areaSqft: p.areaSqft,
      serviceMode: p.serviceMode,
      status: p.status,
      verificationStatus: p.verificationStatus,
      hasAccessNotes: !!p.accessNotes,
      ...(opts.accessNotes ? { accessNotes: this.cipher.decrypt(p.accessNotes) } : {}),
      listing: p.listing ? { id: p.listing.id, status: p.listing.status, reference: p.listing.reference } : null,
      contacts: p.contacts
        ?.filter((c) => !c.deletedAt)
        .map((c) => ({ id: c.id, name: c.name, phone: c.phone, relationship: c.relationship, accessRole: c.accessRole })),
      createdAt: iso(p.createdAt),
    };
  }

  async list(actor: UserActor, includeArchived = false) {
    const rows = await this.prisma.property.findMany({
      where: { ownerUserId: actor.userId, ...(includeArchived ? {} : { status: 'ACTIVE' }) },
      include: { listing: { select: { id: true, status: true, reference: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const counts = await this.prisma.serviceRequest.groupBy({
      by: ['propertyId'],
      where: { ownerUserId: actor.userId, status: OPEN_REQUEST },
      _count: true,
    });
    const open = new Map(counts.map((c) => [c.propertyId, c._count]));
    return { items: rows.map((p) => ({ ...this.serialize(p), openRequests: open.get(p.id) ?? 0 })), nextCursor: null };
  }

  async create(actor: UserActor, input: z.infer<typeof propertyCreateSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.property.create({
        data: { ...input, accessNotes: this.cipher.encrypt(input.accessNotes), ownerUserId: actor.userId },
      });
      await tx.ownerProfile.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId }, update: {} });
      await this.records.audit(tx, actor, {
        action: 'property.created',
        entityType: 'PROPERTY',
        entityId: p.id,
        metadata: { serviceMode: p.serviceMode },
      });
      return this.serialize(p);
    });
  }

  async get(actor: UserActor, id: string, includeAccessNotes: boolean) {
    const p = await this.findVisible(actor, id);
    const full = await this.prisma.property.findUniqueOrThrow({
      where: { id: p.id },
      include: { listing: { select: { id: true, status: true, reference: true } }, contacts: true },
    });
    if (includeAccessNotes && isAdmin(actor)) {
      await this.records.audit(this.prisma, actor, { action: 'property.access_notes_viewed', entityType: 'PROPERTY', entityId: id });
    }
    return this.serialize(full, { accessNotes: includeAccessNotes });
  }

  private async futureConfirmedBookings(db: Db, propertyId: string): Promise<number> {
    const today = isoToDate(istDateOf(this.clock.now()));
    return db.booking.count({
      where: { listing: { propertyId }, status: 'CONFIRMED', checkOutDate: { gt: today } },
    });
  }

  private async openCareWork(db: Db, propertyId: string): Promise<number> {
    const [requests, workOrders] = await Promise.all([
      db.serviceRequest.count({ where: { propertyId, status: OPEN_REQUEST } }),
      db.workOrder.count({ where: { propertyId, status: OPEN_WORK_ORDER } }),
    ]);
    return requests + workOrders;
  }

  async update(actor: UserActor, id: string, patch: z.infer<typeof propertyUpdateSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.findVisible(actor, id, tx);
      if (p.status === 'ARCHIVED') throw new AppError('INVALID_STATE_TRANSITION', [{ code: 'PROPERTY_ARCHIVED' }]);
      const changed = Object.keys(patch).filter((k) => {
        const key = k as keyof typeof patch;
        if (key === 'accessNotes') return (patch.accessNotes ?? null) !== this.cipher.decrypt(p.accessNotes);
        return patch[key] !== undefined && patch[key] !== (p as unknown as Record<string, unknown>)[key];
      });

      if (patch.serviceMode && patch.serviceMode !== p.serviceMode) {
        const from = p.serviceMode as ServiceMode;
        const to = patch.serviceMode as ServiceMode;
        if (modeIncludesList(from) && !modeIncludesList(to) && (await this.futureConfirmedBookings(tx, id)) > 0) {
          throw validation({ path: 'serviceMode', code: 'FUTURE_BOOKINGS_EXIST' });
        }
        if (modeIncludesCare(from) && !modeIncludesCare(to) && (await this.openCareWork(tx, id)) > 0) {
          throw validation({ path: 'serviceMode', code: 'OPEN_MAINTENANCE_EXISTS' });
        }
      }

      const updated = await tx.property.update({
        where: { id },
        data: {
          ...patch,
          accessNotes: patch.accessNotes === undefined ? undefined : this.cipher.encrypt(patch.accessNotes),
        },
      });

      // A material location change (PIN code or locality) forces listing re-review (SPEC §6.8).
      const material = (patch.pinCode && patch.pinCode !== p.pinCode) || (patch.locality && patch.locality !== p.locality);
      if (material) {
        const listing = await tx.listing.findUnique({ where: { propertyId: id } });
        if (listing && (listing.status === 'PUBLISHED' || listing.status === 'PAUSED')) {
          await this.records.transition(tx, listingMachine, {
            entityId: listing.id,
            from: listing.status,
            to: 'SUBMITTED',
            actor: SYSTEM_ACTOR,
            reason: 'MATERIAL_LOCATION_CHANGE',
          });
          await tx.listing.update({ where: { id: listing.id }, data: { status: 'SUBMITTED', submittedAt: this.clock.now() } });
          await this.records.emit(tx, 'listing.status_changed', { listingId: listing.id, from: listing.status, to: 'SUBMITTED' });
        }
      }

      const audited = ['addressLine1', 'addressLine2', 'locality', 'city', 'district', 'state', 'pinCode', 'accessNotes', 'serviceMode', 'latitude', 'longitude'];
      if (changed.some((c) => audited.includes(c))) {
        // Field names only; access-note content is never written to the audit trail.
        await this.records.audit(tx, actor, {
          action: 'property.updated',
          entityType: 'PROPERTY',
          entityId: id,
          metadata: { fields: changed, ...(patch.serviceMode && patch.serviceMode !== p.serviceMode ? { serviceMode: { from: p.serviceMode, to: patch.serviceMode } } : {}) },
        });
      }
      return this.serialize(updated);
    });
  }

  async archive(actor: UserActor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.findVisible(actor, id, tx);
      if (p.status === 'ARCHIVED') return this.serialize(p);
      if ((await this.openCareWork(tx, id)) > 0) throw validation({ code: 'OPEN_MAINTENANCE_EXISTS' });
      if ((await this.futureConfirmedBookings(tx, id)) > 0) throw validation({ code: 'FUTURE_BOOKINGS_EXIST' });
      const listing = await tx.listing.findUnique({ where: { propertyId: id } });
      if (listing && listing.status !== 'ARCHIVED') {
        await this.records.transition(tx, listingMachine, { entityId: listing.id, from: listing.status, to: 'ARCHIVED', actor, reason: 'PROPERTY_ARCHIVED' });
        await tx.listing.update({ where: { id: listing.id }, data: { status: 'ARCHIVED' } });
        await this.records.emit(tx, 'listing.status_changed', { listingId: listing.id, from: listing.status, to: 'ARCHIVED' });
      }
      const updated = await tx.property.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await this.records.audit(tx, actor, { action: 'property.archived', entityType: 'PROPERTY', entityId: id });
      return this.serialize(updated);
    });
  }

  // --- contacts ---------------------------------------------------------------------------------
  async addContact(actor: UserActor, propertyId: string, input: z.infer<typeof propertyContactSchema>) {
    await this.findVisible(actor, propertyId);
    const c = await this.prisma.propertyContact.create({
      data: { propertyId, name: input.name, phone: input.phone, relationship: input.relationship, accessRole: input.accessRole ?? null, consentConfirmed: true },
    });
    await this.records.audit(this.prisma, actor, { action: 'property.contact_added', entityType: 'PROPERTY', entityId: propertyId, metadata: { contactId: c.id } });
    return { id: c.id };
  }

  async updateContact(actor: UserActor, propertyId: string, contactId: string, input: Partial<z.infer<typeof propertyContactSchema>>) {
    await this.findVisible(actor, propertyId);
    const res = await this.prisma.propertyContact.updateMany({
      where: { id: contactId, propertyId, deletedAt: null },
      data: { name: input.name, phone: input.phone, relationship: input.relationship, accessRole: input.accessRole },
    });
    if (!res.count) throw notFound();
    return { id: contactId };
  }

  async removeContact(actor: UserActor, propertyId: string, contactId: string) {
    await this.findVisible(actor, propertyId);
    const res = await this.prisma.propertyContact.updateMany({
      where: { id: contactId, propertyId, deletedAt: null },
      data: { deletedAt: this.clock.now() },
    });
    if (!res.count) throw notFound();
    await this.records.audit(this.prisma, actor, { action: 'property.contact_removed', entityType: 'PROPERTY', entityId: propertyId, metadata: { contactId } });
    return { ok: true };
  }

  // --- verification (SPEC §8.2 VER-01) -----------------------------------------------------------
  async submitVerification(actor: UserActor, propertyId: string, input: z.infer<typeof verificationSubmitSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.findVisible(actor, propertyId, tx);
      const profile = await tx.ownerProfile.upsert({ where: { userId: p.ownerUserId }, create: { userId: p.ownerUserId }, update: {} });
      const now = this.clock.now();

      const submit = async (subjectType: 'OWNER' | 'PROPERTY', subjectId: string, current: VerificationStatus, docs: Array<{ docType: string; attachmentId: string; expiresAt?: string }>) => {
        await this.records.transition(tx, verificationMachine, { entityId: subjectId, from: current, to: 'PENDING', actor });
        const v = await tx.verification.create({ data: { subjectType, subjectId, status: 'PENDING', submittedAt: now } });
        await this.attachments.link(tx, actor, docs.map((d) => d.attachmentId), 'VERIFICATION', v.id);
        const atts = await tx.attachment.findMany({ where: { id: { in: docs.map((d) => d.attachmentId) } }, select: { id: true, objectKey: true } });
        await tx.verificationDocument.createMany({
          data: docs.map((d) => ({
            ownerType: 'VERIFICATION' as const,
            ownerId: v.id,
            docType: d.docType,
            attachmentId: d.attachmentId,
            objectKey: atts.find((a) => a.id === d.attachmentId)!.objectKey,
            expiresAt: d.expiresAt ? isoToDate(d.expiresAt) : null,
          })),
        });
        await this.records.audit(tx, actor, {
          action: 'verification.submitted',
          entityType: 'VERIFICATION',
          entityId: v.id,
          metadata: { subjectType, subjectId, docTypes: docs.map((d) => d.docType) },
        });
        await this.records.emit(tx, 'verification.submitted', { verificationId: v.id, subjectType });
      };

      if (input.ownerDocuments.length) {
        if (profile.verificationStatus === 'PENDING' || profile.verificationStatus === 'APPROVED') {
          throw validation({ path: 'ownerDocuments', code: `OWNER_VERIFICATION_${profile.verificationStatus}` });
        }
        await submit('OWNER', p.ownerUserId, profile.verificationStatus, input.ownerDocuments);
        await tx.ownerProfile.update({ where: { userId: p.ownerUserId }, data: { verificationStatus: 'PENDING' } });
      } else if (profile.verificationStatus === 'NOT_SUBMITTED' || profile.verificationStatus === 'REJECTED') {
        throw validation({ path: 'ownerDocuments', code: 'IDENTITY_DOCUMENT_REQUIRED' });
      }
      if (p.verificationStatus === 'PENDING' || p.verificationStatus === 'APPROVED') {
        throw validation({ path: 'propertyDocuments', code: `PROPERTY_VERIFICATION_${p.verificationStatus}` });
      }
      await submit('PROPERTY', p.id, p.verificationStatus, input.propertyDocuments);
      await tx.property.update({ where: { id: p.id }, data: { verificationStatus: 'PENDING' } });
      return this.verificationStatus(actor, propertyId, tx);
    });
  }

  /** Status only; documents come back as upload receipts, never as downloadable files. */
  async verificationStatus(actor: UserActor, propertyId: string, db: Db = this.prisma) {
    const p = await this.findVisible(actor, propertyId, db);
    const profile = await db.ownerProfile.findUnique({ where: { userId: p.ownerUserId } });
    const latest = async (subjectType: 'OWNER' | 'PROPERTY', subjectId: string) => {
      const v = await db.verification.findFirst({ where: { subjectType, subjectId }, orderBy: { createdAt: 'desc' } });
      if (!v) return null;
      const docs = await db.verificationDocument.findMany({ where: { ownerType: 'VERIFICATION', ownerId: v.id } });
      return {
        status: v.status,
        submittedAt: iso(v.submittedAt),
        reviewedAt: iso(v.reviewedAt),
        reason: v.status === 'REJECTED' ? v.reason : null,
        documents: docs.map((d) => ({ docType: d.docType, receivedAt: iso(d.createdAt), expiresAt: d.expiresAt ? dateToIso(d.expiresAt) : null })),
      };
    };
    return {
      owner: { status: profile?.verificationStatus ?? 'NOT_SUBMITTED', latest: await latest('OWNER', p.ownerUserId) },
      property: { status: p.verificationStatus, latest: await latest('PROPERTY', p.id) },
    };
  }
}
