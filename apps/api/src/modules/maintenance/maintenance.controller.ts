import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  adminRequestQuery,
  approveCompletionSchema,
  assignmentCreateSchema,
  checklistResultsSchema,
  evidenceCreateSchema,
  inspectionCreateSchema,
  inspectionUpdateSchema,
  messageCreateSchema,
  optionalReasonSchema,
  paginationQuery,
  providerDocumentSchema,
  providerImportSchema,
  providerQuery,
  providerSchema,
  providerUpdateSchema,
  quoteApproveSchema,
  quoteDraftSchema,
  quoteRejectSchema,
  reasonSchema,
  reportBlockedSchema,
  requestTransitionSchema,
  safetyMitigationSchema,
  serviceRequestCreateSchema,
  submitForReviewSchema,
  visitCreateSchema,
  workOrderCreateSchema,
  workOrderQuery,
  workOrderScheduleSchema,
  workOrderTransitionSchema,
} from '@propcare/shared';
import { z } from 'zod';
import { CurrentActor, Flags, Idempotent, Roles, type UserActor } from '../../core/context';
import { forbidden } from '../../core/errors';
import { zp } from '../../core/zod.pipe';
import { ThreadsService } from '../threads/threads.service';
import { ProvidersService } from './providers.service';
import { QuotesService } from './quotes.service';
import { RequestsService } from './requests.service';
import { RequirementsService } from './requirements.service';
import { WorkOrdersService } from './work-orders.service';

const ownerListQuery = paginationQuery.extend({ propertyId: z.string().uuid().optional() });

