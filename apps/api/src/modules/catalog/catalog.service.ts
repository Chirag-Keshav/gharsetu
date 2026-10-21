import { Injectable } from '@nestjs/common';
import type { Prisma, ServiceCategory } from '@prisma/client';
import {
  amenitySchema,
  cancellationPolicySchema,
  cancellationRulesSchema,
  checklistTemplateSchema,
  intakeSchemaSchema,
  requiredEvidenceSchema,
  serviceAreaSchema,
  serviceCategorySchema,
  type ChecklistTemplate,
  type IntakeSchema,
  type RequiredEvidence,
} from '@propcare/shared';
import type { z } from 'zod';
import type { Actor } from '../../core/context';
import { notFound } from '../../core/errors';
import { PrismaService, type Db } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';

type CategoryInput = z.infer<typeof serviceCategorySchema>;

/** Catalogue and configuration data (SPEC §9). Categories are data, never hard-coded. */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
  ) {}

  // --- reads used across modules -------------------------------------------------------------
  intakeOf(category: Pick<ServiceCategory, 'intakeSchema'>): IntakeSchema {
    return intakeSchemaSchema.parse(category.intakeSchema);
  }

  evidenceOf(category: Pick<ServiceCategory, 'requiredEvidence'>): RequiredEvidence {
    return requiredEvidenceSchema.parse(category.requiredEvidence ?? {});
  }

  async activeChecklist(categoryId: string, db: Db = this.prisma) {
    return db.checklistTemplate.findFirst({ where: { categoryId, isActive: true }, orderBy: { version: 'desc' } });
  }

  parseChecklist(items: unknown): ChecklistTemplate {
    return checklistTemplateSchema.parse({ items });
  }

  /** Active service area covering the PIN code (and, if given, offering the category). */
  async serviceAreaFor(pinCode: string, categoryId?: string, db: Db = this.prisma) {
    return db.serviceArea.findFirst({
      where: {
        isActive: true,
        pinCodes: { has: pinCode },
        ...(categoryId ? { categories: { some: { categoryId } } } : {}),
      },
    });
  }

  async cancellationPolicy(key: string) {
    const p = await this.prisma.cancellationPolicy.findUnique({ where: { key } });
    if (!p) return null;
    return { key: p.key, name: p.name, description: p.description, rules: cancellationRulesSchema.parse(p.rules), isActive: p.isActive };
  }

  // --- owner-facing ----------------------------------------------------------------------------
  serializeCategory(c: ServiceCategory, available?: boolean) {
    const intake = this.intakeOf(c);
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      inspectionUsuallyRequired: c.inspectionUsuallyRequired,
      safetyNotes: c.safetyNotes,
      intakeSchema: intake,
      attachmentRules: c.attachmentRules,
      ...(available === undefined ? {} : { available }),
    };
  }

  async listForOwner(propertyPin: string | null) {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: { serviceAreas: { include: { serviceArea: true } } },
    });
    return categories.map((c) => {
      const available =
        propertyPin === null
          ? undefined
          : c.serviceAreas.some((sa) => sa.serviceArea.isActive && sa.serviceArea.pinCodes.includes(propertyPin));
      return this.serializeCategory(c, available);
    });
  }

  async getCategory(id: string) {
    const c = await this.prisma.serviceCategory.findFirst({ where: { id, isActive: true } });
    if (!c) throw notFound();
    return this.serializeCategory(c);
  }

  async amenities() {
    const rows = await this.prisma.amenity.findMany({ where: { isActive: true }, orderBy: [{ group: 'asc' }, { name: 'asc' }] });
    return rows.map((a) => ({ id: a.id, slug: a.slug, name: a.name, group: a.group, iconKey: a.iconKey }));
  }

  async cancellationPolicies() {
    const rows = await this.prisma.cancellationPolicy.findMany({ where: { isActive: true }, orderBy: { key: 'asc' } });
    return rows.map((p) => ({ key: p.key, name: p.name, description: p.description, rules: p.rules }));
  }

  // --- admin configuration --------------------------------------------------------------------
  async adminCategories() {
    const rows = await this.prisma.serviceCategory.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: { serviceAreas: true, checklistTemplates: { where: { isActive: true }, orderBy: { version: 'desc' }, take: 1 } },
    });
    return rows.map((c) => ({
      ...this.serializeCategory(c),
      isActive: c.isActive,
      displayOrder: c.displayOrder,
      requiredEvidence: this.evidenceOf(c),
      paymentPolicy: c.paymentPolicy,
      serviceAreaIds: c.serviceAreas.map((s) => s.serviceAreaId),
      checklist: c.checklistTemplates[0] ? { version: c.checklistTemplates[0].version, items: c.checklistTemplates[0].items } : null,
    }));
  }

  async createCategory(actor: Actor, input: CategoryInput) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.serviceCategory.create({ data: this.categoryData(input) as Prisma.ServiceCategoryCreateInput });
      await this.setCategoryAreas(tx, c.id, input.serviceAreaIds);
      await this.records.audit(tx, actor, { action: 'catalog.category_created', entityType: 'SERVICE_CATEGORY', entityId: c.id });
      return { id: c.id };
    });
  }

  async updateCategory(actor: Actor, id: string, input: Partial<CategoryInput>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.serviceCategory.findUniqueOrThrow({ where: { id } });
      await tx.serviceCategory.update({ where: { id }, data: this.categoryData(input) });
      if (input.serviceAreaIds) await this.setCategoryAreas(tx, id, input.serviceAreaIds);
      await this.records.audit(tx, actor, {
        action: 'catalog.category_updated',
        entityType: 'SERVICE_CATEGORY',
        entityId: id,
        metadata: { fields: Object.keys(input) },
      });
      return { id };
    });
  }

  private categoryData(input: Partial<CategoryInput>): Prisma.ServiceCategoryUpdateInput {
    const { serviceAreaIds: _areas, intakeSchema, ...rest } = input;
    return {
      ...rest,
      ...(intakeSchema
        ? {
            intakeSchema: intakeSchema as unknown as Prisma.InputJsonValue,
            dangerRules: intakeSchema.dangerRules as unknown as Prisma.InputJsonValue,
          }
        : {}),
      requiredEvidence: input.requiredEvidence as Prisma.InputJsonValue | undefined,
      paymentPolicy: input.paymentPolicy as Prisma.InputJsonValue | undefined,
      attachmentRules: input.attachmentRules as Prisma.InputJsonValue | undefined,
    };
  }

  private async setCategoryAreas(tx: Db, categoryId: string, areaIds: string[]) {
    await tx.categoryServiceArea.deleteMany({ where: { categoryId } });
    if (areaIds.length) {
      await tx.categoryServiceArea.createMany({ data: areaIds.map((serviceAreaId) => ({ categoryId, serviceAreaId })), skipDuplicates: true });
    }
  }

  /** New template version; in-progress work orders keep the version they started with. */
  async setChecklist(actor: Actor, categoryId: string, template: ChecklistTemplate) {
    return this.prisma.$transaction(async (tx) => {
      await tx.serviceCategory.findUniqueOrThrow({ where: { id: categoryId } });
      const latest = await tx.checklistTemplate.findFirst({ where: { categoryId }, orderBy: { version: 'desc' } });
      await tx.checklistTemplate.updateMany({ where: { categoryId, isActive: true }, data: { isActive: false } });
      const created = await tx.checklistTemplate.create({
        data: { categoryId, version: (latest?.version ?? 0) + 1, items: template.items as unknown as Prisma.InputJsonValue },
      });
      await this.records.audit(tx, actor, {
        action: 'catalog.checklist_versioned',
        entityType: 'SERVICE_CATEGORY',
        entityId: categoryId,
        metadata: { version: created.version },
      });
      return { version: created.version };
    });
  }

  async serviceAreas() {
    return this.prisma.serviceArea.findMany({ orderBy: { name: 'asc' } });
  }

  async createServiceArea(actor: Actor, input: z.infer<typeof serviceAreaSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.serviceArea.create({ data: input });
      await this.records.audit(tx, actor, { action: 'config.service_area_created', entityType: 'SERVICE_AREA', entityId: a.id });
      return a;
    });
  }

  async updateServiceArea(actor: Actor, id: string, input: Partial<z.infer<typeof serviceAreaSchema>>) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.serviceArea.update({ where: { id }, data: input });
      await this.records.audit(tx, actor, {
        action: 'config.service_area_updated',
        entityType: 'SERVICE_AREA',
        entityId: id,
        metadata: { fields: Object.keys(input) },
      });
      return a;
    });
  }

  async adminAmenities() {
    return this.prisma.amenity.findMany({ orderBy: [{ group: 'asc' }, { name: 'asc' }] });
  }

  async upsertAmenity(actor: Actor, id: string | null, input: Partial<z.infer<typeof amenitySchema>>) {
    return this.prisma.$transaction(async (tx) => {
      const a = id
        ? await tx.amenity.update({ where: { id }, data: input })
        : await tx.amenity.create({ data: input as z.infer<typeof amenitySchema> });
      await this.records.audit(tx, actor, { action: id ? 'catalog.amenity_updated' : 'catalog.amenity_created', entityType: 'AMENITY', entityId: a.id });
      return a;
    });
  }

  async adminCancellationPolicies() {
    return this.prisma.cancellationPolicy.findMany({ orderBy: { key: 'asc' } });
  }

  async upsertCancellationPolicy(actor: Actor, key: string | null, input: Partial<z.infer<typeof cancellationPolicySchema>>) {
    return this.prisma.$transaction(async (tx) => {
      const data = { ...input, rules: input.rules as unknown as Prisma.InputJsonValue | undefined };
      const p = key
        ? await tx.cancellationPolicy.update({ where: { key }, data })
        : await tx.cancellationPolicy.create({ data: data as Prisma.CancellationPolicyCreateInput });
      await this.records.audit(tx, actor, {
        action: key ? 'catalog.cancellation_policy_updated' : 'catalog.cancellation_policy_created',
        entityType: 'CANCELLATION_POLICY',
        entityId: p.key,
      });
      return p;
    });
  }
}
