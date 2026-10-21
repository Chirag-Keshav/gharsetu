/** SPEC §8.5 BKG, §8.9 PAY/PAYO/COM acceptance criteria and §18.2 scenarios 3, 4, 5, 9. */
import { istInstant } from '@propcare/shared';
import { MOCK_SIGNATURE_HEADER } from '../src/adapters/payments';
import { createTestContext, isoDay, type Client, type TestContext, type TestUser } from './helpers';

let ctx: TestContext;
let owner: TestUser;
beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(async () => {
  await ctx.reset();
  ctx.clock.set(new Date());
  owner = await ctx.owner();
});
afterAll(() => ctx.close());

async function book(c: Client, listingId: string, checkIn: string, checkOut: string, key = `k-${Math.random().toString(36).slice(2)}`) {
  return c.post('/bookings', { listingId, checkIn, checkOut, guests: 2 }, { 'idempotency-key': key });
}

async function payAndConfirm(c: Client, bookingId: string) {
  const pay = await c.post(`/bookings/${bookingId}/payments`, {}, { 'idempotency-key': `pay-${bookingId}` });
  expect(pay.status).toBe(201);
  const providerPaymentId = pay.body.checkoutUrl.split('/').pop().split('?')[0];
  const res = await ctx.client().post(`/mock-gateway/payments/${providerPaymentId}/complete`, { outcome: 'SUCCEEDED' });
  expect(res.body.result).toBe('APPLIED');
  return providerPaymentId as string;
}

