/** Cross-cutting contracts: enums, brand rule, notifications, admin flags and policy settings. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as Prisma from '@prisma/client';
import * as shared from '@propcare/shared';
import { createTestContext, isoDay, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('shared enums mirror the database enums', () => {
  const pairs: Array<[string, readonly string[]]> = [
    ['Role', shared.ROLES],
    ['ServiceMode', shared.SERVICE_MODES],
    ['ListingStatus', shared.LISTING_STATUSES],
    ['BookingStatus', shared.BOOKING_STATUSES],
    ['RequestStatus', shared.REQUEST_STATUSES],
    ['QuoteStatus', shared.QUOTE_STATUSES],
    ['WorkOrderStatus', shared.WORK_ORDER_STATUSES],
    ['PayoutStatus', shared.PAYOUT_STATUSES],
    ['IssueStatus', shared.ISSUE_STATUSES],
    ['OccupancyKind', shared.OCCUPANCY_KINDS],
    ['Urgency', shared.URGENCIES],
    ['LineType', shared.LINE_TYPES],
    ['AttachmentOwnerType', shared.ATTACHMENT_OWNER_TYPES],
    ['ResolutionCode', shared.RESOLUTION_CODES],
    ['BlockedReason', shared.BLOCKED_REASONS],
  ];
  it.each(pairs)('%s', (name, values) => {
    const dbEnum = (Prisma as unknown as Record<string, Record<string, string>>)[name];
    expect(Object.values(dbEnum).sort()).toEqual([...values].sort());
  });
});

describe('brand rule (SPEC §0.2)', () => {
  it('has no hard-coded product name outside the brand config', () => {
    const script = path.resolve(__dirname, '../../../scripts/check-brand.mjs');
    expect(() => execFileSync(process.execPath, [script], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('notifications (SPEC §16)', () => {
  it('fans out once even when an outbox event is redelivered, and keeps access details out', async () => {
    await ctx.reset();
    const owner = await ctx.owner();
    const customer = await ctx.customer();
    const listing = await ctx.publishedListing(owner);
    const b = await customer.client.post('/bookings', { listingId: listing.id, checkIn: isoDay(4), checkOut: isoDay(6), guests: 2 }, { 'idempotency-key': 'notify-booking-1' });
    const pay = await customer.client.post(`/bookings/${b.body.id}/payments`, {}, { 'idempotency-key': 'notify-pay-1' });
    await ctx.client().post(`/mock-gateway/payments/${pay.body.checkoutUrl.split('/').pop().split('?')[0]}/complete`, { outcome: 'SUCCEEDED' });
    await ctx.drainOutbox();
    const count = await ctx.prisma.notification.count();
    expect(count).toBeGreaterThan(0);
    // Simulate a redelivery of every event.
    await ctx.prisma.outboxEvent.updateMany({ data: { dispatchedAt: null, nextAttemptAt: new Date(0) } });
    await ctx.drainOutbox();
    expect(await ctx.prisma.notification.count()).toBe(count);
    const confirmed = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: customer.id, templateKey: 'booking.confirmed', channel: 'IN_APP' } });
    expect(JSON.stringify(confirmed.params)).not.toMatch(/Secret Lane|Door code|Key under/);
    const sms = ctx.sms.sent.filter((m) => m.to === customer.phone && m.template === 'notification');
    expect(sms.length).toBeGreaterThan(0);
    for (const m of sms) expect(m.body).not.toMatch(/Secret Lane|Door code|403509/);
    const inbox = await customer.client.get('/notifications');
    expect(inbox.body.items.map((n: { title: string }) => n.title)).toContain('Booking confirmed');
    expect(inbox.body.unread).toBeGreaterThan(0);
  });
});

describe('admin permissions and policy settings', () => {
  it('guards admin capabilities with flags and marks placeholders as unconfirmed', async () => {
    const plain = await ctx.admin([]);
    const userAdmin = await ctx.admin(['USER_ADMIN']);
    expect((await plain.client.get('/admin/audit-events')).status).toBe(403);
    expect((await plain.client.post('/admin/staff', { phone: '9123456780', fullName: 'New Admin', flags: ['FINANCE'] })).status).toBe(403);
    const created = await userAdmin.client.post('/admin/staff', { phone: '9123456780', fullName: 'New Admin', flags: ['FINANCE'] });
    expect(created.status).toBe(201);
    const settings = await plain.client.get('/admin/policy-settings');
    const undercut = settings.body.items.find((i: { key: string }) => i.key === 'commission.undercut_bps');
    expect(undercut).toMatchObject({ value: 1000, unconfirmed: true, editFlag: 'FINANCE' });
    // Commission keys need FINANCE; decisions are not editable; values are validated.
    expect((await userAdmin.client.patch('/admin/policy-settings/commission.undercut_bps', { value: 1500 })).status).toBe(403);
    const finance = await ctx.admin(['FINANCE']);
    expect((await finance.client.patch('/admin/policy-settings/commission.undercut_bps', { value: 1500 })).body.value).toBe(1500);
    expect((await finance.client.get('/admin/commission/effective')).body.current.appliedBps).toBe(1318);
    expect((await finance.client.patch('/admin/policy-settings/commission.undercut_bps', { value: -5 })).status).toBe(422);
    expect((await userAdmin.client.patch('/admin/policy-settings/booking.payment_policy', { value: 'FULL_UPFRONT' })).status).toBe(403);
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'policy.updated', entityId: 'commission.undercut_bps' } })).toBe(1);
    // Owners and customers never reach the admin console.
    const owner = await ctx.owner();
    expect((await owner.client.get('/admin/dashboard')).status).toBe(403);
  });
});
