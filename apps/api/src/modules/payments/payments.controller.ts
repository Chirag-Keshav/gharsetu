import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { mockPaymentCompleteSchema, offlinePaymentSchema, paginationQuery, refundCreateSchema } from '@propcare/shared';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env';
import { CurrentActor, Flags, Idempotent, Public, RateLimit, Roles, SkipCsrf, type AuthedRequest, type UserActor } from '../../core/context';
import { notFound } from '../../core/errors';
import { PrismaService } from '../../core/prisma.service';
import { num } from '../../core/serialize';
import { zp } from '../../core/zod.pipe';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get('payments/:id')
  get(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(a, id);
  }

  @Roles('ADMIN')
  @Flags('FINANCE')
  @Idempotent()
  @Post('payments/offline')
  offline(@CurrentActor() a: UserActor, @Body(zp(offlinePaymentSchema)) body: z.infer<typeof offlinePaymentSchema>) {
    return this.payments.recordOffline(a, body);
  }

  @Roles('ADMIN')
  @Flags('FINANCE')
  @Idempotent()
  @Post('payments/:id/refund')
  refund(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(refundCreateSchema)) body: z.infer<typeof refundCreateSchema>) {
    return this.payments.manualRefund(a, id, body.amountPaise, body.reason);
  }

  @Roles('ADMIN')
  @Flags('FINANCE')
  @Get('admin/payments')
  adminList(@Query(zp(paginationQuery)) q: z.infer<typeof paginationQuery>) {
    return this.payments.adminList(q.cursor, q.limit);
  }

  /** Signature-verified, deduplicated provider webhook (SPEC §8.9). */
  @Public()
  @SkipCsrf()
  @Post('webhooks/payments/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: AuthedRequest) {
    return this.payments.handleWebhook(provider, req.rawBody, req.headers as Record<string, string | undefined>);
  }

  @Get('invoices')
  invoicesList(@CurrentActor() a: UserActor, @Query(zp(paginationQuery)) q: z.infer<typeof paginationQuery>) {
    return this.invoices.list(a, q.cursor, q.limit);
  }

  @Get('invoices/:id')
  invoice(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(a, id);
  }

  @Get('invoices/:id/download-url')
  invoiceDownload(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.downloadUrl(a, id);
  }
}

/**
 * Hosted-checkout stand-in for MockPaymentProvider (development and staging only). Completing a
 * payment here makes the "gateway" send a signed webhook; the browser result is never trusted.
 */
@Controller('mock-gateway/payments')
export class MockGatewayController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertEnabled() {
    if (this.env.NODE_ENV === 'production' || this.env.PAYMENT_PROVIDER !== 'mock') throw notFound();
  }

  @Public()
  @Get(':providerPaymentId')
  async show(@Param('providerPaymentId') id: string) {
    this.assertEnabled();
    const p = await this.prisma.payment.findFirst({ where: { provider: 'mock', providerPaymentId: id } });
    if (!p) throw notFound();
    return { providerPaymentId: id, amountPaise: num(p.amountPaise), status: p.status, currency: p.currency };
  }

  @Public()
  @RateLimit({ bucket: 'mock-gateway', limit: 30, windowMs: 60_000 })
  @Post(':providerPaymentId/complete')
  @HttpCode(200)
  async complete(@Param('providerPaymentId') id: string, @Body(zp(mockPaymentCompleteSchema)) body: z.infer<typeof mockPaymentCompleteSchema>) {
    this.assertEnabled();
    return this.payments.deliverMockEvent(id, body.outcome === 'SUCCEEDED' ? 'payment.succeeded' : 'payment.failed');
  }
}