describe('price quotes and booking creation', () => {
  it('quotes the same price that is charged and snapshots commission (Appendix A.3)', async () => {
    const listing = await ctx.publishedListing(owner);
    const customer = await ctx.customer();
    // Find the next Thursday at least 3 days out so the quote covers Thu/Fri/Sat nights.
    let offset = 3;
    while (new Date(`${isoDay(offset)}T00:00:00Z`).getUTCDay() !== 4) offset++;
    const checkIn = isoDay(offset);
    const checkOut = isoDay(offset + 3);
    const quote = await ctx.client().post(`/public/listings/${listing.id}/price-quote`, { checkIn, checkOut, guests: 2 });
    expect(quote.status).toBe(200);
    expect(quote.body.nights.map((n: { basis: string }) => n.basis)).toEqual(['BASE', 'WEEKEND', 'WEEKEND']);
    expect(quote.body.totalPaise).toBe(400000 + 500000 + 500000 + 100000);
    expect(quote.body).not.toHaveProperty('commissionPaise');

    const b = await book(customer.client, listing.id, checkIn, checkOut);
    expect(b.status).toBe(201);
    expect(b.body.status).toBe('AWAITING_PAYMENT');
    expect(b.body.totalPaise).toBe(quote.body.totalPaise);
    expect(b.body.exactAddress).toBeNull();
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.body.id } });
    expect(row.commissionBpsApplied).toBe(1395);
    expect(Number(row.commissionPaise)).toBe(209_250);
    expect(Number(row.ownerPayoutPaise)).toBe(1_290_750);

    // Changing the listing price later never changes the booking (SPEC §8.5 AC).
    await owner.client.patch(`/listings/${listing.id}`, { basePricePaise: 999_900 });
    const again = await customer.client.get(`/bookings/${b.body.id}`);
    expect(again.body.totalPaise).toBe(1_500_000);
    // ...and the database refuses to alter the snapshot.
    await expect(ctx.prisma.booking.update({ where: { id: b.body.id }, data: { totalPaise: 1n } })).rejects.toThrow();
  });

  it('validates nights, guests, notice and the booking window', async () => {
    const listing = await ctx.publishedListing(owner, { minNights: 2, maxGuests: 2 });
    const res = await ctx.client().post(`/public/listings/${listing.id}/price-quote`, { checkIn: isoDay(5), checkOut: isoDay(6), guests: 3 });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { code: string }) => d.code).sort()).toEqual(['MIN_NIGHTS', 'TOO_MANY_GUESTS']);
    const soon = await ctx.client().post(`/public/listings/${listing.id}/price-quote`, { checkIn: isoDay(0), checkOut: isoDay(2), guests: 1 });
    expect(soon.body.error.details.map((d: { code: string }) => d.code)).toContain('ADVANCE_NOTICE');
  });

  it('replays the original response for the same Idempotency-Key', async () => {
    const listing = await ctx.publishedListing(owner);
    const customer = await ctx.customer();
    const a = await book(customer.client, listing.id, isoDay(10), isoDay(12), 'same-key-123');
    const b = await book(customer.client, listing.id, isoDay(10), isoDay(12), 'same-key-123');
    expect(b.status).toBe(a.status);
    expect(b.body.id).toBe(a.body.id);
    expect(await ctx.prisma.booking.count()).toBe(1);
    const reused = await customer.client.post('/bookings', { listingId: listing.id, checkIn: isoDay(20), checkOut: isoDay(22), guests: 2 }, { 'idempotency-key': 'same-key-123' });
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('availability integrity', () => {
  it('lets exactly one of N parallel bookings for the same dates win (§18.2 scenario 4)', async () => {
    const listing = await ctx.publishedListing(owner);
    const customers = await Promise.all(Array.from({ length: 6 }, () => ctx.customer()));
    const results = await Promise.all(customers.map((c) => book(c.client, listing.id, isoDay(14), isoDay(17))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'DATES_UNAVAILABLE')).toBe(true);
    expect(await ctx.prisma.listingOccupancy.count({ where: { listingId: listing.id } })).toBe(1);
  });

  it('allows check-out-day turnover and filters search by availability', async () => {
    const listing = await ctx.publishedListing(owner);
    const a = await ctx.customer();
    const b = await ctx.customer();
    expect((await book(a.client, listing.id, isoDay(20), isoDay(23))).status).toBe(201);
    // A stay ending on a date allows another starting that date.
    expect((await book(b.client, listing.id, isoDay(23), isoDay(25))).status).toBe(201);
    const overlapping = await ctx.client().get(`/public/listings?checkIn=${isoDay(22)}&checkOut=${isoDay(24)}`);
    expect(overlapping.body.items.map((i: { id: string }) => i.id)).not.toContain(listing.id);
    const free = await ctx.client().get(`/public/listings?checkIn=${isoDay(25)}&checkOut=${isoDay(27)}`);
    expect(free.body.items.map((i: { id: string }) => i.id)).toContain(listing.id);
  });

  it('releases dates when a hold expires and handles late payments (re-acquire or refund + alert)', async () => {
    const listing = await ctx.publishedListing(owner);
    const first = await ctx.customer();
    const b1 = await book(first.client, listing.id, isoDay(30), isoDay(32));
    const pay = await first.client.post(`/bookings/${b1.body.id}/payments`, {}, { 'idempotency-key': 'late-key-1' });
    const ppid = pay.body.checkoutUrl.split('/').pop().split('?')[0];

    ctx.clock.advance(16 * 60_000);
    const { BookingsService } = await import('../src/modules/bookings/bookings.service');
    await ctx.app.get(BookingsService).expireHolds();
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b1.body.id } })).status).toBe('EXPIRED');

    // Dates are still free: the late payment re-acquires them.
    const late = await ctx.client().post(`/mock-gateway/payments/${ppid}/complete`, { outcome: 'SUCCEEDED' });
    expect(late.body.result).toBe('APPLIED');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b1.body.id } })).status).toBe('CONFIRMED');

    // Second case: dates taken by someone else before the late payment lands.
    const second = await ctx.customer();
    const b2 = await book(second.client, listing.id, isoDay(40), isoDay(42));
    const pay2 = await second.client.post(`/bookings/${b2.body.id}/payments`, {}, { 'idempotency-key': 'late-key-2' });
    const ppid2 = pay2.body.checkoutUrl.split('/').pop().split('?')[0];
    ctx.clock.advance(16 * 60_000);
    const third = await ctx.customer();
    expect((await book(third.client, listing.id, isoDay(40), isoDay(42))).status).toBe(201);
    await ctx.client().post(`/mock-gateway/payments/${ppid2}/complete`, { outcome: 'SUCCEEDED' });
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b2.body.id } })).status).toBe('EXPIRED');
    const refunds = await ctx.prisma.refund.findMany({ where: { payment: { bookingId: b2.body.id } } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].status).toBe('SUCCEEDED');
    expect(await ctx.prisma.adminAlert.count({ where: { type: 'LATE_PAYMENT_DATES_TAKEN', entityId: b2.body.id } })).toBe(1);
  });

  it('requires owner approval, re-checks availability and creates the hold only on approval', async () => {
    const listing = await ctx.publishedListing(owner, { bookingMode: 'OWNER_APPROVAL' });
    const customer = await ctx.customer();
    const b = await book(customer.client, listing.id, isoDay(10), isoDay(12));
    expect(b.body.status).toBe('REQUESTED');
    expect(await ctx.prisma.listingOccupancy.count()).toBe(0);
    // The owner sees the first name and a masked phone only.
    const ownerView = await owner.client.get(`/bookings/${b.body.id}`);
    expect(ownerView.body.guest.phone).toMatch(/••••/);
    expect((await customer.client.post(`/bookings/${b.body.id}/payments`, {}, { 'idempotency-key': 'early-key-1' })).status).toBe(409);
    const approved = await owner.client.post(`/bookings/${b.body.id}/approve`, {}, { 'idempotency-key': 'approve-key-1' });
    expect(approved.body.status).toBe('AWAITING_PAYMENT');
    expect(await ctx.prisma.listingOccupancy.count({ where: { kind: 'BOOKING_HOLD' } })).toBe(1);
  });
});

