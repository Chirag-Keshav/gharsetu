/**
 * PaymentProvider adapter (SPEC §5, §8.9). The real provider is Business-pending; MockPaymentProvider
 * mimics a hosted checkout plus signed webhooks so the full flow (including dedup and out-of-order
 * delivery) is exercised. Raw card data and UPI PINs never touch this system.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hmac, safeEqual, sha256 } from '../core/crypto';

export interface CreatePaymentInput {
  amountPaise: number;
  reference: string;
  idempotencyKey: string;
  returnPath: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  checkoutUrl: string;
}

export const webhookEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  type: z.enum(['payment.succeeded', 'payment.failed', 'refund.succeeded', 'refund.failed']),
  providerPaymentId: z.string().min(1).max(200),
  amountPaise: z.number().int().min(0),
  providerRefundId: z.string().max(200).optional(),
  occurredAt: z.string().datetime(),
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export interface RefundResult {
  providerRefundId: string;
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Verifies the signature and parses the event; throws on any mismatch. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookEvent;
  refund(input: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }): Promise<RefundResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  /** Tests can force refund failures to exercise alerting and retries. */
  failRefunds = false;

  constructor(private readonly webhookSecret: string) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerPaymentId = `mock_pay_${randomBytes(9).toString('base64url')}`;
    const params = new URLSearchParams({ ref: input.reference, return: input.returnPath });
    return { providerPaymentId, checkoutUrl: `/pay/mock/${providerPaymentId}?${params.toString()}` };
  }

  sign(rawBody: string): string {
    return hmac(this.webhookSecret, rawBody);
  }

  /** Builds a signed webhook delivery, as the mock gateway would send it. */
  buildEvent(event: Omit<WebhookEvent, 'eventId' | 'occurredAt'> & { eventId?: string; occurredAt?: string }) {
    const full: WebhookEvent = {
      eventId: event.eventId ?? `evt_${randomBytes(9).toString('base64url')}`,
      type: event.type,
      providerPaymentId: event.providerPaymentId,
      amountPaise: event.amountPaise,
      ...(event.providerRefundId ? { providerRefundId: event.providerRefundId } : {}),
      occurredAt: event.occurredAt ?? new Date().toISOString(),
    };
    const body = JSON.stringify(full);
    return { body, headers: { [MOCK_SIGNATURE_HEADER]: this.sign(body) } };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookEvent {
    const signature = headers[MOCK_SIGNATURE_HEADER];
    if (!signature || !safeEqual(signature, this.sign(rawBody.toString('utf8')))) throw new Error('INVALID_SIGNATURE');
    return webhookEventSchema.parse(JSON.parse(rawBody.toString('utf8')));
  }

  async refund(input: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }): Promise<RefundResult> {
    if (this.failRefunds) return { providerRefundId: '', status: 'FAILED' };
    return { providerRefundId: `mock_rf_${sha256(input.idempotencyKey).slice(0, 16)}`, status: 'SUCCEEDED' };
  }
}