@Controller()
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly quotes: QuotesService,
    private readonly requirements: RequirementsService,
    private readonly threads: ThreadsService,
  ) {}

  @Roles('OWNER', 'ADMIN')
  @Idempotent()
  @Post('service-requests')
  create(@CurrentActor() a: UserActor, @Body(zp(serviceRequestCreateSchema)) body: z.infer<typeof serviceRequestCreateSchema>) {
    if (a.role === 'OWNER' && body.overrideReason) throw forbidden('OVERRIDE_ADMIN_ONLY');
    return this.requests.create(a, body);
  }

  @Roles('OWNER')
  @Get('service-requests')
  list(@CurrentActor() a: UserActor, @Query(zp(ownerListQuery)) q: z.infer<typeof ownerListQuery>) {
    return this.requests.listForOwner(a, q.propertyId, q.cursor, q.limit);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('service-requests/:id')
  get(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(a, id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('service-requests/:id/messages')
  message(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(messageCreateSchema)) body: z.infer<typeof messageCreateSchema>) {
    return this.requests.postMessage(a, id, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('service-requests/:id/messages')
  messages(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.threads.list(a, 'REQUEST', id);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('service-requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return this.requests.cancel(a, id, body.reason);
  }

  @Roles('ADMIN')
  @Post('service-requests/:id/status-transitions')
  @HttpCode(200)
  transition(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(requestTransitionSchema)) body: z.infer<typeof requestTransitionSchema>) {
    return this.requests.transition(a, id, body);
  }

  @Roles('ADMIN')
  @Post('service-requests/:id/claim')
  @HttpCode(200)
  claim(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.claim(a, id);
  }

  @Roles('ADMIN')
  @Post('service-requests/:id/inspections')
  inspection(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(inspectionCreateSchema)) body: z.infer<typeof inspectionCreateSchema>) {
    return this.requests.scheduleInspection(a, id, body);
  }

  @Roles('ADMIN')
  @Patch('inspections/:id')
  updateInspection(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(inspectionUpdateSchema)) body: z.infer<typeof inspectionUpdateSchema>) {
    return this.requests.updateInspection(a, id, body);
  }

  // --- quotes ---------------------------------------------------------------------------------------
  @Roles('ADMIN')
  @Post('service-requests/:id/quotes')
  draft(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(quoteDraftSchema)) body: z.infer<typeof quoteDraftSchema>) {
    return this.quotes.createDraft(a, id, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('service-requests/:id/quotes')
  quotesFor(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.listForRequest(a, id);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('quotes/:id')
  quote(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(a, id);
  }

  @Roles('ADMIN')
  @Patch('quotes/:id')
  updateQuote(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(quoteDraftSchema)) body: z.infer<typeof quoteDraftSchema>) {
    return this.quotes.updateDraft(a, id, body);
  }

  @Roles('ADMIN')
  @Delete('quotes/:id')
  deleteQuote(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.deleteDraft(a, id);
  }

  @Roles('ADMIN')
  @Post('quotes/:id/send')
  @HttpCode(200)
  send(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.send(a, id);
  }

  @Roles('ADMIN')
  @Post('quotes/:id/withdraw')
  @HttpCode(200)
  withdraw(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>) {
    return this.quotes.withdraw(a, id, body.reason);
  }

  /** Owner only: impersonation is prohibited (SPEC §2.4, §13). */
  @Roles('OWNER')
  @Idempotent()
  @Post('quotes/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentActor() a: UserActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zp(quoteApproveSchema)) body: z.infer<typeof quoteApproveSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.quotes.approve(a, id, body, key ?? null);
  }

  @Roles('OWNER')
  @Idempotent()
  @Post('quotes/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentActor() a: UserActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zp(quoteRejectSchema)) body: z.infer<typeof quoteRejectSchema>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.quotes.reject(a, id, body, key ?? null);
  }

  // --- payment requirements -------------------------------------------------------------------------
  @Roles('OWNER', 'ADMIN')
  @Get('requests/:id/payment-requirements')
  requirementsForRequest(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.requirements.forRequest(a, id);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('work-orders/:id/payment-requirements')
  requirementsForWorkOrder(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.requirements.forWorkOrder(a, id);
  }

  @Roles('OWNER')
  @Idempotent()
  @Post('payment-requirements/:id/payments')
  pay(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.requirements.pay(a, id);
  }

  @Roles('ADMIN')
  @Flags('FINANCE')
  @Post('admin/payment-requirements/:id/waive')
  @HttpCode(200)
  waive(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return this.requirements.waive(a, id, body.reason);
  }

  @Roles('ADMIN')
  @Get('admin/requests')
  queue(@CurrentActor() a: UserActor, @Query(zp(adminRequestQuery)) q: z.infer<typeof adminRequestQuery>) {
    return this.requests.adminQueue(a, q);
  }
}

@Controller('work-orders')
export class WorkOrdersController {
  constructor(
    private readonly workOrders: WorkOrdersService,
    private readonly quotes: QuotesService,
    private readonly threads: ThreadsService,
  ) {}

  @Roles('ADMIN')
  @Idempotent()
  @Post()
  create(@CurrentActor() a: UserActor, @Body(zp(workOrderCreateSchema)) body: z.infer<typeof workOrderCreateSchema>) {
    return this.workOrders.createFromQuote(a, body.quoteId);
  }

  @Roles('OWNER', 'ADMIN')
  @Get()
  list(@CurrentActor() a: UserActor, @Query(zp(workOrderQuery)) q: z.infer<typeof workOrderQuery>) {
    return this.workOrders.list(a, q.status, q.cursor, q.limit);
  }

  @Roles('OWNER', 'ADMIN')
  @Get(':id')
  get(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.get(a, id);
  }

  @Roles('ADMIN')
  @Get(':id/eligible-providers')
  eligible(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.eligibleProviders(a, id);
  }

  @Roles('ADMIN')
  @Post(':id/schedule')
  @HttpCode(200)
  schedule(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(workOrderScheduleSchema)) body: z.infer<typeof workOrderScheduleSchema>) {
    return this.workOrders.schedule(a, id, body);
  }

  @Roles('ADMIN')
  @Post(':id/assignments')
  assign(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(assignmentCreateSchema)) body: z.infer<typeof assignmentCreateSchema>) {
    return this.workOrders.assign(a, id, body);
  }

  @Roles('ADMIN')
  @Delete(':id/assignments/:assignmentId')
  unassign(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.workOrders.unassign(a, id, assignmentId);
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/status-transitions')
  @HttpCode(200)
  transition(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(workOrderTransitionSchema)) body: z.infer<typeof workOrderTransitionSchema>) {
    // Owners may only cancel (policy permitting); the state machine enforces the allowed states.
    if (a.role === 'OWNER' && body.to !== 'CANCELLED') throw forbidden();
    return this.workOrders.transition(a, id, body.to, body.reason);
  }

  @Roles('ADMIN')
  @Post(':id/visits')
  visit(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(visitCreateSchema)) body: z.infer<typeof visitCreateSchema>) {
    return this.workOrders.recordVisit(a, id, body);
  }

  @Roles('ADMIN')
  @Post(':id/checklist-results')
  checklist(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(checklistResultsSchema)) body: z.infer<typeof checklistResultsSchema>) {
    return this.workOrders.recordChecklist(a, id, body);
  }

  @Roles('ADMIN')
  @Post(':id/evidence')
  evidence(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(evidenceCreateSchema)) body: z.infer<typeof evidenceCreateSchema>) {
    return this.workOrders.recordEvidence(a, id, body);
  }

  @Roles('ADMIN')
  @Post(':id/report-blocked')
  @HttpCode(200)
  blocked(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(reportBlockedSchema)) body: z.infer<typeof reportBlockedSchema>) {
    return this.workOrders.reportBlocked(a, id, body);
  }

  @Roles('ADMIN')
  @Post(':id/submit-for-review')
  @HttpCode(200)
  submit(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(submitForReviewSchema)) body: z.infer<typeof submitForReviewSchema>) {
    return this.workOrders.submitForReview(a, id, body);
  }

  @Roles('ADMIN')
  @Flags('COMPLETION_APPROVE')
  @Post(':id/approve-completion')
  @HttpCode(200)
  approve(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(approveCompletionSchema)) body: z.infer<typeof approveCompletionSchema>) {
    return this.workOrders.approveCompletion(a, id, body.overrideReason);
  }

  @Roles('ADMIN')
  @Flags('COMPLETION_APPROVE')
  @Post(':id/request-rework')
  @HttpCode(200)
  rework(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return this.workOrders.requestRework(a, id, body.reason);
  }

  @Roles('OWNER')
  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.accept(a, id);
  }

  @Roles('ADMIN')
  @Post(':id/change-orders')
  async changeOrder(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(quoteDraftSchema)) body: z.infer<typeof quoteDraftSchema>) {
    const wo = await this.workOrders.findVisible(a, id);
    return this.quotes.createDraft(a, wo.requestId, body, { workOrderId: id });
  }

  @Roles('ADMIN')
  @Post(':id/safety-mitigation')
  @HttpCode(200)
  mitigation(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(safetyMitigationSchema)) body: z.infer<typeof safetyMitigationSchema>) {
    return this.workOrders.safetyMitigation(a, id, body.note);
  }

  @Roles('ADMIN')
  @Get(':id/job-sheet')
  jobSheet(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.jobSheet(a, id);
  }

  @Roles('OWNER', 'ADMIN')
  @Get(':id/messages')
  messages(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.threads.list(a, 'WORK_ORDER', id);
  }
}

@Controller('admin/providers')
@Roles('ADMIN')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  list(@Query(zp(providerQuery)) q: z.infer<typeof providerQuery>) {
    return this.providers.list(q);
  }

  @Post()
  create(@CurrentActor() a: UserActor, @Body(zp(providerSchema)) body: z.infer<typeof providerSchema>) {
    return this.providers.create(a, body);
  }

  @Flags('USER_ADMIN')
  @Post('import')
  import(@CurrentActor() a: UserActor, @Body(zp(providerImportSchema)) body: z.infer<typeof providerImportSchema>) {
    return this.providers.importCsv(a, body.csv);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.get(id);
  }

  @Patch(':id')
  update(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(providerUpdateSchema)) body: z.infer<typeof providerUpdateSchema>) {
    return this.providers.update(a, id, body);
  }

  @Post(':id/documents')
  document(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(providerDocumentSchema)) body: z.infer<typeof providerDocumentSchema>) {
    return this.providers.addDocument(a, id, body);
  }
}