describe('payments and webhooks', () => {
  it('creates exactly one succeeded payment when a webhook is delivered twice (§18.2 scenario 9)', async () => {
    const listing = await ctx.publishedListing(owner);
    const customer = await ctx.customer();
    const b = await book(customer.client, listing.id, isoDay(10), isoDay(12));
    const pay = await customer.client.post(`/bookings/${b.body.id}/payments`, {}, { 'idempotency-key': 'dup-key-1' });
    const ppid = pay.body.checkoutUrl.split('/').pop().split('?')[0];
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { providerPaymentId: ppid } });
    const { body, headers } = ctx.payments.buildEvent({ type: 'payment.succeeded', providerPaymentId: ppid, amountPaise: Number(payment.amountPaise), eventId: 'evt_dup_1' });
    const send = () => ctx.client().agent.post('/api/v1/webhooks/payments/mock').set('content-type', 'application/json').set(headers).send(body);
    const [r1, r2] = [await send(), await send()];
    expect(r1.body.duplicate).toBe(false);
    expect(r2.body.duplicate).toBe(true);
    expect(await ctx.prisma.payment.count({ where: { bookingId: b.body.id, status: 'SUCCEEDED' } })).toBe(1);
    expect(await ctx.prisma.payout.count({ where: { bookingId: b.body.id } })).toBe(1);

    // A failure event arriving out of order after the success is ignored.
    const failed = ctx.payments.buildEvent({ type: 'payment.failed', providerPaymentId: ppid, amountPaise: Number(payment.amountPaise), eventId: 'evt_dup_2' });
    const r3 = await ctx.client().agent.post('/api/v1/webhooks/payments/mock').set('content-type', 'application/json').set(failed.headers).send(failed.body);
    expect(r3.body.result).toBe('IGNORED_NOT_PENDING');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.body.id } })).status).toBe('CONFIRMED');
  });

  it('rejects webhooks with a bad signature and never confirms without one', async () => {
    const listing = await ctx.publishedListing(owner);
    const customer = await ctx.customer();
    const b = await book(customer.client, listing.id, isoDay(10), isoDay(12));
    const pay = await customer.client.post(`/bookings/${b.body.id}/payments`, {}, { 'idempotency-key': 'sig-key-1' });
    const ppid = pay.body.checkoutUrl.split('/').pop().split('?')[0];
    const forged = JSON.stringify({ eventId: 'evt_forged', type: 'payment.succeeded', providerPaymentId: ppid, amountPaise: 1, occurredAt: new Date().toISOString() });
    const res = await ctx.client().agent.post('/api/v1/webhooks/payments/mock').set('content-type', 'application/json').set(MOCK_SIGNATURE_HEADER, 'deadbeef').send(forged);
    expect(res.status).toBe(401);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.body.id } })).status).toBe('AWAITING_PAYMENT');
  });

  it('reveals the exact address only after confirmation and access details only near check-in', async () => {
    const listing = await ctx.publishedListing(owner);
    const customer = await ctx.customer();
    const b = await book(customer.client, listing.id, isoDay(5), isoDay(7));
    await payAndConfirm(customer.client, b.body.id);
    const view = await customer.client.get(`/bookings/${b.body.id}`);
    expect(view.body.status).toBe('CONFIRMED');
    expect(view.body.exactAddress.line1).toBe('12 Secret Lane');
    expect(view.body.checkinInstructions).toBeNull();
    ctx.clock.set(new Date(istInstant(isoDay(5), '14:00').getTime() - 20 * 3_600_000));
    const near = await customer.client.get(`/bookings/${b.body.id}`);
    expect(near.body.checkinInstructions).toBe('Door code 4242');
    // Owner phone is never shown to customers.
    expect(JSON.stringify(near.body)).not.toContain(owner.phone);
  });
});

