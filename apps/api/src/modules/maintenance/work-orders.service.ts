import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WorkOrder, WorkOrderStatus } from '@prisma/client';
import {
  addDays,
  assignmentCreateSchema,
  checklistResultsSchema,
  dateToIso,
  eachNight,
  evidenceCreateSchema,
  istDateOf,
  missingChecklistItems,
  missingEvidence,
  reportBlockedSchema,
  submitForReviewSchema,
  visitCreateSchema,
  workOrderMachine,
  type IsoDate,
} from '@propcare/shared';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../core/clock';
import { FIELD_CIPHER, type FieldCipher } from '../../core/crypto';
import { hasFlag, isAdmin, SYSTEM_ACTOR, type Actor, type UserActor } from '../../core/context';
import { AppError, forbidden, notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService, type Db, type Tx } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { afterCursor, iso, num, pageOrder, toPage } from '../../core/serialize';
import { AttachmentsService } from '../attachments/attachments.service';
import { CatalogService } from '../catalog/catalog.service';
import { OccupancyService } from '../listings/occupancy.service';
import { ThreadsService } from '../threads/threads.service';
import { ProvidersService } from './providers.service';
import { RequestsService } from './requests.service';

const OPEN_ISSUE = { in: ['OPEN', 'IN_PROGRESS'] as Array<'OPEN' | 'IN_PROGRESS'> };

