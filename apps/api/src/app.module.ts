import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CoreModule } from './core/core.module';
import { AuthGuard, CsrfGuard } from './core/guards';
import { IdempotencyInterceptor } from './core/idempotency.interceptor';
import { RateLimitGuard } from './core/rate-limit';
import { RequestMiddleware } from './core/request.middleware';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CommissionModule } from './modules/commission/commission.module';
import { HealthController } from './modules/health/health.controller';
import { ListingsModule } from './modules/listings/listings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { IssuesModule } from './modules/issues/issues.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AiModule } from './modules/ai/ai.module';
import { AdminModule } from './modules/admin/admin.module';
import { JobsModule } from './modules/jobs/jobs.module';

@Module({
  imports: [
    CoreModule,
    AuthModule,
    CatalogModule,
    AttachmentsModule,
    PropertiesModule,
    CommissionModule,
    PaymentsModule,
    PayoutsModule,
    ListingsModule,
    BookingsModule,
    MaintenanceModule,
    IssuesModule,
    NotificationsModule,
    AiModule,
    AdminModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestMiddleware).forRoutes('{*path}');
  }
}
