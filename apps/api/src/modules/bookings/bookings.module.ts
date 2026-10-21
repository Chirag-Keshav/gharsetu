import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  adminBookingQuery,
  bookingCancelSchema,
  bookingCreateSchema,
  bookingMessageSchema,
  optionalReasonSchema,
  paginationQuery,
  reviewCreateSchema,
  reviewHideSchema,
} from '@propcare/shared';
import { z } from 'zod';
import { CurrentActor, Idempotent, Roles, type UserActor } from '../../core/context';
import { PrismaService } from '../../core/prisma.service';
import { zp } from '../../core/zod.pipe';
import { ThreadsService } from '../threads/threads.service';
import { BookingsService } from './bookings.service';

const listQuery = paginationQuery.extend({ scope: z.enum(['requests', 'upcoming', 'past', 'all']).default('all') });

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly threads: ThreadsService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles('CUSTOMER')
  @Idempotent()
  @Post()
  create(@CurrentActor() a: UserActor, @Body(zp(bookingCreateSchema)) body: z.infer<typeof bookingCreateSchema>) {
    return this.bookings.create(a, body);
  }

  @Roles('CUSTOMER', 'OWNER')
  @Get()
  list(@CurrentActor() a: UserActor, @Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    return this.bookings.list(a, q.scope, q.cursor, q.limit);
  }

  @Roles('CUSTOMER', 'OWNER', 'ADMIN')
  @Get(':id')
  get(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(a, id);
  }

  @Roles('OWNER')
  @Idempotent()
  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.approve(a, id);
  }

  @Roles('OWNER')
  @Post(':id/decline')
  @HttpCode(200)
  decline(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>) {
    return this.bookings.decline(a, id, body.reason);
  }

  @Roles('CUSTOMER')
  @Idempotent()
  @Post(':id/payments')
  pay(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.initiatePayment(a, id);
  }

  @Roles('CUSTOMER', 'OWNER', 'ADMIN')
  @Get(':id/cancellation-preview')
  preview(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.cancellationPreview(a, id);
  }

  @Roles('CUSTOMER', 'OWNER')
  @Idempotent()
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(bookingCancelSchema)) body: z.infer<typeof bookingCancelSchema>) {
    return this.bookings.cancel(a, id, { reason: body.reason });
  }

  @Roles('CUSTOMER', 'OWNER', 'ADMIN')
  @Get(':id/messages')
  messages(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.threads.list(a, 'BOOKING', id);
  }

  @Roles('CUSTOMER', 'OWNER', 'ADMIN')
  @Post(':id/messages')
  post(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(bookingMessageSchema)) body: z.infer<typeof bookingMessageSchema>) {
    return this.prisma.tx((tx) => this.threads.post(tx, a, 'BOOKING', id, { body: body.body }));
  }

  @Roles('CUSTOMER')
  @Post(':id/review')
  review(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(reviewCreateSchema)) body: z.infer<typeof reviewCreateSchema>) {
    return this.bookings.review(a, id, body);
  }
}

@Controller('admin')
@Roles('ADMIN')
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('bookings')
  list(@CurrentActor() a: UserActor, @Query(zp(adminBookingQuery)) q: z.infer<typeof adminBookingQuery>) {
    return this.bookings.adminList(a, q.status, q.cursor, q.limit);
  }

  @Get('bookings/:id')
  get(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(a, id);
  }

  @Idempotent()
  @Post('bookings/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(bookingCancelSchema)) body: z.infer<typeof bookingCancelSchema>) {
    return this.bookings.cancel(a, id, body);
  }

  /** On-behalf approval needs a reason and is audited (SPEC §8.5). */
  @Post('bookings/:id/approve')
  @HttpCode(200)
  approve(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(z.object({ reason: z.string().trim().min(3).max(500) }))) body: { reason: string }) {
    return this.bookings.approve(a, id, body.reason);
  }

  @Post('reviews/:id/hide')
  @HttpCode(200)
  hide(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(reviewHideSchema)) body: z.infer<typeof reviewHideSchema>) {
    return this.bookings.hideReview(a, id, body.reason);
  }
}

@Module({
  controllers: [BookingsController, AdminBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
