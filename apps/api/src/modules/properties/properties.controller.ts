import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  paginationQuery,
  propertyContactSchema,
  propertyContactUpdateSchema,
  propertyCreateSchema,
  propertyUpdateSchema,
  verificationDecisionSchema,
  verificationSubmitSchema,
} from '@propcare/shared';
import { z } from 'zod';
import { CurrentActor, Flags, Roles, type UserActor } from '../../core/context';
import { zp } from '../../core/zod.pipe';
import { PropertiesService } from './properties.service';
import { VerificationsService } from './verifications.service';

@Controller('properties')
@Roles('OWNER', 'ADMIN')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Roles('OWNER')
  @Get()
  list(@CurrentActor() a: UserActor, @Query('includeArchived') includeArchived?: string) {
    return this.properties.list(a, includeArchived === 'true');
  }

  @Roles('OWNER')
  @Post()
  create(@CurrentActor() a: UserActor, @Body(zp(propertyCreateSchema)) body: z.infer<typeof propertyCreateSchema>) {
    return this.properties.create(a, body);
  }

  @Get(':id')
  get(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Query('include') include?: string) {
    return this.properties.get(a, id, include === 'accessNotes');
  }

  @Roles('OWNER')
  @Patch(':id')
  update(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(propertyUpdateSchema)) body: z.infer<typeof propertyUpdateSchema>) {
    return this.properties.update(a, id, body);
  }

  @Roles('OWNER')
  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.properties.archive(a, id);
  }

  @Roles('OWNER')
  @Post(':id/contacts')
  addContact(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(propertyContactSchema)) body: z.infer<typeof propertyContactSchema>) {
    return this.properties.addContact(a, id, body);
  }

  @Roles('OWNER')
  @Patch(':id/contacts/:contactId')
  updateContact(
    @CurrentActor() a: UserActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(zp(propertyContactUpdateSchema)) body: z.infer<typeof propertyContactUpdateSchema>,
  ) {
    return this.properties.updateContact(a, id, contactId, body);
  }

  @Roles('OWNER')
  @Delete(':id/contacts/:contactId')
  removeContact(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.properties.removeContact(a, id, contactId);
  }

  @Roles('OWNER')
  @Post(':id/verification')
  submitVerification(
    @CurrentActor() a: UserActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zp(verificationSubmitSchema)) body: z.infer<typeof verificationSubmitSchema>,
  ) {
    return this.properties.submitVerification(a, id, body);
  }

  @Get(':id/verification')
  verification(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.properties.verificationStatus(a, id);
  }
}

const queueQuery = paginationQuery.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() });

@Controller('admin/verifications')
@Roles('ADMIN')
@Flags('LISTING_REVIEW')
export class AdminVerificationsController {
  constructor(private readonly verifications: VerificationsService) {}

  @Get()
  queue(@Query(zp(queueQuery)) q: z.infer<typeof queueQuery>) {
    return this.verifications.queue(q.status ?? 'PENDING', q.cursor, q.limit);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(verificationDecisionSchema)) body: z.infer<typeof verificationDecisionSchema>) {
    return this.verifications.decide(a, id, 'APPROVED', body.reason, body.expiresAt);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(verificationDecisionSchema)) body: z.infer<typeof verificationDecisionSchema>) {
    return this.verifications.decide(a, id, 'REJECTED', body.reason);
  }
}
