import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { adminIssueQuery, issueCreateSchema, issueResolveSchema, messageCreateSchema, reasonSchema } from '@propcare/shared';
import { z } from 'zod';
import { CurrentActor, Roles, type UserActor } from '../../core/context';
import { zp } from '../../core/zod.pipe';
import { ThreadsService } from '../threads/threads.service';
import { IssuesService } from './issues.service';

@Controller()
export class IssuesController {
  constructor(
    private readonly issues: IssuesService,
    private readonly threads: ThreadsService,
  ) {}

  @Roles('OWNER', 'ADMIN')
  @Post('work-orders/:id/issues')
  raiseOnWorkOrder(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(issueCreateSchema)) body: z.infer<typeof issueCreateSchema>) {
    return this.issues.raiseOnWorkOrder(a, id, body);
  }

  @Roles('CUSTOMER', 'OWNER', 'ADMIN')
  @Post('bookings/:id/issues')
  raiseOnBooking(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(issueCreateSchema)) body: z.infer<typeof issueCreateSchema>) {
    return this.issues.raiseOnBooking(a, id, body);
  }

  @Roles('CUSTOMER', 'OWNER', 'ADMIN')
  @Get('issues')
  list(@CurrentActor() a: UserActor, @Query(zp(adminIssueQuery)) q: z.infer<typeof adminIssueQuery>) {
    return this.issues.list(a, q.status, q.cursor, q.limit);
  }

  @Roles('CUSTOMER', 'OWNER', 'ADMIN')
  @Get('issues/:id')
  get(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.issues.get(a, id);
  }

  @Roles('CUSTOMER', 'OWNER', 'ADMIN')
  @Get('issues/:id/messages')
  messages(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.threads.list(a, 'ISSUE', id);
  }

  @Roles('CUSTOMER', 'OWNER', 'ADMIN')
  @Post('issues/:id/messages')
  message(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(messageCreateSchema)) body: z.infer<typeof messageCreateSchema>) {
    return this.issues.postMessage(a, id, body);
  }

  @Roles('CUSTOMER', 'OWNER')
  @Post('issues/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return this.issues.reopen(a, id, body.reason);
  }

  @Roles('ADMIN')
  @Post('issues/:id/take')
  @HttpCode(200)
  take(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.issues.take(a, id);
  }

  @Roles('ADMIN')
  @Post('issues/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(issueResolveSchema)) body: z.infer<typeof issueResolveSchema>) {
    return this.issues.resolve(a, id, body);
  }

  @Roles('ADMIN')
  @Post('issues/:id/close')
  @HttpCode(200)
  async close(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    await this.issues.close(a, id);
    return this.issues.get(a, id);
  }

  @Roles('ADMIN')
  @Post('issues/:id/rework-work-order')
  rework(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.issues.createRework(a, id);
  }

  @Roles('ADMIN')
  @Get('admin/issues')
  adminList(@CurrentActor() a: UserActor, @Query(zp(adminIssueQuery)) q: z.infer<typeof adminIssueQuery>) {
    return this.issues.list(a, q.status, q.cursor, q.limit);
  }
}

@Module({
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
