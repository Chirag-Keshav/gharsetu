import { Body, Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { adminPayoutQuery, paginationQuery, payoutHoldSchema, payoutMarkPaidSchema } from '@propcare/shared';
import { z } from 'zod';
import { CurrentActor, Flags, Idempotent, Roles, type UserActor } from '../../core/context';
import { zp } from '../../core/zod.pipe';
import { PayoutsService } from './payouts.service';

@Controller('admin/payouts')
@Roles('ADMIN')
@Flags('FINANCE')
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  list(@Query(zp(adminPayoutQuery)) q: z.infer<typeof adminPayoutQuery>) {
    return this.payouts.adminList(q.status, q.cursor, q.limit);
  }

  @Post(':id/hold')
  @HttpCode(200)
  hold(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(payoutHoldSchema)) body: z.infer<typeof payoutHoldSchema>) {
    return this.payouts.hold(a, id, body.reason);
  }

  @Post(':id/release')
  @HttpCode(200)
  release(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.release(a, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.approve(a, id);
  }

  @Idempotent()
  @Post(':id/mark-paid')
  @HttpCode(200)
  markPaid(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(payoutMarkPaidSchema)) body: z.infer<typeof payoutMarkPaidSchema>) {
    return this.payouts.markPaid(a, id, body.paymentReference);
  }
}

@Controller('owner/payouts')
@Roles('OWNER')
export class OwnerPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  list(@CurrentActor() a: UserActor, @Query(zp(paginationQuery)) q: z.infer<typeof paginationQuery>) {
    return this.payouts.ownerList(a, q.cursor, q.limit);
  }
}

@Global()
@Module({
  controllers: [AdminPayoutsController, OwnerPayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
