import { Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { paginationQuery } from '@propcare/shared';
import type { z } from 'zod';
import { CurrentActor, type UserActor } from '../../core/context';
import { zp } from '../../core/zod.pipe';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentActor() a: UserActor, @Query(zp(paginationQuery)) q: z.infer<typeof paginationQuery>) {
    return this.notifications.list(a, q.cursor, q.limit);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentActor() a: UserActor) {
    return this.notifications.markAllRead(a);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(a, id);
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
