import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, RequestStatus, ServiceRequest } from '@prisma/client';
import {
  evaluateDangerRules,
  guidanceMessages,
  inspectionCreateSchema,
  inspectionMachine,
  inspectionUpdateSchema,
  maxUrgency,
  modeIncludesCare,
  serviceRequestCreateSchema,
  serviceRequestMachine,
  validateIntakeAnswers,
  type Urgency,
} from '@propcare/shared';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../core/clock';
import { isAdmin, SYSTEM_ACTOR, type Actor, type UserActor } from '../../core/context';
import { AppError, forbidden, notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService, type Db, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { afterCursor, iso, num, pageOrder, toPage } from '../../core/serialize';
import { AttachmentsService } from '../attachments/attachments.service';
import { CatalogService } from '../catalog/catalog.service';
import { ThreadsService } from '../threads/threads.service';
import { ProvidersService } from './providers.service';

export const TERMINAL_REQUEST: RequestStatus[] = ['REJECTED', 'CANCELLED', 'NOT_SERVICEABLE'];
/** Transitions that have their own endpoints and side effects. */
const DEDICATED: RequestStatus[] = ['INSPECTION_SCHEDULED', 'QUOTATION_DRAFT', 'QUOTATION_SENT', 'APPROVED', 'WORK_ORDER_CREATED'];

/** Maintenance requests (SPEC §6.3, §8.7). Owners see only their own; admins run the queue. */
@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly policy: PolicyService,
    private readonly catalog: CatalogService,
    private readonly attachments: AttachmentsService,
    private readonly threads: ThreadsService,
    private readonly providers: ProvidersService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async findVisible(actor: Actor, id: string, db: Db = this.prisma): Promise<ServiceRequest> {
    const r = await db.serviceRequest.findUnique({ where: { id } });
    if (!r) throw notFound();
    if (actor.kind === 'SYSTEM' || isAdmin(actor)) return r;
    if (actor.role === 'OWNER' && r.ownerUserId === actor.userId) return r;
    throw notFound();
  }

  async lock(tx: Tx, id: string): Promise<ServiceRequest> {
    await tx.$queryRaw`SELECT id FROM service_requests WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.serviceRequest.findUniqueOrThrow({ where: { id } });
  }

  /** Validated, recorded status change used by every maintenance service. */
  async move(tx: Tx, r: ServiceRequest, to: RequestStatus, actor: Actor, reason?: string | null, data: Prisma.ServiceRequestUpdateInput = {}) {
    await this.records.transition(tx, serviceRequestMachine, { entityId: r.id, from: r.status, to, actor, reason });
    const closed = TERMINAL_REQUEST.includes(to);
    const res = await tx.serviceRequest.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: to, ...(closed ? { closedAt: this.clock.now() } : {}), ...(data as Prisma.ServiceRequestUpdateManyMutationInput) },
    });
    if (res.count !== 1) throw new AppError('INVALID_STATE_TRANSITION');
    if (closed) {
      await tx.paymentRequirement.updateMany({ where: { requestId: r.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await this.records.emit(tx, 'request.closed', { requestId: r.id, reference: r.reference, ownerUserId: r.ownerUserId, status: to });
    }
  }

  // --- create (REQ-01) ---------------------------------------------------------------------------------
  async create(actor: UserActor, input: z.infer<typeof serviceRequestCreateSchema>) {
    const admin = isAdmin(actor);
    const property = await this.prisma.property.findUnique({ where: { id: input.propertyId } });
    if (!property || (!admin && property.ownerUserId !== actor.userId)) throw notFound();
    if (property.status !== 'ACTIVE') throw validation({ path: 'propertyId', code: 'PROPERTY_ARCHIVED' });
    if (!modeIncludesCare(property.serviceMode)) throw validation({ path: 'propertyId', code: 'MODE_EXCLUDES_CARE' });
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: property.ownerUserId } });
    if (!admin && !owner.phoneVerifiedAt) throw forbidden('PHONE_NOT_VERIFIED');
    const category = await this.prisma.serviceCategory.findFirst({ where: { id: input.categoryId, isActive: true } });
    if (!category) throw validation({ path: 'categoryId', code: 'UNKNOWN_CATEGORY' });

    const area = await this.catalog.serviceAreaFor(property.pinCode, category.id);
    if (!area) {
      if (!admin || !input.overrideReason) throw new AppError('OUT_OF_SERVICE_AREA');
    }
    const intake = this.catalog.intakeOf(category);
    const checked = validateIntakeAnswers(intake, input.intakeAnswers);
    if (!checked.ok) throw validation(...checked.errors.map((e) => ({ path: `intakeAnswers.${e.field}`, code: e.code })));
    // Danger rules are deterministic and evaluated on the server (SPEC §7 rule 8).
    const danger = evaluateDangerRules(intake, checked.cleaned);
    const urgency: Urgency = danger.safetyFlag ? maxUrgency(input.urgency, 'SAFETY_RISK') : input.urgency;
    if (category.inspectionUsuallyRequired && !admin && input.inspectionFeeAcknowledged !== true) {
      throw validation({ path: 'inspectionFeeAcknowledged', code: 'ACKNOWLEDGEMENT_REQUIRED' });
    }
    const maxFiles = await this.policy.get('uploads.max_files_per_request');
    if (input.attachmentIds.length > maxFiles) throw validation({ path: 'attachmentIds', code: 'TOO_MANY_FILES' });
    if (input.accessContactId) {
      const contact = await this.prisma.propertyContact.findFirst({ where: { id: input.accessContactId, propertyId: property.id, deletedAt: null } });
      if (!contact) throw validation({ path: 'accessContactId', code: 'UNKNOWN_CONTACT' });
    }

    const id = await this.prisma.tx(async (tx) => {
      const r = await tx.serviceRequest.create({
        data: {
          reference: await this.records.nextReference(tx, 'REQ'),
          ownerUserId: property.ownerUserId,
          propertyId: property.id,
          categoryId: category.id,
          title: input.title,
          description: input.description,
          intakeAnswers: checked.cleaned as Prisma.InputJsonValue,
          urgency,
          safetyFlag: danger.safetyFlag,
          safetyGuidanceKeys: danger.guidanceKeys,
          status: 'SUBMITTED',
          preferredWindows: input.preferredWindows as Prisma.InputJsonValue,
          accessContactId: input.accessContactId ?? null,
          createdOnBehalfBy: admin ? actor.userId : null,
          source: admin ? 'ADMIN' : 'OWNER',
          overrideReason: area ? null : (input.overrideReason ?? null),
          submittedAt: this.clock.now(),
        },
      });
      await this.records.transition(tx, serviceRequestMachine, { entityId: r.id, from: null, to: 'SUBMITTED', actor });
      await this.attachments.link(tx, actor, input.attachmentIds, 'REQUEST', r.id);
      await this.records.audit(tx, actor, {
        action: 'request.submitted',
        entityType: 'SERVICE_REQUEST',
        entityId: r.id,
        onBehalfOf: admin ? { type: 'OWNER', id: property.ownerUserId } : null,
        metadata: { categoryId: category.id, urgency, safetyFlag: danger.safetyFlag, serviceAreaOverride: !area },
      });
      await this.records.emit(tx, 'request.submitted', {
        requestId: r.id,
        reference: r.reference,
        ownerUserId: r.ownerUserId,
        safetyFlag: r.safetyFlag,
      });
      if (danger.safetyFlag) await this.records.alert(tx, 'SAFETY_FLAGGED_REQUEST', 'SERVICE_REQUEST', r.id, { reference: r.reference });
      return r.id;
    });
    return this.get(actor, id);
  }

  async createSystem(tx: Tx, input: { propertyId: string; categorySlug: string; title: string; description: string; bookingId: string }) {
    const property = await tx.property.findUniqueOrThrow({ where: { id: input.propertyId } });
    const category = await tx.serviceCategory.findFirst({ where: { slug: input.categorySlug, isActive: true } });
    if (!category || !modeIncludesCare(property.serviceMode)) return null;
    const r = await tx.serviceRequest.create({
      data: {
        reference: await this.records.nextReference(tx, 'REQ'),
        ownerUserId: property.ownerUserId,
        propertyId: property.id,
        categoryId: category.id,
        title: input.title,
        description: input.description,
        status: 'SUBMITTED',
        source: 'TURNOVER_AUTO',
        bookingId: input.bookingId,
      },
    });
    await this.records.transition(tx, serviceRequestMachine, { entityId: r.id, from: null, to: 'SUBMITTED', actor: SYSTEM_ACTOR });
    await this.records.emit(tx, 'request.submitted', { requestId: r.id, reference: r.reference, ownerUserId: r.ownerUserId, safetyFlag: false });
    return r;
  }

  // --- reads ---------------------------------------------------------------------------------------------
  private summary(r: ServiceRequest & { property?: { nickname: string; city: string } | null; category?: { name: string } | null }) {
    return {
      id: r.id,
      reference: r.reference,
      title: r.title,
      status: r.status,
      urgency: r.urgency,
      safetyFlag: r.safetyFlag,
      source: r.source,
      propertyId: r.propertyId,
      property: r.property ? { nickname: r.property.nickname, city: r.property.city } : null,
      category: r.category?.name ?? null,
      submittedAt: iso(r.submittedAt),
      createdAt: iso(r.createdAt),
    };
  }

  async listForOwner(actor: UserActor, propertyId: string | undefined, cursor: string | undefined, limit: number) {
    const rows = await this.prisma.serviceRequest.findMany({
      where: { ownerUserId: actor.userId, ...(propertyId ? { propertyId } : {}), ...afterCursor(cursor) },
      include: { property: { select: { nickname: true, city: true } } },
      orderBy: pageOrder,
      take: limit + 1,
    });
    const cats = await this.prisma.serviceCategory.findMany({ where: { id: { in: rows.map((r) => r.categoryId) } }, select: { id: true, name: true } });
    return toPage(rows, limit, (r) => this.summary({ ...r, category: cats.find((c) => c.id === r.categoryId) ?? null }));
  }

  async adminQueue(actor: UserActor, f: { status?: RequestStatus; categoryId?: string; serviceAreaId?: string; urgency?: Urgency; handler?: 'me' | 'unassigned'; safety?: boolean; cursor?: string; limit: number }) {
    let pins: string[] | undefined;
    if (f.serviceAreaId) pins = (await this.prisma.serviceArea.findUnique({ where: { id: f.serviceAreaId } }))?.pinCodes ?? [];
    const where: Prisma.ServiceRequestWhereInput = {
      ...(f.status ? { status: f.status } : { status: { notIn: [...TERMINAL_REQUEST, 'WORK_ORDER_CREATED'] } }),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.urgency ? { urgency: f.urgency } : {}),
      ...(f.safety ? { safetyFlag: true } : {}),
      ...(f.handler === 'me' ? { handledByAdminId: actor.userId } : f.handler === 'unassigned' ? { handledByAdminId: null } : {}),
      ...(pins ? { property: { pinCode: { in: pins } } } : {}),
      ...afterCursor(f.cursor),
    };
    const rows = await this.prisma.serviceRequest.findMany({
      where,
      include: { property: { select: { nickname: true, city: true } } },
      orderBy: [{ safetyFlag: 'desc' }, ...pageOrder],
      take: f.limit + 1,
    });
    const [cats, triage, handlers] = await Promise.all([
      this.prisma.serviceCategory.findMany({ where: { id: { in: rows.map((r) => r.categoryId) } }, select: { id: true, name: true } }),
      this.prisma.aiSuggestion.findMany({
        where: { featureKey: 'request_triage', subjectType: 'SERVICE_REQUEST', subjectId: { in: rows.map((r) => r.id) }, status: { in: ['READY', 'ACCEPTED', 'EDITED'] } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.handledByAdminId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
    ]);
    const now = this.clock.now().getTime();
    return toPage(rows, f.limit, (r) => ({
      ...this.summary({ ...r, category: cats.find((c) => c.id === r.categoryId) ?? null }),
      ageHours: Math.round((now - r.submittedAt.getTime()) / 3_600_000),
      handledBy: handlers.find((h) => h.id === r.handledByAdminId)?.fullName ?? null,
      firstResponseAt: iso(r.firstResponseAt),
      aiSummary: ((triage.find((t) => t.subjectId === r.id)?.output as { summary?: string } | null)?.summary ?? null),
    }));
  }

  async get(actor: UserActor, id: string) {
    const r = await this.findVisible(actor, id);
    const admin = isAdmin(actor);
    const [property, category, events, inspections, attachments, requirements, workOrders, contact] = await Promise.all([
      this.prisma.property.findUniqueOrThrow({ where: { id: r.propertyId } }),
      this.prisma.serviceCategory.findUniqueOrThrow({ where: { id: r.categoryId } }),
      this.prisma.statusEvent.findMany({
        where: { entityType: 'SERVICE_REQUEST', entityId: id, ...(admin ? {} : { ownerVisible: true }) },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.inspection.findMany({ where: { requestId: id }, orderBy: { scheduledStart: 'asc' } }),
      this.attachments.listFor('REQUEST', id, { includeInternal: admin }),
      this.prisma.paymentRequirement.findMany({ where: { requestId: id }, include: { payments: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.workOrder.findMany({ where: { requestId: id }, orderBy: { createdAt: 'asc' } }),
      r.accessContactId ? this.prisma.propertyContact.findUnique({ where: { id: r.accessContactId } }) : null,
    ]);
    const providerNames = admin
      ? await this.prisma.serviceProvider.findMany({ where: { id: { in: inspections.map((i) => i.providerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })
      : [];
    return {
      ...this.summary({ ...r, property, category }),
      description: r.description,
      intakeAnswers: r.intakeAnswers,
      intakeSchema: this.catalog.intakeOf(category),
      preferredWindows: r.preferredWindows,
      safetyGuidance: r.safetyGuidanceKeys.map((k) => ({ key: k, text: guidanceMessages[k] ?? null })),
      categoryId: r.categoryId,
      categorySlug: category.slug,
      property: { id: property.id, nickname: property.nickname, city: property.city, locality: property.locality, pinCode: property.pinCode, serviceMode: property.serviceMode },
      accessContact: contact ? { id: contact.id, name: contact.name, relationship: contact.relationship, ...(admin ? { phone: contact.phone } : {}) } : null,
      timeline: events.map((e) => ({ from: e.fromStatus, to: e.toStatus, actorRole: e.actorRole, reason: admin || e.actorRole !== 'ADMIN' ? e.reason : null, at: iso(e.createdAt) })),
      inspections: inspections.map((i) => ({
        id: i.id,
        status: i.status,
        scheduledStart: iso(i.scheduledStart),
        scheduledEnd: iso(i.scheduledEnd),
        feePaise: num(i.feePaise),
        findings: i.findings,
        ...(admin ? { providerId: i.providerId, providerName: providerNames.find((p) => p.id === i.providerId)?.name ?? null } : {}),
      })),
      attachments: attachments.map((a) => this.attachments.receipt(a)),
      paymentRequirements: requirements.map((q) => ({
        id: q.id,
        purpose: q.purpose,
        amountPaise: num(q.amountPaise),
        dueTrigger: q.dueTrigger,
        status: q.status,
        isDue: q.isDue,
        workOrderId: q.workOrderId,
        paidPaise: q.payments.filter((p) => p.status === 'SUCCEEDED').reduce((s, p) => s + num(p.amountPaise), 0),
      })),
      workOrders: workOrders.map((w) => ({ id: w.id, reference: w.reference, kind: w.kind, status: w.status, scheduledStart: iso(w.scheduledStart), scheduledEnd: iso(w.scheduledEnd) })),
      ...(admin
        ? { handledByAdminId: r.handledByAdminId, overrideReason: r.overrideReason, createdOnBehalfBy: r.createdOnBehalfBy, ownerUserId: r.ownerUserId, firstResponseAt: iso(r.firstResponseAt) }
        : {}),
    };
  }

  // --- admin transitions (OPS-01/02) -----------------------------------------------------------------------
  async transition(actor: UserActor, id: string, input: { to: RequestStatus; reason?: string | null; ownerMessage?: string | null }) {
    if (DEDICATED.includes(input.to)) throw new AppError('INVALID_STATE_TRANSITION', [{ code: 'USE_DEDICATED_ACTION' }]);
    if ((input.to === 'REJECTED' || input.to === 'CANCELLED') && !input.reason) throw validation({ path: 'reason', code: 'REQUIRED' });
    if (input.to === 'NEEDS_INFORMATION' && !input.ownerMessage) throw validation({ path: 'ownerMessage', code: 'REQUIRED' });
    if (input.to === 'NOT_SERVICEABLE' && (!input.reason || !input.ownerMessage)) throw validation({ path: 'ownerMessage', code: 'REASON_AND_MESSAGE_REQUIRED' });
    await this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, id);
      if (r.status === 'INSPECTION_SCHEDULED' && input.to === 'UNDER_REVIEW') {
        const open = await tx.inspection.count({ where: { requestId: id, status: 'SCHEDULED' } });
        if (open) throw validation({ code: 'INSPECTION_STILL_SCHEDULED' });
      }
      if (r.status === 'QUOTATION_SENT' && input.to === 'UNDER_REVIEW') throw new AppError('INVALID_STATE_TRANSITION', [{ code: 'WITHDRAW_QUOTE_INSTEAD' }]);
      if (r.status === 'QUOTATION_DRAFT' && input.to === 'UNDER_REVIEW') {
        if (await tx.quote.count({ where: { requestId: id, status: 'DRAFT' } })) throw validation({ code: 'DELETE_DRAFT_FIRST' });
      }
      const first = !r.firstResponseAt && ['UNDER_REVIEW', 'NEEDS_INFORMATION', 'NOT_SERVICEABLE', 'REJECTED'].includes(input.to);
      await this.move(tx, r, input.to, actor, input.reason, {
        ...(input.to === 'UNDER_REVIEW' && !r.handledByAdminId ? { handledByAdminId: actor.userId } : {}),
        ...(first ? { firstResponseAt: this.clock.now() } : {}),
      });
      if (input.ownerMessage) await this.threads.post(tx, actor, 'REQUEST', id, { body: input.ownerMessage });
      await this.records.audit(tx, actor, { action: 'request.transition', entityType: 'SERVICE_REQUEST', entityId: id, metadata: { from: r.status, to: input.to } });
      if (input.to === 'NEEDS_INFORMATION') {
        await this.records.emit(tx, 'request.information_requested', { requestId: id, reference: r.reference, ownerUserId: r.ownerUserId });
      }
    });
    return this.get(actor, id);
  }

  async claim(actor: UserActor, id: string) {
    await this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, id);
      if (r.status === 'SUBMITTED') {
        await this.move(tx, r, 'UNDER_REVIEW', actor, 'CLAIMED', { handledByAdminId: actor.userId, firstResponseAt: r.firstResponseAt ?? this.clock.now() });
      } else {
        await tx.serviceRequest.update({ where: { id }, data: { handledByAdminId: actor.userId } });
      }
      await this.records.audit(tx, actor, { action: 'request.claimed', entityType: 'SERVICE_REQUEST', entityId: id });
    });
    return this.get(actor, id);
  }

  /** Messages; an owner reply to a clarification returns the request to review (SPEC §8.7 OPS-02). */
  async postMessage(actor: UserActor, id: string, input: { body: string; visibility: 'PARTICIPANT' | 'INTERNAL'; attachmentIds: string[] }) {
    await this.prisma.tx(async (tx) => {
      const r = await this.findVisible(actor, id, tx);
      await this.threads.post(tx, actor, 'REQUEST', id, input);
      if (actor.role === 'OWNER' && r.status === 'NEEDS_INFORMATION') {
        const locked = await this.lock(tx, id);
        await this.move(tx, locked, 'UNDER_REVIEW', actor, 'OWNER_REPLIED');
        await this.records.emit(tx, 'request.owner_replied', { requestId: id, reference: r.reference, handledByAdminId: r.handledByAdminId });
      }
      if (isAdmin(actor) && input.visibility === 'PARTICIPANT' && !r.firstResponseAt) {
        await tx.serviceRequest.update({ where: { id }, data: { firstResponseAt: this.clock.now() } });
      }
    });
    return this.threads.list(actor, 'REQUEST', id);
  }

  async cancel(actor: UserActor, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      await this.findVisible(actor, id, tx);
      const r = await this.lock(tx, id);
      await this.move(tx, r, 'CANCELLED', actor, reason);
      await this.records.audit(tx, actor, { action: 'request.cancelled', entityType: 'SERVICE_REQUEST', entityId: id, metadata: { reason } });
    });
    return this.get(actor, id);
  }

  // --- inspections ------------------------------------------------------------------------------------------
  async scheduleInspection(actor: UserActor, id: string, input: z.infer<typeof inspectionCreateSchema>) {
    await this.prisma.tx(async (tx) => {
      const r = await this.lock(tx, id);
      if (input.providerId) {
        const elig = await this.providers.eligibility(tx, input.providerId, r.categoryId, r.propertyId);
        if (!elig.eligible) throw validation(...elig.failures.map((f) => ({ path: 'providerId', code: f })));
      }
      await this.move(tx, r, 'INSPECTION_SCHEDULED', actor, null, { handledByAdminId: r.handledByAdminId ?? actor.userId });
      const inspection = await tx.inspection.create({
        data: {
          requestId: id,
          scheduledStart: new Date(input.scheduledStart),
          scheduledEnd: new Date(input.scheduledEnd),
          providerId: input.providerId ?? null,
          feePaise: BigInt(input.feePaise),
          createdBy: actor.userId,
        },
      });
      await this.records.transition(tx, inspectionMachine, { entityId: inspection.id, from: null, to: 'SCHEDULED', actor });
      if (input.feePaise > 0) {
        await tx.paymentRequirement.create({
          data: { requestId: id, purpose: 'INSPECTION_FEE', amountPaise: BigInt(input.feePaise), dueTrigger: 'ON_INSPECTION_SCHEDULED', isDue: true },
        });
      }
      await this.records.audit(tx, actor, { action: 'inspection.scheduled', entityType: 'INSPECTION', entityId: inspection.id, metadata: { requestId: id, providerId: input.providerId ?? null } });
      await this.records.emit(tx, 'request.inspection_scheduled', { requestId: id, reference: r.reference, ownerUserId: r.ownerUserId });
    });
    return this.get(actor, id);
  }

  async updateInspection(actor: UserActor, inspectionId: string, input: z.infer<typeof inspectionUpdateSchema>) {
    const requestId = await this.prisma.tx(async (tx) => {
      const i = await tx.inspection.findUnique({ where: { id: inspectionId } });
      if (!i) throw notFound();
      const r = await this.lock(tx, i.requestId);
      const data: Prisma.InspectionUpdateInput = {};
      if (input.findings !== undefined) data.findings = input.findings;
      if (input.scheduledStart || input.scheduledEnd || input.providerId !== undefined) {
        if (i.status !== 'SCHEDULED') throw new AppError('INVALID_STATE_TRANSITION');
        if (input.scheduledStart) data.scheduledStart = new Date(input.scheduledStart);
        if (input.scheduledEnd) data.scheduledEnd = new Date(input.scheduledEnd);
        if (input.providerId !== undefined) data.providerId = input.providerId;
        await this.records.emit(tx, 'request.inspection_scheduled', { requestId: r.id, reference: r.reference, ownerUserId: r.ownerUserId, rescheduled: true });
      }
      if (input.status) {
        await this.records.transition(tx, inspectionMachine, { entityId: i.id, from: i.status, to: input.status, actor });
        data.status = input.status;
        if (input.status === 'NO_ACCESS') {
          const fee = await this.policy.get('cancellation.no_access_fee_paise');
          if (fee > 0) await tx.paymentRequirement.create({ data: { requestId: r.id, purpose: 'INSPECTION_FEE', amountPaise: BigInt(fee), dueTrigger: 'MANUAL', isDue: true } });
        }
      }
      await tx.inspection.update({ where: { id: i.id }, data });
      if (input.status) {
        const stillOpen = await tx.inspection.count({ where: { requestId: r.id, status: 'SCHEDULED' } });
        if (!stillOpen && r.status === 'INSPECTION_SCHEDULED') await this.move(tx, r, 'UNDER_REVIEW', actor, `INSPECTION_${input.status}`);
      }
      await this.records.audit(tx, actor, { action: 'inspection.updated', entityType: 'INSPECTION', entityId: i.id, metadata: { fields: Object.keys(input) } });
      return r.id;
    });
    return this.get(actor, requestId);
  }
}
