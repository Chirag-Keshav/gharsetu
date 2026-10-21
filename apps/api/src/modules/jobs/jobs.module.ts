import { Inject, Injectable, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { CLOCK, type Clock } from '../../core/clock';
import { PrismaService } from '../../core/prisma.service';
import { AiService } from '../ai/ai.service';
import { BookingsModule } from '../bookings/bookings.module';
import { BookingsService } from '../bookings/bookings.service';
import { IssuesModule } from '../issues/issues.module';
import { IssuesService } from '../issues/issues.service';
import { QuotesService } from '../maintenance/quotes.service';
import { WorkOrdersService } from '../maintenance/work-orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PayoutsService } from '../payouts/payouts.service';
import { BullMqQueueDriver, InProcessQueueDriver, type QueueDriver } from './queue-driver';

const S = 1_000;
const M = 60 * S;

/** Registers every scheduled job (SPEC §14.2). Disabled with JOBS_ENABLED=false (tests). */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private driver?: QueueDriver;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly bookings: BookingsService,
    private readonly payouts: PayoutsService,
    private readonly quotes: QuotesService,
    private readonly workOrders: WorkOrdersService,
    private readonly issues: IssuesService,
    private readonly payments: PaymentsService,
    private readonly ai: AiService,
  ) {}

  /** All jobs, also callable directly (e.g. from tests or an ops endpoint). */
  readonly jobs: Record<string, { every: number; run: () => Promise<unknown> }> = {
    'outbox.dispatch': { every: 2 * S, run: () => this.notifications.dispatchOnce() },
    'notifications.sms_retry': { every: 30 * S, run: () => this.notifications.sendPendingSms() },
    'bookings.expire_holds': { every: 30 * S, run: () => this.bookings.expireHolds() },
    'bookings.expire_requests': { every: M, run: () => this.bookings.expireRequests() },
    'bookings.complete': { every: 5 * M, run: () => this.bookings.completeStays() },
    'payouts.eligibility': { every: 5 * M, run: () => this.payouts.runEligibility() },
    'quotes.expire': { every: 5 * M, run: () => this.quotes.expireDue() },
    'work_orders.auto_complete': { every: 5 * M, run: () => this.workOrders.autoComplete() },
    'issues.close_lapsed': { every: 60 * M, run: () => this.issues.closeLapsed() },
    'refunds.retry': { every: 5 * M, run: () => this.payments.processRefunds() },
    'ai.daily_briefing': { every: 5 * M, run: () => this.ai.dailyBriefingIfDue() },
    'retention.purge': { every: 60 * M, run: () => this.purge() },
  };

  /** Short retention for OTP challenges and idempotency keys (SPEC §11). */
  private async purge() {
    const dayAgo = new Date(this.clock.now().getTime() - 24 * 60 * M);
    await this.prisma.otpChallenge.deleteMany({ where: { createdAt: { lt: dayAgo } } });
    await this.prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: dayAgo } } });
  }

  async onApplicationBootstrap() {
    if (!this.env.JOBS_ENABLED) return;
    this.driver = this.env.QUEUE_DRIVER === 'bullmq' && this.env.REDIS_URL ? new BullMqQueueDriver(this.env.REDIS_URL) : new InProcessQueueDriver();
    for (const [name, job] of Object.entries(this.jobs)) this.driver.schedule(name, job.every, job.run);
    await this.driver.start();
  }

  async onApplicationShutdown() {
    await this.driver?.stop();
  }
}

@Module({
  imports: [BookingsModule, IssuesModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