describe('cancellation, refunds and payouts', () => {
  async function confirmedBooking(policy = 'MODERATE') {
    const listing = await ctx.publishedListing(owner, { cancellationPolicyKey: policy });
    const customer = await ctx.customer();
    const b = await book(customer.client, listing.id, isoDay(20), isoDay(23));
    await payAndConfirm(customer.client, b.body.id);
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.body.id } });
    return { customer, booking: row };
  }

  it.each([
    [121, 10_000],
    [120, 10_000],
    [119, 5_000],
    [48, 5_000],
    [47, 0],
  ])('refunds the policy tier when cancelling %i h before check-in (§18.2 scenario 5)', async (hours, bps) => {
    const { customer, booking } = await confirmedBooking();
    ctx.clock.set(new Date(booking.checkInAt.getTime() - hours * 3_600_000));
    const preview = await customer.client.get(`/bookings/${booking.id}/cancellation-preview`);
    expect(preview.body.refundBps).toBe(bps);
    const res = await customer.client.post(`/bookings/${booking.id}/cancel`, { reason: 'Plans changed' }, { 'idempotency-key': `cancel-key-${hours}` });
    expect(res.body.status).toBe('CANCELLED');
    const total = Number(booking.totalPaise);
    expect(res.body.refundPaise).toBe(Math.round((total * bps) / 10_000));
    const after = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { payout: true } });
    const retained = total - res.body.refundPaise;
    expect(Number(after.commissionPaise)).toBe(Math.round((retained * 1395) / 10_000));
    if (bps === 10_000) expect(after.payout!.status).toBe('VOID');
    else expect(Number(after.payout!.amountPaise)).toBe(retained - Number(after.commissionPaise));
    // Dates are released.
    expect(await ctx.prisma.listingOccupancy.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('gives a full refund when the owner cancels', async () => {
    const { booking } = await confirmedBooking('STRICT');
    ctx.clock.set(new Date(booking.checkInAt.getTime() - 2 * 3_600_000));
    const res = await owner.client.post(`/bookings/${booking.id}/cancel`, { reason: 'Burst pipe' }, { 'idempotency-key': 'owner-cancel-key' });
    expect(res.body.refundPaise).toBe(Number(booking.totalPaise));
  });

  it('moves payouts to ELIGIBLE after check-in + delay and requires FINANCE to mark paid', async () => {
    const { booking } = await confirmedBooking();
    ctx.clock.set(new Date(booking.checkInAt.getTime() + 25 * 3_600_000));
    const { PayoutsService } = await import('../src/modules/payouts/payouts.service');
    await ctx.app.get(PayoutsService).runEligibility();
    const payout = await ctx.prisma.payout.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payout.status).toBe('ELIGIBLE');
    const noFinance = await ctx.admin(['LISTING_REVIEW']);
    expect((await noFinance.client.post(`/admin/payouts/${payout.id}/mark-paid`, { paymentReference: 'UTR1' })).status).toBe(403);
    const finance = await ctx.admin(['FINANCE']);
    const paid = await finance.client.post(`/admin/payouts/${payout.id}/mark-paid`, { paymentReference: 'UTR1' }, { 'idempotency-key': 'paid-key-1' });
    expect(paid.body.status).toBe('PAID');
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'payout.paid', entityId: payout.id } })).toBe(1);
  });

  it('requires a second FINANCE admin above the dual-approval threshold', async () => {
    await ctx.setPolicy('payout.dual_approval_threshold_paise', 100);
    const { booking } = await confirmedBooking();
    const payout = await ctx.prisma.payout.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(payout.requiresDualApproval).toBe(true);
    await ctx.prisma.payout.update({ where: { id: payout.id }, data: { status: 'ELIGIBLE' } });
    const f1 = await ctx.admin(['FINANCE']);
    const f2 = await ctx.admin(['FINANCE']);
    expect((await f1.client.post(`/admin/payouts/${payout.id}/mark-paid`, { paymentReference: 'X' })).body.error.details[0].code).toBe('SECOND_APPROVAL_REQUIRED');
    await f1.client.post(`/admin/payouts/${payout.id}/approve`);
    expect((await f1.client.post(`/admin/payouts/${payout.id}/mark-paid`, { paymentReference: 'X' })).status).toBe(403);
    expect((await f2.client.post(`/admin/payouts/${payout.id}/mark-paid`, { paymentReference: 'X' })).body.status).toBe('PAID');
  });
});

describe('isolation', () => {
  it('keeps bookings private between customers and owners', async () => {
    const listing = await ctx.publishedListing(owner);
    const a = await ctx.customer();
    const b = await ctx.customer();
    const otherOwner = await ctx.owner();
    const booking = await book(a.client, listing.id, isoDay(10), isoDay(12));
    expect((await b.client.get(`/bookings/${booking.body.id}`)).status).toBe(404);
    expect((await otherOwner.client.get(`/bookings/${booking.body.id}`)).status).toBe(404);
    expect((await owner.client.get(`/bookings/${booking.body.id}`)).status).toBe(200);
    expect((await b.client.get('/bookings')).body.items).toHaveLength(0);
    expect((await otherOwner.client.post(`/bookings/${booking.body.id}/cancel`, {})).status).toBe(404);
  });
});
