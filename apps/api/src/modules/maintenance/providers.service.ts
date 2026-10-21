import { Injectable } from '@nestjs/common';
import type { ServiceProvider } from '@prisma/client';
import { isoToDate, maskPhone, normaliseIndianPhone, providerDocumentSchema, providerSchema, type PermissionFlag } from '@propcare/shared';
import type { z } from 'zod';
import { hasFlag, type UserActor } from '../../core/context';
import { forbidden, notFound, validation } from '../../core/errors';
import { PrismaService, type Db } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { afterCursor, iso, pageOrder, toPage } from '../../core/serialize';
import { AttachmentsService } from '../attachments/attachments.service';

type ProviderInput = z.infer<typeof providerSchema>;
export type EligibilityFailure = 'NOT_ACTIVE' | 'NOT_VERIFIED' | 'MISSING_SKILL' | 'OUTSIDE_SERVICE_AREA';

/**
 * Provider directory (SPEC §8.8 PRV-01). Providers never log in; everything here is admin-only and
 * is never serialised to owners or customers.
 */
@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly attachments: AttachmentsService,
  ) {}

  /** Deterministic eligibility (SPEC §7 rule 7); AI never decides this. */
  async eligibility(db: Db, providerId: string, categoryId: string, propertyId: string) {
    const [provider, property] = await Promise.all([
      db.serviceProvider.findUnique({ where: { id: providerId }, include: { skills: true, areas: { include: { serviceArea: true } } } }),
      db.property.findUniqueOrThrow({ where: { id: propertyId }, select: { pinCode: true } }),
    ]);
    if (!provider) throw notFound();
    const failures: EligibilityFailure[] = [];
    if (provider.status !== 'ACTIVE') failures.push('NOT_ACTIVE');
    if (provider.verificationStatus !== 'APPROVED') failures.push('NOT_VERIFIED');
    if (!provider.skills.some((s) => s.categoryId === categoryId)) failures.push('MISSING_SKILL');
    if (!provider.areas.some((a) => a.serviceArea.isActive && a.serviceArea.pinCodes.includes(property.pinCode))) failures.push('OUTSIDE_SERVICE_AREA');
    return { eligible: failures.length === 0, failures, provider };
  }

  /** Eligible providers for a job, used by assignment pickers and the AI shortlist. */
  async eligibleFor(categoryId: string, propertyId: string) {
    const property = await this.prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { pinCode: true } });
    const rows = await this.prisma.serviceProvider.findMany({
      where: {
        status: 'ACTIVE',
        verificationStatus: 'APPROVED',
        skills: { some: { categoryId } },
        areas: { some: { serviceArea: { isActive: true, pinCodes: { has: property.pinCode } } } },
      },
      include: { _count: { select: { assignments: true } } },
      orderBy: [{ internalRating: 'desc' }, { name: 'asc' }],
    });
    return rows.map((p) => ({ id: p.id, name: p.name, providerType: p.providerType, internalRating: p.internalRating, jobs: p._count.assignments, availabilityNotes: p.availabilityNotes }));
  }

  serialize(p: ServiceProvider & { skills?: Array<{ categoryId: string }>; areas?: Array<{ serviceAreaId: string }> }) {
    return {
      id: p.id,
      name: p.name,
      providerType: p.providerType,
      contactName: p.contactName,
      phone: p.phone,
      phoneMasked: maskPhone(p.phone),
      status: p.status,
      verificationStatus: p.verificationStatus,
      availabilityNotes: p.availabilityNotes,
      internalNotes: p.internalNotes,
      internalRating: p.internalRating,
      skillCategoryIds: p.skills?.map((s) => s.categoryId) ?? [],
      serviceAreaIds: p.areas?.map((a) => a.serviceAreaId) ?? [],
      createdAt: iso(p.createdAt),
    };
  }

  async list(f: { q?: string; categoryId?: string; serviceAreaId?: string; status?: ServiceProvider['status']; minRating?: number; cursor?: string; limit: number }) {
    const rows = await this.prisma.serviceProvider.findMany({
      where: {
        ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { contactName: { contains: f.q, mode: 'insensitive' } }] } : {}),
        ...(f.categoryId ? { skills: { some: { categoryId: f.categoryId } } } : {}),
        ...(f.serviceAreaId ? { areas: { some: { serviceAreaId: f.serviceAreaId } } } : {}),
        ...(f.status ? { status: f.status } : {}),
        ...(f.minRating ? { internalRating: { gte: f.minRating } } : {}),
        ...afterCursor(f.cursor),
      },
      include: { skills: true, areas: true },
      orderBy: pageOrder,
      take: f.limit + 1,
    });
    return toPage(rows, f.limit, (p) => this.serialize(p));
  }

  async get(id: string) {
    const p = await this.prisma.serviceProvider.findUnique({ where: { id }, include: { skills: true, areas: true } });
    if (!p) throw notFound();
    const [docs, history] = await Promise.all([
      this.prisma.verificationDocument.findMany({ where: { ownerType: 'PROVIDER', ownerId: id } }),
      this.prisma.workAssignment.findMany({ where: { providerId: id }, include: { workOrder: { select: { id: true, reference: true, status: true, scheduledStart: true } } }, orderBy: { assignedAt: 'desc' }, take: 50 }),
    ]);
    return {
      ...this.serialize(p),
      documents: docs.map((d) => ({ id: d.id, docType: d.docType, attachmentId: d.attachmentId, expiresAt: iso(d.expiresAt), createdAt: iso(d.createdAt) })),
      history: history.map((h) => ({
        assignmentId: h.id,
        workOrderId: h.workOrder.id,
        reference: h.workOrder.reference,
        status: h.workOrder.status,
        role: h.assignmentRole,
        assignmentStatus: h.status,
        scheduledStart: iso(h.workOrder.scheduledStart),
        override: !!h.overrideReason,
      })),
    };
  }

  private requireApprovalFlag(actor: UserActor, input: Partial<ProviderInput>, current?: ServiceProvider) {
    // Directory approvals (verification status) need USER_ADMIN (SPEC §13).
    const changing = input.verificationStatus && input.verificationStatus !== (current?.verificationStatus ?? 'PENDING');
    if (changing && !hasFlag(actor, 'USER_ADMIN' as PermissionFlag)) throw forbidden('FLAG_REQUIRED:USER_ADMIN');
  }

  async create(actor: UserActor, input: ProviderInput) {
    this.requireApprovalFlag(actor, input);
    return this.prisma.tx(async (tx) => {
      const { skillCategoryIds, serviceAreaIds, ...data } = input;
      const p = await tx.serviceProvider.create({ data: { ...data, createdBy: actor.userId } });
      await this.setLinks(tx, p.id, skillCategoryIds, serviceAreaIds);
      await this.records.audit(tx, actor, { action: 'provider.created', entityType: 'PROVIDER', entityId: p.id });
      return this.serialize({ ...p, skills: skillCategoryIds.map((categoryId) => ({ categoryId })), areas: serviceAreaIds.map((serviceAreaId) => ({ serviceAreaId })) });
    });
  }

  async update(actor: UserActor, id: string, input: Partial<ProviderInput>) {
    return this.prisma.tx(async (tx) => {
      const current = await tx.serviceProvider.findUnique({ where: { id } });
      if (!current) throw notFound();
      this.requireApprovalFlag(actor, input, current);
      const { skillCategoryIds, serviceAreaIds, ...data } = input;
      await tx.serviceProvider.update({ where: { id }, data });
      if (skillCategoryIds || serviceAreaIds) {
        const existing = await tx.serviceProvider.findUniqueOrThrow({ where: { id }, include: { skills: true, areas: true } });
        await this.setLinks(tx, id, skillCategoryIds ?? existing.skills.map((s) => s.categoryId), serviceAreaIds ?? existing.areas.map((a) => a.serviceAreaId));
      }
      await this.records.audit(tx, actor, { action: 'provider.updated', entityType: 'PROVIDER', entityId: id, metadata: { fields: Object.keys(input) } });
      return { id };
    });
  }

  private async setLinks(tx: Db, providerId: string, skills: string[], areas: string[]) {
    await tx.providerSkill.deleteMany({ where: { providerId } });
    await tx.providerServiceArea.deleteMany({ where: { providerId } });
    if (skills.length) await tx.providerSkill.createMany({ data: [...new Set(skills)].map((categoryId) => ({ providerId, categoryId })) });
    if (areas.length) await tx.providerServiceArea.createMany({ data: [...new Set(areas)].map((serviceAreaId) => ({ providerId, serviceAreaId })) });
  }

  async addDocument(actor: UserActor, id: string, input: z.infer<typeof providerDocumentSchema>) {
    return this.prisma.tx(async (tx) => {
      if (!(await tx.serviceProvider.findUnique({ where: { id } }))) throw notFound();
      await this.attachments.link(tx, actor, [input.attachmentId], 'PROVIDER', id);
      const att = await tx.attachment.findUniqueOrThrow({ where: { id: input.attachmentId } });
      const d = await tx.verificationDocument.create({
        data: { ownerType: 'PROVIDER', ownerId: id, docType: input.docType, attachmentId: att.id, objectKey: att.objectKey, expiresAt: input.expiresAt ? isoToDate(input.expiresAt) : null },
      });
      await this.records.audit(tx, actor, { action: 'provider.document_added', entityType: 'PROVIDER', entityId: id, metadata: { docType: input.docType } });
      return { id: d.id };
    });
  }

  /**
   * CSV import (P1): header `name,provider_type,contact_name,phone,status,verification_status,skills,areas`
   * where skills/areas are `|`-separated category slugs and service-area names.
   */
  async importCsv(actor: UserActor, csv: string) {
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const header = (lines.shift() ?? '').split(',').map((h) => h.trim().toLowerCase());
    const required = ['name', 'provider_type', 'phone'];
    if (!required.every((r) => header.includes(r))) throw validation({ code: 'CSV_HEADER_INVALID', message: `Required columns: ${required.join(', ')}` });
    const [categories, areas] = await Promise.all([this.prisma.serviceCategory.findMany(), this.prisma.serviceArea.findMany()]);
    const results: Array<{ line: number; ok: boolean; error?: string; id?: string }> = [];
    for (const [i, line] of lines.entries()) {
      const cells = line.split(',').map((c) => c.trim());
      const row = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? '']));
      const phone = normaliseIndianPhone(row.phone);
      const type = row.provider_type?.toUpperCase();
      if (!row.name || !phone || !['INDIVIDUAL', 'GROUP'].includes(type)) {
        results.push({ line: i + 2, ok: false, error: 'INVALID_ROW' });
        continue;
      }
      const skillIds = (row.skills ?? '').split('|').map((s) => categories.find((c) => c.slug === s.trim())?.id).filter((x): x is string => !!x);
      const areaIds = (row.areas ?? '').split('|').map((s) => areas.find((a) => a.name.toLowerCase() === s.trim().toLowerCase())?.id).filter((x): x is string => !!x);
      const status = ['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(row.status?.toUpperCase()) ? (row.status.toUpperCase() as ServiceProvider['status']) : 'ACTIVE';
      // Imported providers start PENDING unless the importer may approve.
      const verification = hasFlag(actor, 'USER_ADMIN') && row.verification_status?.toUpperCase() === 'APPROVED' ? 'APPROVED' : 'PENDING';
      const created = await this.create(actor, {
        name: row.name,
        providerType: type as 'INDIVIDUAL' | 'GROUP',
        contactName: row.contact_name || null,
        phone,
        status,
        verificationStatus: verification,
        skillCategoryIds: skillIds,
        serviceAreaIds: areaIds,
      } as ProviderInput);
      results.push({ line: i + 2, ok: true, id: created.id });
    }
    return { imported: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }
}