/**
 * Work orders run by admins (SPEC §6.5, §8.8). Every provider-side step is recorded by an admin
 * on the provider's behalf and audited as such (SPEC §7 rule 21).
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly policy: PolicyService,
    private readonly catalog: CatalogService,
    private readonly requests: RequestsService,
    private readonly providers: ProvidersService,
    private readonly occupancy: OccupancyService,
    private readonly attachments: AttachmentsService,
    private readonly threads: ThreadsService,
    @Inject(FIELD_CIPHER) private readonly cipher: FieldCipher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async findVisible(actor: Actor, id: string, db: Db = this.prisma): Promise<WorkOrder> {
    const w = await db.workOrder.findUnique({ where: { id } });
    if (!w) throw notFound();
    if (actor.kind === 'SYSTEM' || isAdmin(actor)) return w;
    if (actor.role === 'OWNER' && w.ownerUserId === actor.userId) return w;
    throw notFound();
  }

  private async lock(tx: Tx, id: string): Promise<WorkOrder> {
    await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.workOrder.findUniqueOrThrow({ where: { id } });
  }

  private async move(tx: Tx, w: WorkOrder, to: WorkOrderStatus, actor: Actor, reason?: string | null, data: Prisma.WorkOrderUncheckedUpdateManyInput = {}) {
    await this.records.transition(tx, workOrderMachine, { entityId: w.id, from: w.status, to, actor, reason });
    const res = await tx.workOrder.updateMany({ where: { id: w.id, status: w.status }, data: { status: to, ...data } });
    if (res.count !== 1) throw new AppError('INVALID_STATE_TRANSITION');
    w.status = to;
  }

  private onBehalf(providerId: string) {
    return { type: 'PROVIDER' as const, id: providerId };
  }

  private async assertAssigned(db: Db, workOrderId: string, providerId: string) {
    const a = await db.workAssignment.findFirst({ where: { workOrderId, providerId, status: 'ACTIVE' } });
    if (!a) throw validation({ path: 'providerId', code: 'PROVIDER_NOT_ASSIGNED' });
  }

  // --- create (WO-01) -------------------------------------------------------------------------------
  /** Idempotent: a quote yields at most one work order (unique quote_id). */
  async createFromQuote(actor: UserActor, quoteId: string) {
    const existing = await this.prisma.workOrder.findUnique({ where: { quoteId } });
    if (existing) return this.get(actor, existing.id);
    const id = await this.prisma.tx(async (tx) => {
      const q = await tx.quote.findUnique({ where: { id: quoteId } });
      if (!q || q.quoteType !== 'ORIGINAL') throw notFound();
      if (q.status !== 'APPROVED') throw new AppError('INVALID_STATE_TRANSITION', [{ code: 'QUOTE_NOT_APPROVED' }]);
      const r = await this.requests.lock(tx, q.requestId);
      const again = await tx.workOrder.findUnique({ where: { quoteId } });
      if (again) return again.id;
      const template = await this.catalog.activeChecklist(r.categoryId, tx);
      const w = await tx.workOrder.create({
        data: {
          reference: await this.records.nextReference(tx, 'WO'),
          requestId: r.id,
          propertyId: r.propertyId,
          ownerUserId: r.ownerUserId,
          quoteId,
          approvedTotalPaise: q.totalPaise,
          checklistTemplateId: template?.id ?? null,
          checklistVersion: template?.version ?? null,
          createdBy: actor.userId,
        },
      });
      await this.records.transition(tx, workOrderMachine, { entityId: w.id, from: null, to: 'DRAFT', actor });
      await this.requests.move(tx, r, 'WORK_ORDER_CREATED', actor);
      await tx.paymentRequirement.updateMany({ where: { requestId: r.id, workOrderId: null, purpose: { in: ['DEPOSIT', 'FINAL', 'MILESTONE'] } }, data: { workOrderId: w.id } });
      await this.records.audit(tx, actor, { action: 'work_order.created', entityType: 'WORK_ORDER', entityId: w.id, metadata: { quoteId, requestId: r.id } });
      return w.id;
    });
    return this.get(actor, id);
  }

  /** Child rework order for a completed job (zero price, no quote) (SPEC §6.5). */
  async createRework(tx: Tx, actor: UserActor, issueId: string, parent: WorkOrder) {
    const template = parent.checklistTemplateId ? await tx.checklistTemplate.findUnique({ where: { id: parent.checklistTemplateId } }) : null;
    const w = await tx.workOrder.create({
      data: {
        reference: await this.records.nextReference(tx, 'WO'),
        kind: 'REWORK',
        requestId: parent.requestId,
        propertyId: parent.propertyId,
        ownerUserId: parent.ownerUserId,
        parentWorkOrderId: parent.id,
        issueId,
        approvedTotalPaise: 0n,
        checklistTemplateId: template?.id ?? null,
        checklistVersion: template?.version ?? null,
        createdBy: actor.userId,
      },
    });
    await this.records.transition(tx, workOrderMachine, { entityId: w.id, from: null, to: 'DRAFT', actor });
    await this.records.audit(tx, actor, { action: 'work_order.rework_created', entityType: 'WORK_ORDER', entityId: w.id, metadata: { parentId: parent.id, issueId } });
    return w;
  }

  // --- scheduling with calendar coordination (§7 rule 11) ----------------------------------------------
  /** Nights touched by a work window, in IST. Conservative: the end day's night is included. */
  private windowNights(start: Date, end: Date): { startDate: IsoDate; endDate: IsoDate } {
    const s = istDateOf(start);
    const e = istDateOf(new Date(end.getTime() - 1));
    return { startDate: s, endDate: addDays(e, 1) };
  }

  private async placeMaintenanceBlock(tx: Tx, w: WorkOrder, start: Date, end: Date, actor: Actor) {
    const listing = await tx.listing.findUnique({ where: { propertyId: w.propertyId } });
    if (!listing || listing.status === 'ARCHIVED') return;
    await this.occupancy.lockListing(tx, listing.id);
    await this.occupancy.purgeExpiredHolds(tx, listing.id);
    const range = this.windowNights(start, end);
    const conflicts = (await this.occupancy.conflicts(tx, listing.id, range.startDate, range.endDate)).filter((c) => c.workOrderId !== w.id);
    // A confirmed booking or live hold always wins; there is no override (SPEC §7 rule 11).
    if (conflicts.some((c) => c.kind === 'BOOKING_CONFIRMED' || c.kind === 'BOOKING_HOLD')) throw new AppError('BOOKING_CONFLICT');
    // A guest checking out that morning must be gone before work starts.
    const checkoutSameDay = await tx.booking.findFirst({
      where: { listingId: listing.id, status: { in: ['CONFIRMED', 'AWAITING_PAYMENT'] }, checkOutDate: new Date(`${range.startDate}T00:00:00Z`), checkOutAt: { gt: start } },
    });
    if (checkoutSameDay) throw new AppError('BOOKING_CONFLICT');
    await tx.listingOccupancy.deleteMany({ where: { workOrderId: w.id } });
    // Nights already blocked by the owner/admin stay as they are; block only the free nights.
    const taken = new Set(conflicts.flatMap((c) => eachNight(dateToIso(c.startDate), dateToIso(c.endDate))));
    let runStart: IsoDate | null = null;
    const nights = eachNight(range.startDate, range.endDate);
    for (const [i, n] of nights.entries()) {
      const free = !taken.has(n);
      if (free && runStart === null) runStart = n;
      const last = i === nights.length - 1;
      if (runStart !== null && (!free || last)) {
        const runEnd = free && last ? addDays(n, 1) : n;
        await this.occupancy.insert(tx, {
          listingId: listing.id,
          startDate: runStart,
          endDate: runEnd,
          kind: 'BLOCK_MAINTENANCE',
          workOrderId: w.id,
          startsAt: start,
          endsAt: end,
          createdBy: actor.userId,
          note: 'Maintenance scheduled',
        });
        runStart = null;
      }
    }
  }

  private async releaseBlocks(tx: Tx, workOrderId: string) {
    await tx.listingOccupancy.deleteMany({ where: { workOrderId } });
  }

  async schedule(actor: UserActor, id: string, input: { scheduledStart: string; scheduledEnd: string; reason?: string | null }) {
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      if (!['DRAFT', 'SCHEDULED', 'ASSIGNED'].includes(w.status)) throw new AppError('INVALID_STATE_TRANSITION', [{ code: `WORK_ORDER_${w.status}` }]);
      const reschedule = w.status !== 'DRAFT';
      if (reschedule && !input.reason) throw validation({ path: 'reason', code: 'RESCHEDULE_REASON_REQUIRED' });
      if (await this.policy.get('verification.require_for_care')) {
        const p = await tx.property.findUniqueOrThrow({ where: { id: w.propertyId } });
        if (p.verificationStatus !== 'APPROVED') throw validation({ code: 'PROPERTY_NOT_VERIFIED' });
      }
      const start = new Date(input.scheduledStart);
      const end = new Date(input.scheduledEnd);
      await this.placeMaintenanceBlock(tx, w, start, end, actor);
      if (w.status === 'DRAFT') await this.move(tx, w, 'SCHEDULED', actor, null, { scheduledStart: start, scheduledEnd: end });
      else await tx.workOrder.update({ where: { id }, data: { scheduledStart: start, scheduledEnd: end } });
      if (w.status === 'SCHEDULED' && (await tx.workAssignment.count({ where: { workOrderId: id, status: 'ACTIVE' } }))) {
        await this.move(tx, w, 'ASSIGNED', actor, 'ASSIGNMENT_EXISTS');
      }
      await tx.paymentRequirement.updateMany({ where: { workOrderId: id, dueTrigger: 'ON_WORK_SCHEDULED', status: 'PENDING' }, data: { isDue: true } });
      await this.records.audit(tx, actor, {
        action: reschedule ? 'work_order.rescheduled' : 'work_order.scheduled',
        entityType: 'WORK_ORDER',
        entityId: id,
        metadata: { start: start.toISOString(), end: end.toISOString(), reason: input.reason ?? null },
      });
      await this.records.emit(tx, reschedule ? 'work.rescheduled' : 'work.scheduled', { workOrderId: id, requestId: w.requestId, reference: w.reference, ownerUserId: w.ownerUserId });
    });
    return this.get(actor, id);
  }

  // --- assignment (§7 rule 7) ----------------------------------------------------------------------------
  async assign(actor: UserActor, id: string, input: z.infer<typeof assignmentCreateSchema>) {
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      if (['COMPLETED', 'CANCELLED', 'READY_FOR_OWNER_REVIEW', 'SUBMITTED_FOR_REVIEW'].includes(w.status)) throw new AppError('INVALID_STATE_TRANSITION');
      const request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: w.requestId } });
      const elig = await this.providers.eligibility(tx, input.providerId, request.categoryId, w.propertyId);
      if (!elig.eligible) {
        if (!hasFlag(actor, 'ASSIGNMENT_OVERRIDE') || !input.overrideReason) {
          throw new AppError('VALIDATION_FAILED', [...elig.failures.map((f) => ({ path: 'providerId', code: f as string })), { path: 'overrideReason', code: 'ASSIGNMENT_OVERRIDE_REQUIRED' }]);
        }
      }
      const a = await tx.workAssignment.create({
        data: {
          workOrderId: id,
          providerId: input.providerId,
          assignmentRole: input.assignmentRole,
          assignedBy: actor.userId,
          overrideReason: elig.eligible ? null : input.overrideReason,
          internalNotes: input.internalNotes ?? null,
        },
      });
      if (w.status === 'SCHEDULED') await this.move(tx, w, 'ASSIGNED', actor);
      await this.records.audit(tx, actor, {
        action: elig.eligible ? 'work_order.assigned' : 'work_order.assigned_with_override',
        entityType: 'WORK_ORDER',
        entityId: id,
        metadata: { assignmentId: a.id, providerId: input.providerId, failures: elig.failures, overrideReason: elig.eligible ? null : input.overrideReason },
      });
    });
    return this.get(actor, id);
  }

  async unassign(actor: UserActor, id: string, assignmentId: string) {
    const res = await this.prisma.workAssignment.updateMany({ where: { id: assignmentId, workOrderId: id, status: 'ACTIVE' }, data: { status: 'REMOVED' } });
    if (!res.count) throw notFound();
    await this.records.audit(this.prisma, actor, { action: 'work_order.unassigned', entityType: 'WORK_ORDER', entityId: id, metadata: { assignmentId } });
    return this.get(actor, id);
  }

  // --- execution recorded on behalf of providers (EXE-01, EVD-01) -----------------------------------------
  async recordVisit(actor: UserActor, id: string, input: z.infer<typeof visitCreateSchema>) {
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      await this.assertAssigned(tx, id, input.providerId);
      if (!['ASSIGNED', 'IN_PROGRESS', 'REWORK_REQUIRED', 'BLOCKED'].includes(w.status)) throw new AppError('INVALID_STATE_TRANSITION');
      const visit = await tx.workVisit.create({
        data: {
          workOrderId: id,
          providerId: input.providerId,
          recordedBy: actor.userId,
          source: input.source,
          checkedInAt: new Date(input.checkedInAt),
          checkedOutAt: input.checkedOutAt ? new Date(input.checkedOutAt) : null,
          note: input.note ?? null,
        },
      });
      if (w.status === 'ASSIGNED' || w.status === 'REWORK_REQUIRED') {
        // Any requirement due before start must be settled first (SPEC §6.5).
        const unpaid = await tx.paymentRequirement.count({ where: { workOrderId: id, status: 'PENDING', isDue: true, dueTrigger: { in: ['ON_QUOTE_APPROVAL', 'ON_WORK_SCHEDULED'] } } });
        if (unpaid) throw validation({ code: 'PAYMENT_DUE_BEFORE_START' });
        const first = w.status === 'ASSIGNED';
        await this.move(tx, w, 'IN_PROGRESS', actor, first ? 'PROVIDER_STARTED' : 'REWORK_STARTED', first ? { startedAt: new Date(input.checkedInAt) } : {});
        await this.records.emit(tx, 'work.started', { workOrderId: id, requestId: w.requestId, reference: w.reference, ownerUserId: w.ownerUserId });
      }
      await this.records.audit(tx, actor, {
        action: 'work_order.visit_recorded',
        entityType: 'WORK_ORDER',
        entityId: id,
        onBehalfOf: this.onBehalf(input.providerId),
        metadata: { visitId: visit.id, source: input.source },
      });
    });
    return this.get(actor, id);
  }

  async recordChecklist(actor: UserActor, id: string, input: z.infer<typeof checklistResultsSchema>) {
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      await this.assertAssigned(tx, id, input.providerId);
      if (!['IN_PROGRESS', 'BLOCKED', 'REWORK_REQUIRED'].includes(w.status)) throw new AppError('INVALID_STATE_TRANSITION');
      const template = w.checklistTemplateId ? await tx.checklistTemplate.findUnique({ where: { id: w.checklistTemplateId } }) : null;
      const items = template ? this.catalog.parseChecklist(template.items).items : [];
      for (const r of input.results) {
        const item = items.find((i) => i.key === r.itemKey);
        if (!item) throw validation({ path: 'results', code: `UNKNOWN_ITEM:${r.itemKey}` });
        const prev = await tx.workChecklistResult.findFirst({ where: { workOrderId: id, itemKey: r.itemKey }, orderBy: { completedAt: 'desc' } });
        await tx.workChecklistResult.create({
          data: {
            workOrderId: id,
            templateVersion: w.checklistVersion ?? 0,
            itemKey: r.itemKey,
            result: (r.result ?? null) as Prisma.InputJsonValue,
            notes: r.notes ?? null,
            recordedBy: actor.userId,
            providerId: input.providerId,
          },
        });
        if (prev) {
          // Results are never silently overwritten (SPEC §8.8).
          await this.records.audit(tx, actor, { action: 'work_order.checklist_result_replaced', entityType: 'WORK_ORDER', entityId: id, onBehalfOf: this.onBehalf(input.providerId), metadata: { itemKey: r.itemKey } });
        }
      }
      await this.records.audit(tx, actor, {
        action: 'work_order.checklist_recorded',
        entityType: 'WORK_ORDER',
        entityId: id,
        onBehalfOf: this.onBehalf(input.providerId),
        metadata: { items: input.results.map((r) => r.itemKey), source: input.source },
      });
    });
    return this.get(actor, id);
  }

  async recordEvidence(actor: UserActor, id: string, input: z.infer<typeof evidenceCreateSchema>) {
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      await this.assertAssigned(tx, id, input.providerId);
      if (['COMPLETED', 'CANCELLED', 'DRAFT'].includes(w.status)) throw new AppError('INVALID_STATE_TRANSITION');
      await this.attachments.link(tx, actor, input.attachmentIds, 'WORK_ORDER', id, {
        evidencePhase: input.phase,
        source: 'ADMIN_UPLOAD_FOR_PROVIDER',
        recordedForProviderId: input.providerId,
        capturedAt: new Date(input.capturedAt),
        visibility: 'PARTICIPANT',
      });
      await this.records.audit(tx, actor, {
        action: 'work_order.evidence_recorded',
        entityType: 'WORK_ORDER',
        entityId: id,
        onBehalfOf: this.onBehalf(input.providerId),
        metadata: { attachmentIds: input.attachmentIds, phase: input.phase, source: input.source },
      });
      if (await this.policy.get('notifications.progress_milestone_enabled')) {
        await this.records.emit(tx, 'work.progress', { workOrderId: id, requestId: w.requestId, reference: w.reference, ownerUserId: w.ownerUserId });
      }
    });
    return this.get(actor, id);
  }

  async reportBlocked(actor: UserActor, id: string, input: z.infer<typeof reportBlockedSchema>) {
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      await this.move(tx, w, 'BLOCKED', actor, input.reason, { blockedReason: input.reason });
      await this.threads.post(tx, actor, 'WORK_ORDER', id, { body: `Blocked (${input.reason}): ${input.note}`, visibility: 'INTERNAL' });
      await this.records.audit(tx, actor, { action: 'work_order.blocked', entityType: 'WORK_ORDER', entityId: id, onBehalfOf: this.onBehalf(input.providerId), metadata: { reason: input.reason, source: input.source } });
      await this.records.emit(tx, 'admin.work_order_blocked', { workOrderId: id, reference: w.reference });
    });
    return this.get(actor, id);
  }

  /** Mandatory checklist items and evidence minimums (SPEC §7 rule 9). */
  async completenessProblems(db: Db, w: WorkOrder) {
    const request = await db.serviceRequest.findUniqueOrThrow({ where: { id: w.requestId } });
    const category = await db.serviceCategory.findUniqueOrThrow({ where: { id: request.categoryId } });
    const template = w.checklistTemplateId ? await db.checklistTemplate.findUnique({ where: { id: w.checklistTemplateId } }) : null;
    const results = await db.workChecklistResult.findMany({ where: { workOrderId: w.id }, orderBy: { completedAt: 'asc' } });
    const missingItems = template ? missingChecklistItems(this.catalog.parseChecklist(template.items), results) : [];
    const counts = await db.attachment.groupBy({ by: ['evidencePhase'], where: { ownerType: 'WORK_ORDER', ownerId: w.id, status: 'AVAILABLE' }, _count: true });
    const byPhase = Object.fromEntries(counts.map((c) => [c.evidencePhase, c._count]));
    const missingMedia = missingEvidence(this.catalog.evidenceOf(category), byPhase);
    return { missingItems, missingMedia };
  }

  async submitForReview(actor: UserActor, id: string, input: z.infer<typeof submitForReviewSchema>) {
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      await this.assertAssigned(tx, id, input.providerId);
      const { missingItems, missingMedia } = await this.completenessProblems(tx, w);
      if (missingItems.length || missingMedia.length) {
        throw validation(
          ...missingItems.map((k) => ({ path: 'checklist', code: `MISSING_ITEM:${k}` })),
          ...missingMedia.map((m) => ({ path: 'evidence', code: `MISSING_${m.phase}`, message: `${m.present}/${m.required}` })),
        );
      }
      await this.move(tx, w, 'SUBMITTED_FOR_REVIEW', actor, null, { submittedAt: this.clock.now(), submittedBy: actor.userId });
      if (input.note) await this.threads.post(tx, actor, 'WORK_ORDER', id, { body: input.note, visibility: 'INTERNAL' });
      await this.records.audit(tx, actor, { action: 'work_order.submitted_for_review', entityType: 'WORK_ORDER', entityId: id, onBehalfOf: this.onBehalf(input.providerId), metadata: { source: input.source } });
    });
    return this.get(actor, id);
  }

  /** Internal completion approval (REV-01); requires COMPLETION_APPROVE at the controller. */
  async approveCompletion(actor: UserActor, id: string, overrideReason?: string | null) {
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      if ((await this.policy.get('work.require_different_admin')) && w.submittedBy === actor.userId) {
        throw forbidden('DIFFERENT_ADMIN_REQUIRED');
      }
      const { missingItems, missingMedia } = await this.completenessProblems(tx, w);
      const incomplete = missingItems.length > 0 || missingMedia.length > 0;
      if (incomplete && !overrideReason) throw validation({ path: 'overrideReason', code: 'COMPLETION_OVERRIDE_REQUIRED' });
      const hours = await this.policy.get('work.owner_review_window_hours');
      await this.move(tx, w, 'READY_FOR_OWNER_REVIEW', actor, incomplete ? overrideReason : null, {
        ownerReviewDueAt: new Date(this.clock.now().getTime() + hours * 3_600_000),
        completionOverride: incomplete ? overrideReason : null,
      });
      await this.records.audit(tx, actor, {
        action: incomplete ? 'work_order.completion_approved_with_override' : 'work_order.completion_approved',
        entityType: 'WORK_ORDER',
        entityId: id,
        metadata: { missingItems, missingMedia, overrideReason: overrideReason ?? null },
      });
      await this.records.emit(tx, 'work.ready_for_owner_review', { workOrderId: id, requestId: w.requestId, reference: w.reference, ownerUserId: w.ownerUserId });
    });
    return this.get(actor, id);
  }

  async requestRework(actor: UserActor, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      await this.move(tx, w, 'REWORK_REQUIRED', actor, reason);
      await this.records.audit(tx, actor, { action: 'work_order.rework_requested', entityType: 'WORK_ORDER', entityId: id, metadata: { reason } });
    });
    return this.get(actor, id);
  }

  /** Generic admin transitions not covered by a dedicated action (resume, cancel). */
  async transition(actor: UserActor, id: string, to: WorkOrderStatus, reason?: string | null) {
    if (!['IN_PROGRESS', 'CANCELLED'].includes(to)) throw new AppError('INVALID_STATE_TRANSITION', [{ code: 'USE_DEDICATED_ACTION' }]);
    if (to === 'CANCELLED') return this.cancel(actor, id, reason ?? '');
    await this.prisma.tx(async (tx) => {
      const w = await this.lock(tx, id);
      if (w.status === 'BLOCKED' && (w.blockedReason === 'SCOPE_CHANGE' || w.blockedReason === 'HIDDEN_DAMAGE')) {
        const pending = await tx.quote.count({ where: { workOrderId: id, quoteType: 'CHANGE_ORDER', status: { in: ['DRAFT', 'SENT'] } } });
        const approved = await tx.quote.count({ where: { workOrderId: id, quoteType: 'CHANGE_ORDER', status: 'APPROVED' } });
        if (pending || !approved) throw validation({ code: 'CHANGE_ORDER_APPROVAL_REQUIRED' });
      }
      await this.move(tx, w, 'IN_PROGRESS', actor, reason, { blockedReason: null });
      await this.records.audit(tx, actor, { action: 'work_order.resumed', entityType: 'WORK_ORDER', entityId: id });
    });
    return this.get(actor, id);
  }

  async cancel(actor: UserActor, id: string, reason: string) {
    if (!reason) throw validation({ path: 'reason', code: 'REQUIRED' });
    await this.prisma.tx(async (tx) => {
      await this.findVisible(actor, id, tx);
      const w = await this.lock(tx, id);
      await this.move(tx, w, 'CANCELLED', actor, reason);
      await this.releaseBlocks(tx, id);
      await tx.paymentRequirement.updateMany({ where: { workOrderId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      if (w.kind === 'STANDARD') {
        const r = await this.requests.lock(tx, w.requestId);
        if (r.status === 'WORK_ORDER_CREATED') await this.requests.move(tx, r, 'CANCELLED', SYSTEM_ACTOR, 'WORK_ORDER_CANCELLED');
      }
      await this.records.audit(tx, actor, { action: 'work_order.cancelled', entityType: 'WORK_ORDER', entityId: id, metadata: { reason } });
      await this.records.emit(tx, 'work.cancelled', { workOrderId: id, requestId: w.requestId, reference: w.reference, ownerUserId: w.ownerUserId });
    });
    return this.get(actor, id);
  }

  private async complete(tx: Tx, w: WorkOrder, actor: Actor, reason: string | null) {
    await this.move(tx, w, 'COMPLETED', actor, reason, { completedAt: this.clock.now() });
    await this.releaseBlocks(tx, w.id);
    await tx.paymentRequirement.updateMany({ where: { workOrderId: w.id, dueTrigger: 'ON_COMPLETION_ACCEPTED', status: 'PENDING' }, data: { isDue: true } });
    if (w.kind === 'STANDARD') {
      const ref = await this.records.nextReference(tx, 'INV');
      await tx.invoice.create({
        data: {
          reference: ref,
          kind: 'MAINTENANCE_FINAL',
          requestId: w.requestId,
          workOrderId: w.id,
          ownerUserId: w.ownerUserId,
          recipientUserId: w.ownerUserId,
          invoiceNumber: ref,
          amountPaise: w.approvedTotalPaise,
          lines: [{ label: `Work ${w.reference}`, amountPaise: num(w.approvedTotalPaise) }] as unknown as Prisma.InputJsonValue,
          taxMetadata: { status: 'PLACEHOLDER' },
        },
      });
    }
    await this.records.emit(tx, 'work.completed', { workOrderId: w.id, requestId: w.requestId, reference: w.reference, ownerUserId: w.ownerUserId });
  }

  /** Owner acceptance; an admin can never accept for an owner. */
  async accept(actor: UserActor, id: string) {
    await this.prisma.tx(async (tx) => {
      const pre = await this.findVisible(actor, id, tx);
      if (actor.role !== 'OWNER' || pre.ownerUserId !== actor.userId) throw notFound();
      const w = await this.lock(tx, id);
      await this.complete(tx, w, actor, 'OWNER_ACCEPTED');
      await this.records.audit(tx, actor, { action: 'work_order.accepted', entityType: 'WORK_ORDER', entityId: id });
    });
    return this.get(actor, id);
  }

  /** Scheduled: auto-complete after the review window when no issue is open. */
  async autoComplete(): Promise<number> {
    const due = await this.prisma.workOrder.findMany({ where: { status: 'READY_FOR_OWNER_REVIEW', ownerReviewDueAt: { lte: this.clock.now() } }, take: 100 });
    let done = 0;
    for (const d of due) {
      await this.prisma.tx(async (tx) => {
        const w = await this.lock(tx, d.id);
        if (w.status !== 'READY_FOR_OWNER_REVIEW') return;
        const open = await tx.issue.count({ where: { subjectType: 'WORK_ORDER', subjectId: w.id, status: OPEN_ISSUE } });
        if (open) return;
        await this.complete(tx, w, SYSTEM_ACTOR, 'REVIEW_WINDOW_LAPSED');
        done++;
      });
    }
    return done;
  }

  async safetyMitigation(actor: UserActor, id: string, note: string) {
    if (!(await this.policy.get('safety.immediate_mitigation_allowed'))) throw forbidden('MITIGATION_DISABLED_BY_POLICY');
    const w = await this.findVisible(actor, id);
    await this.prisma.tx(async (tx) => {
      // Recorded and notified only; no automatic pricing (SPEC §7 rule 5).
      await this.records.audit(tx, actor, { action: 'SAFETY_MITIGATION_AUTHORISED', entityType: 'WORK_ORDER', entityId: id, metadata: { note } });
      await this.records.emit(tx, 'work.safety_mitigation', { workOrderId: id, requestId: w.requestId, reference: w.reference, ownerUserId: w.ownerUserId });
    });
    return { ok: true };
  }

  /** Printable job sheet for a provider: no prices, owner phone numbers or internal notes (P1). */
  async jobSheet(actor: UserActor, id: string) {
    const w = await this.findVisible(actor, id);
    const [request, property, quote, template] = await Promise.all([
      this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: w.requestId } }),
      this.prisma.property.findUniqueOrThrow({ where: { id: w.propertyId } }),
      w.quoteId ? this.prisma.quote.findUnique({ where: { id: w.quoteId }, include: { lineItems: true } }) : null,
      w.checklistTemplateId ? this.prisma.checklistTemplate.findUnique({ where: { id: w.checklistTemplateId } }) : null,
    ]);
    await this.records.audit(this.prisma, actor, { action: 'work_order.job_sheet_generated', entityType: 'WORK_ORDER', entityId: id });
    return {
      watermark: `${w.reference} · generated ${this.clock.now().toISOString()} · for provider use only`,
      reference: w.reference,
      title: request.title,
      scope: quote?.scope ?? request.description,
      tasks: (quote?.lineItems ?? []).filter((l) => l.direction === 'ADD').sort((a, b) => a.position - b.position).map((l) => `${l.description} (${l.quantity.toFixed(3)} ${l.unit})`),
      address: [property.addressLine1, property.addressLine2, property.locality, property.city, property.state, property.pinCode].filter(Boolean).join(', '),
      accessNotes: this.cipher.decrypt(property.accessNotes),
      checklist: template ? this.catalog.parseChecklist(template.items).items.map((i) => ({ label: i.label, required: i.required })) : [],
      schedule: { start: iso(w.scheduledStart), end: iso(w.scheduledEnd) },
      safetyNotes: (await this.prisma.serviceCategory.findUniqueOrThrow({ where: { id: request.categoryId } })).safetyNotes,
    };
  }

  // --- reads -----------------------------------------------------------------------------------------
  async get(actor: UserActor, id: string) {
    const w = await this.findVisible(actor, id);
    const admin = isAdmin(actor);
    const [assignments, visits, results, evidence, changeOrders, issues, events, template, requirements, request] = await Promise.all([
      this.prisma.workAssignment.findMany({ where: { workOrderId: id }, include: { provider: { select: { id: true, name: true, providerType: true } } }, orderBy: { assignedAt: 'asc' } }),
      this.prisma.workVisit.findMany({ where: { workOrderId: id }, orderBy: { checkedInAt: 'asc' } }),
      this.prisma.workChecklistResult.findMany({ where: { workOrderId: id }, orderBy: { completedAt: 'asc' } }),
      this.attachments.listFor('WORK_ORDER', id, { includeInternal: admin }),
      this.prisma.quote.findMany({ where: { workOrderId: id, quoteType: 'CHANGE_ORDER', ...(admin ? {} : { status: { not: 'DRAFT' } }) }, select: { id: true, reference: true, version: true, status: true, totalPaise: true } }),
      this.prisma.issue.findMany({ where: { subjectType: 'WORK_ORDER', subjectId: id }, select: { id: true, reference: true, status: true, category: true, createdAt: true } }),
      this.prisma.statusEvent.findMany({ where: { entityType: 'WORK_ORDER', entityId: id, ...(admin ? {} : { ownerVisible: true }) }, orderBy: { createdAt: 'asc' } }),
      w.checklistTemplateId ? this.prisma.checklistTemplate.findUnique({ where: { id: w.checklistTemplateId } }) : null,
      this.prisma.paymentRequirement.findMany({ where: { workOrderId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: w.requestId }, select: { reference: true, title: true, categoryId: true } }),
    ]);
    const items = template ? this.catalog.parseChecklist(template.items).items : [];
    const latest = new Map(results.map((r) => [r.itemKey, r]));
    const completeness = admin && !['COMPLETED', 'CANCELLED'].includes(w.status) ? await this.completenessProblems(this.prisma, w) : null;
    return {
      id: w.id,
      reference: w.reference,
      kind: w.kind,
      status: w.status,
      requestId: w.requestId,
      request: { reference: request.reference, title: request.title },
      propertyId: w.propertyId,
      quoteId: w.quoteId,
      parentWorkOrderId: w.parentWorkOrderId,
      issueId: w.issueId,
      scheduledStart: iso(w.scheduledStart),
      scheduledEnd: iso(w.scheduledEnd),
      startedAt: iso(w.startedAt),
      submittedAt: iso(w.submittedAt),
      completedAt: iso(w.completedAt),
      ownerReviewDueAt: iso(w.ownerReviewDueAt),
      approvedTotalPaise: num(w.approvedTotalPaise),
      blockedReason: w.blockedReason,
      // Owners see a care team, never provider identities (SPEC §1, §2.2).
      careTeam: admin ? null : assignments.some((a) => a.status === 'ACTIVE') ? 'Care team assigned' : 'Care team being arranged',
      visits: visits.map((v) => ({ id: v.id, checkedInAt: iso(v.checkedInAt), checkedOutAt: iso(v.checkedOutAt), ...(admin ? { providerId: v.providerId, note: v.note, source: v.source, recordedBy: v.recordedBy } : {}) })),
      checklist: items.map((i) => {
        const r = latest.get(i.key);
        return { key: i.key, label: i.label, type: i.type, required: i.required, minCount: i.minCount ?? null, result: r?.result ?? null, notes: admin ? (r?.notes ?? null) : null, completedAt: iso(r?.completedAt) };
      }),
      evidence: evidence.map((e) => ({ ...this.attachments.receipt(e), capturedAt: iso(e.capturedAt), uploadedAt: iso(e.createdAt), ...(admin ? { recordedForProviderId: e.recordedForProviderId, source: e.source } : {}) })),
      changeOrders: changeOrders.map((q) => ({ ...q, totalPaise: num(q.totalPaise) })),
      issues: issues.map((i) => ({ ...i, createdAt: iso(i.createdAt) })),
      paymentRequirements: requirements.map((q) => ({ id: q.id, purpose: q.purpose, amountPaise: num(q.amountPaise), status: q.status, isDue: q.isDue, dueTrigger: q.dueTrigger })),
      timeline: events.map((e) => ({ from: e.fromStatus, to: e.toStatus, actorRole: e.actorRole, reason: admin ? e.reason : null, at: iso(e.createdAt) })),
      canAccept: !admin && w.status === 'READY_FOR_OWNER_REVIEW',
      ...(admin
        ? {
            assignments: assignments.map((a) => ({
              id: a.id,
              providerId: a.providerId,
              providerName: a.provider.name,
              providerType: a.provider.providerType,
              role: a.assignmentRole,
              status: a.status,
              overrideReason: a.overrideReason,
              internalNotes: a.internalNotes,
              assignedAt: iso(a.assignedAt),
            })),
            completeness,
            checklistVersion: w.checklistVersion,
            completionOverride: w.completionOverride,
            submittedBy: w.submittedBy,
            categoryId: request.categoryId,
          }
        : {}),
    };
  }

  async list(actor: UserActor, status: WorkOrderStatus | undefined, cursor: string | undefined, limit: number) {
    const rows = await this.prisma.workOrder.findMany({
      where: { ...(isAdmin(actor) ? {} : { ownerUserId: actor.userId }), ...(status ? { status } : {}), ...afterCursor(cursor) },
      include: { request: { select: { reference: true, title: true, urgency: true, safetyFlag: true } } },
      orderBy: pageOrder,
      take: limit + 1,
    });
    return toPage(rows, limit, (w) => ({
      id: w.id,
      reference: w.reference,
      kind: w.kind,
      status: w.status,
      requestId: w.requestId,
      requestReference: w.request.reference,
      title: w.request.title,
      urgency: w.request.urgency,
      safetyFlag: w.request.safetyFlag,
      scheduledStart: iso(w.scheduledStart),
      scheduledEnd: iso(w.scheduledEnd),
      approvedTotalPaise: num(w.approvedTotalPaise),
      createdAt: iso(w.createdAt),
    }));
  }

  async eligibleProviders(actor: UserActor, id: string) {
    const w = await this.findVisible(actor, id);
    const r = await this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: w.requestId } });
    return { items: await this.providers.eligibleFor(r.categoryId, w.propertyId) };
  }
}
