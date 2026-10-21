import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  amenitySchema,
  amenityUpdateSchema,
  cancellationPolicySchema,
  cancellationPolicyUpdateSchema,
  checklistTemplateUpdateSchema,
  serviceAreaSchema,
  serviceAreaUpdateSchema,
  serviceCategorySchema,
  serviceCategoryUpdateSchema,
} from '@propcare/shared';
import { z } from 'zod';
import { CurrentActor, Flags, Public, Roles, type UserActor } from '../../core/context';
import { notFound } from '../../core/errors';
import { PrismaService } from '../../core/prisma.service';
import { zp } from '../../core/zod.pipe';
import { CatalogService } from './catalog.service';

const uuidParam = new ParseUUIDPipe({ version: undefined });

@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles('OWNER', 'ADMIN')
  @Get('service-categories')
  async categories(@CurrentActor() actor: UserActor, @Query('propertyId') propertyId?: string) {
    let pin: string | null = null;
    if (propertyId) {
      const parsed = z.string().uuid().safeParse(propertyId);
      if (!parsed.success) throw notFound();
      const property = await this.prisma.property.findFirst({
        where: { id: parsed.data, ...(actor.role === 'ADMIN' ? {} : { ownerUserId: actor.userId }) },
        select: { pinCode: true },
      });
      if (!property) throw notFound();
      pin = property.pinCode;
    }
    return { items: await this.catalog.listForOwner(pin) };
  }

  @Roles('OWNER', 'ADMIN')
  @Get('service-categories/:id/intake-schema')
  async intake(@Param('id', uuidParam) id: string) {
    const c = await this.catalog.getCategory(id);
    return { categoryId: c.id, intakeSchema: c.intakeSchema, safetyNotes: c.safetyNotes };
  }

  @Public()
  @Get('amenities')
  async amenities() {
    return { items: await this.catalog.amenities() };
  }

  @Public()
  @Get('cancellation-policies')
  async policies() {
    return { items: await this.catalog.cancellationPolicies() };
  }
}

@Controller('admin')
@Roles('ADMIN')
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('service-areas')
  async areas() {
    return { items: await this.catalog.serviceAreas() };
  }

  @Flags('USER_ADMIN')
  @Post('service-areas')
  createArea(@CurrentActor() a: UserActor, @Body(zp(serviceAreaSchema)) body: z.infer<typeof serviceAreaSchema>) {
    return this.catalog.createServiceArea(a, body);
  }

  @Flags('USER_ADMIN')
  @Patch('service-areas/:id')
  updateArea(
    @CurrentActor() a: UserActor,
    @Param('id', uuidParam) id: string,
    @Body(zp(serviceAreaUpdateSchema)) body: z.infer<typeof serviceAreaUpdateSchema>,
  ) {
    return this.catalog.updateServiceArea(a, id, body);
  }

  @Get('service-categories')
  async categories() {
    return { items: await this.catalog.adminCategories() };
  }

  @Flags('CATALOG_ADMIN')
  @Post('service-categories')
  createCategory(@CurrentActor() a: UserActor, @Body(zp(serviceCategorySchema)) body: z.infer<typeof serviceCategorySchema>) {
    return this.catalog.createCategory(a, body);
  }

  @Flags('CATALOG_ADMIN')
  @Patch('service-categories/:id')
  updateCategory(
    @CurrentActor() a: UserActor,
    @Param('id', uuidParam) id: string,
    @Body(zp(serviceCategoryUpdateSchema)) body: z.infer<typeof serviceCategoryUpdateSchema>,
  ) {
    return this.catalog.updateCategory(a, id, body);
  }

  @Flags('CATALOG_ADMIN')
  @Put('service-categories/:id/checklist-template')
  checklist(
    @CurrentActor() a: UserActor,
    @Param('id', uuidParam) id: string,
    @Body(zp(checklistTemplateUpdateSchema)) body: z.infer<typeof checklistTemplateUpdateSchema>,
  ) {
    return this.catalog.setChecklist(a, id, body);
  }

  @Get('amenities')
  async amenities() {
    return { items: await this.catalog.adminAmenities() };
  }

  @Flags('CATALOG_ADMIN')
  @Post('amenities')
  createAmenity(@CurrentActor() a: UserActor, @Body(zp(amenitySchema)) body: z.infer<typeof amenitySchema>) {
    return this.catalog.upsertAmenity(a, null, body);
  }

  @Flags('CATALOG_ADMIN')
  @Patch('amenities/:id')
  updateAmenity(
    @CurrentActor() a: UserActor,
    @Param('id', uuidParam) id: string,
    @Body(zp(amenityUpdateSchema)) body: z.infer<typeof amenityUpdateSchema>,
  ) {
    return this.catalog.upsertAmenity(a, id, body);
  }

  @Get('cancellation-policies')
  async policies() {
    return { items: await this.catalog.adminCancellationPolicies() };
  }

  @Flags('CATALOG_ADMIN')
  @Post('cancellation-policies')
  createPolicy(@CurrentActor() a: UserActor, @Body(zp(cancellationPolicySchema)) body: z.infer<typeof cancellationPolicySchema>) {
    return this.catalog.upsertCancellationPolicy(a, null, body);
  }

  @Flags('CATALOG_ADMIN')
  @Patch('cancellation-policies/:key')
  updatePolicy(
    @CurrentActor() a: UserActor,
    @Param('key') key: string,
    @Body(zp(cancellationPolicyUpdateSchema)) body: z.infer<typeof cancellationPolicyUpdateSchema>,
  ) {
    return this.catalog.upsertCancellationPolicy(a, key, body);
  }
}
