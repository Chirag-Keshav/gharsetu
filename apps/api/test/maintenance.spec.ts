/** SPEC §8.7, §8.8 acceptance criteria and §18.2 scenarios 6, 7 and 8. */
import { istInstant } from '@propcare/shared';
import { createTestContext, isoDay, testJpeg, type TestContext, type TestUser } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const quoteBody = (unitPricePaise: number) => ({
  lineItems: [
    { description: 'Labour for repair', quantity: '1', unit: 'job', unitPricePaise, taxRateBps: 0, lineType: 'LABOUR', direction: 'ADD' },
    { description: 'Fittings', quantity: '2.5', unit: 'pcs', unitPricePaise: 10_001, taxRateBps: 1800, lineType: 'MATERIAL', direction: 'ADD' },
  ],
  scope: 'Repair the leak and test the joint.',
  exclusions: ['Concealed piping'],
  assumptions: [],
});

async function newRequest(owner: TestUser, propertyId: string, overrides: Record<string, unknown> = {}) {
  const cat = await ctx.category('plumbing-leak-repair');
  return owner.client.post(
    '/service-requests',
    {
      propertyId,
      categoryId: cat.id,
      title: 'Leak under kitchen sink',
      description: 'Water collects in the cabinet after the tap is used.',
      intakeAnswers: { water_supply_affected: false, leak_visible: false, leak_location: 'Kitchen sink' },
      ...overrides,
    },
    { 'idempotency-key': `req-${Math.random().toString(36).slice(2)}` },
  );
}

describe('requests (REQ, OPS)', () => {
  it('validates intake, danger rules and serviceability; replays idempotent creates', async () => {
    await ctx.reset();
    const owner = await ctx.owner();
    const property = await ctx.property(owner, { serviceMode: 'CARE' });
    const cat = await ctx.category('plumbing-leak-repair');
    const missing = await owner.client.post('/service-requests', { propertyId: property.id, categoryId: cat.id, title: 'Leak', description: 'Water everywhere in the kitchen.', intakeAnswers: {} });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.map((d: { path: string }) => d.path)).toContain('intakeAnswers.leak_location');

    // An owner cannot lower urgency below the danger rule (SPEC §7 rule 8).
    const danger = await newRequest(owner, property.id, { urgency: 'STANDARD', intakeAnswers: { water_supply_affected: true, leak_visible: true, leak_location: 'Bathroom' } });
    expect(danger.status).toBe(201);
    expect(danger.body.urgency).toBe('SAFETY_RISK');
    expect(danger.body.safetyFlag).toBe(true);
    expect(danger.body.safetyGuidance[0].text).toMatch(/water valve/);
    expect(await ctx.prisma.adminAlert.count({ where: { type: 'SAFETY_FLAGGED_REQUEST' } })).toBe(1);

    const key = { 'idempotency-key': 'same-request-key-1' };
    const body = { propertyId: property.id, categoryId: cat.id, title: 'Tap', description: 'The kitchen tap drips all night.', intakeAnswers: { water_supply_affected: false, leak_visible: false, leak_location: 'Tap' } };
    const a = await owner.client.post('/service-requests', body, key);
    const b = await owner.client.post('/service-requests', body, key);
    expect(b.body.id).toBe(a.body.id);

    // Bengaluru does not offer pest control in the test catalogue.
    const blr = await ctx.property(owner, { serviceMode: 'CARE', pinCode: '560038', city: 'Bengaluru', locality: 'Indiranagar', district: 'Bengaluru Urban', state: 'Karnataka' });
    const pest = await ctx.category('pest-control');
    const outside = await owner.client.post('/service-requests', { propertyId: blr.id, categoryId: pest.id, title: 'Termites', description: 'Termites in the wardrobe since last week.', intakeAnswers: { pest_type: 'termites', hive_or_snake_present: false } });
    expect(outside.body.error.code).toBe('OUT_OF_SERVICE_AREA');
  });

  it('runs the clarification loop and keeps internal notes internal', async () => {
    const owner = await ctx.owner();
    const admin = await ctx.admin();
    const property = await ctx.property(owner, { serviceMode: 'CARE' });
    const req = await newRequest(owner, property.id);
    await admin.client.post(`/service-requests/${req.body.id}/claim`);
    const ask = await admin.client.post(`/service-requests/${req.body.id}/status-transitions`, { to: 'NEEDS_INFORMATION', ownerMessage: 'Please send a photo of the pipe.' });
    expect(ask.body.status).toBe('NEEDS_INFORMATION');
    await admin.client.post(`/service-requests/${req.body.id}/messages`, { body: 'Looks like a loose trap; price low.', visibility: 'INTERNAL' });
    const photo = await owner.client.upload('MESSAGE', await testJpeg(), 'image/jpeg');
    const reply = await owner.client.post(`/service-requests/${req.body.id}/messages`, { body: 'Photo attached.', attachmentIds: [photo] });
    expect(reply.status).toBe(201);
    expect((await owner.client.get(`/service-requests/${req.body.id}`)).body.status).toBe('UNDER_REVIEW');
    const ownerThread = await owner.client.get(`/service-requests/${req.body.id}/messages`);
    expect(ownerThread.body.items.map((m: { body: string }) => m.body)).not.toContain('Looks like a loose trap; price low.');
    const adminThread = await admin.client.get(`/service-requests/${req.body.id}/messages`);
    expect(adminThread.body.items).toHaveLength(3);
    // Owners may not post internal notes.
    expect((await owner.client.post(`/service-requests/${req.body.id}/messages`, { body: 'x', visibility: 'INTERNAL' })).status).toBe(403);
  });
});

describe('quotes and work orders (§18.2 scenarios 6–7)', () => {
  it('binds approval to the version; runs the full work-order lifecycle with coordination and rework', async () => {
    await ctx.reset();
    const owner = await ctx.owner();
    const customer = await ctx.customer();
    const admin1 = await ctx.admin();
    const admin2 = await ctx.admin(['COMPLETION_APPROVE']);
    await ctx.setPolicy('work.require_different_admin', true);
    const listing = await ctx.publishedListing(owner);
    const propertyId = listing.propertyId;

    // A confirmed booking on the property, for the calendar-conflict check.
    const booking = await customer.client.post('/bookings', { listingId: listing.id, checkIn: isoDay(10), checkOut: isoDay(12), guests: 2 }, { 'idempotency-key': 'wo-booking-1' });
    const pay = await customer.client.post(`/bookings/${booking.body.id}/payments`, {}, { 'idempotency-key': 'wo-booking-pay' });
    await ctx.client().post(`/mock-gateway/payments/${pay.body.checkoutUrl.split('/').pop().split('?')[0]}/complete`, { outcome: 'SUCCEEDED' });

    const req = await newRequest(owner, propertyId);
    await admin1.client.post(`/service-requests/${req.body.id}/claim`);
    const v1 = await admin1.client.post(`/service-requests/${req.body.id}/quotes`, quoteBody(180_000));
    expect(v1.body.status).toBe('DRAFT');
    // Owners never see drafts.
    expect((await owner.client.get(`/quotes/${v1.body.id}`)).status).toBe(404);
    // Server-computed totals: 180000 + round(2.5 × 10001 = 25002.5 → 25003) + tax round(25003 × 18 % = 4500.54 → 4501).
    expect(v1.body.subtotalPaise).toBe(205_003);
    expect(v1.body.taxPaise).toBe(4_501);
    expect(v1.body.totalPaise).toBe(209_504);
    expect((await admin1.client.post(`/quotes/${v1.body.id}/send`)).body.status).toBe('SENT');
    // Frozen quotes cannot change — API and database both refuse.
    expect((await admin1.client.patch(`/quotes/${v1.body.id}`, quoteBody(1))).status).toBe(409);
    await expect(ctx.prisma.quote.update({ where: { id: v1.body.id }, data: { totalPaise: 1n } })).rejects.toThrow();
    // Admins cannot approve on an owner's behalf.
    expect((await admin1.client.post(`/quotes/${v1.body.id}/approve`, { version: 1, displayedTotalPaise: 209_504 })).status).toBe(403);

    // Owner asks for a revision; admin sends v2; v1 can no longer be approved.
    const rej = await owner.client.post(`/quotes/${v1.body.id}/reject`, { reason: 'Too expensive', requestRevision: true }, { 'idempotency-key': 'reject-v1-key' });
    expect(rej.body.status).toBe('REJECTED');
    const v2 = await admin1.client.post(`/service-requests/${req.body.id}/quotes`, quoteBody(150_000));
    expect(v2.body.version).toBe(2);
    await admin1.client.post(`/quotes/${v2.body.id}/send`);
    expect((await owner.client.post(`/quotes/${v1.body.id}/approve`, { version: 1, displayedTotalPaise: 209_504 })).body.error.code).toBe('QUOTE_VERSION_STALE');
    expect((await owner.client.post(`/quotes/${v2.body.id}/approve`, { version: 2, displayedTotalPaise: 1 })).body.error.code).toBe('QUOTE_VERSION_STALE');
    const approved = await owner.client.post(`/quotes/${v2.body.id}/approve`, { version: 2, displayedTotalPaise: v2.body.totalPaise }, { 'idempotency-key': 'approve-v2-key' });
    expect(approved.body.status).toBe('APPROVED');
    const decision = await ctx.prisma.quoteDecision.findFirstOrThrow({ where: { quoteId: v2.body.id, decision: 'APPROVED' } });
    expect(decision).toMatchObject({ userId: owner.id, version: 2, idempotencyKey: 'approve-v2-key' });

    // Work order creation is idempotent and only from an approved quote.
    expect((await admin1.client.post('/work-orders', { quoteId: v1.body.id })).status).toBe(409);
    const wo = await admin1.client.post('/work-orders', { quoteId: v2.body.id });
    const again = await admin1.client.post('/work-orders', { quoteId: v2.body.id });
    expect(again.body.id).toBe(wo.body.id);
    expect(wo.body.approvedTotalPaise).toBe(v2.body.totalPaise);

    // Scheduling over the confirmed booking is blocked (§7 rule 11).
    const clash = await admin1.client.post(`/work-orders/${wo.body.id}/schedule`, {
      scheduledStart: istInstant(isoDay(11), '10:00').toISOString(),
      scheduledEnd: istInstant(isoDay(11), '13:00').toISOString(),
    });
    expect(clash.body.error.code).toBe('BOOKING_CONFLICT');
    const sched = await admin1.client.post(`/work-orders/${wo.body.id}/schedule`, {
      scheduledStart: istInstant(isoDay(14), '10:00').toISOString(),
      scheduledEnd: istInstant(isoDay(14), '13:00').toISOString(),
    });
    expect(sched.body.status).toBe('SCHEDULED');
    expect(await ctx.prisma.listingOccupancy.count({ where: { workOrderId: wo.body.id, kind: 'BLOCK_MAINTENANCE' } })).toBe(1);
    // Customers can no longer book the maintenance night.
    const blocked = await customer.client.post('/bookings', { listingId: listing.id, checkIn: isoDay(14), checkOut: isoDay(15), guests: 2 }, { 'idempotency-key': 'blocked-night' });
    expect(blocked.body.error.code).toBe('DATES_UNAVAILABLE');

    // Eligibility: an unverified provider needs ASSIGNMENT_OVERRIDE + reason.
    const pending = await ctx.provider(['plumbing-leak-repair'], { verification: 'PENDING' });
    const good = await ctx.provider(['plumbing-leak-repair']);
    const noOverride = await ctx.admin([]);
    const denied = await noOverride.client.post(`/work-orders/${wo.body.id}/assignments`, { providerId: pending.id, assignmentRole: 'SUPPORT', overrideReason: 'Urgent' });
    expect(denied.body.error.details.map((d: { code: string }) => d.code)).toContain('NOT_VERIFIED');
    const overridden = await admin1.client.post(`/work-orders/${wo.body.id}/assignments`, { providerId: pending.id, assignmentRole: 'SUPPORT', overrideReason: 'Only available crew' });
    expect(overridden.status).toBe(201);
    const assigned = await admin1.client.post(`/work-orders/${wo.body.id}/assignments`, { providerId: good.id, assignmentRole: 'PRIMARY' });
    expect(assigned.body.status).toBe('ASSIGNED');
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'work_order.assigned_with_override' } })).toBe(1);

    // Owners never see provider identities or internal notes.
    const ownerView = await owner.client.get(`/work-orders/${wo.body.id}`);
    expect(ownerView.body.assignments).toBeUndefined();
    expect(JSON.stringify(ownerView.body)).not.toContain(good.name);
    expect(ownerView.body.careTeam).toBe('Care team assigned');

    // Execution recorded on the provider's behalf.
    const src = { providerId: good.id, source: 'PHONE' };
    const visit = await admin1.client.post(`/work-orders/${wo.body.id}/visits`, { ...src, checkedInAt: new Date().toISOString() });
    expect(visit.body.status).toBe('IN_PROGRESS');
    const before = await admin1.client.upload('WORK_ORDER', await testJpeg('#111111'), 'image/jpeg');
    await admin1.client.post(`/work-orders/${wo.body.id}/evidence`, { ...src, attachmentIds: [before], phase: 'BEFORE', capturedAt: new Date().toISOString() });
    // Missing checklist + after evidence blocks submission.
    const early = await admin1.client.post(`/work-orders/${wo.body.id}/submit-for-review`, src);
    expect(early.status).toBe(422);
    const after = await admin1.client.upload('WORK_ORDER', await testJpeg('#eeeeee'), 'image/jpeg');
    await admin1.client.post(`/work-orders/${wo.body.id}/evidence`, { ...src, attachmentIds: [after], phase: 'AFTER', capturedAt: new Date().toISOString() });
    await admin1.client.post(`/work-orders/${wo.body.id}/checklist-results`, {
      ...src,
      results: [
        { itemKey: 'water_shut_off', result: true },
        { itemKey: 'leak_fixed', result: true },
        { itemKey: 'pressure_tested', result: true },
        { itemKey: 'area_cleared', result: true },
        { itemKey: 'after_photos', result: [after] },
      ],
    });
    expect((await admin1.client.post(`/work-orders/${wo.body.id}/submit-for-review`, src)).body.status).toBe('SUBMITTED_FOR_REVIEW');
    // The same admin cannot approve their own submission when the policy requires two people.
    expect((await admin1.client.post(`/work-orders/${wo.body.id}/approve-completion`, {})).status).toBe(403);
    expect((await admin2.client.post(`/work-orders/${wo.body.id}/request-rework`, { reason: 'Joint still damp' })).body.status).toBe('REWORK_REQUIRED');
    await admin1.client.post(`/work-orders/${wo.body.id}/visits`, { ...src, checkedInAt: new Date().toISOString() });
    await admin1.client.post(`/work-orders/${wo.body.id}/submit-for-review`, src);
    expect((await admin2.client.post(`/work-orders/${wo.body.id}/approve-completion`, {})).body.status).toBe('READY_FOR_OWNER_REVIEW');

    // On-behalf audit trail marks every provider-side record.
    const onBehalf = await ctx.prisma.auditEvent.findMany({ where: { entityId: wo.body.id, onBehalfOfType: 'PROVIDER' } });
    expect(onBehalf.length).toBeGreaterThanOrEqual(5);
    expect(onBehalf.every((e) => e.onBehalfOfId === good.id)).toBe(true);
    // Owners see evidence but admins cannot accept for them.
    expect((await owner.client.get(`/work-orders/${wo.body.id}`)).body.evidence).toHaveLength(2);
    expect((await admin1.client.post(`/work-orders/${wo.body.id}/accept`)).status).toBe(403);
    const accepted = await owner.client.post(`/work-orders/${wo.body.id}/accept`);
    expect(accepted.body.status).toBe('COMPLETED');
    expect(await ctx.prisma.listingOccupancy.count({ where: { workOrderId: wo.body.id } })).toBe(0);
    const final = await ctx.prisma.paymentRequirement.findFirstOrThrow({ where: { workOrderId: wo.body.id, purpose: 'FINAL' } });
    expect(final.isDue).toBe(true);
    expect(Number(final.amountPaise)).toBe(v2.body.totalPaise);
    // Statuses are append-only history.
    await expect(ctx.prisma.statusEvent.deleteMany({ where: { entityId: wo.body.id } })).rejects.toThrow();
    await expect(ctx.prisma.auditEvent.updateMany({ data: { action: 'tampered' } })).rejects.toThrow();
  });
});

describe('booking issues (§18.2 scenario 8)', () => {
  it('holds the payout while an issue is open and resolves with a partial refund and payout adjustment', async () => {
    await ctx.reset();
    const owner = await ctx.owner();
    const customer = await ctx.customer();
    const listing = await ctx.publishedListing(owner);
    const b = await customer.client.post('/bookings', { listingId: listing.id, checkIn: isoDay(3), checkOut: isoDay(5), guests: 2 }, { 'idempotency-key': 'issue-booking' });
    const pay = await customer.client.post(`/bookings/${b.body.id}/payments`, {}, { 'idempotency-key': 'issue-pay-1' });
    await ctx.client().post(`/mock-gateway/payments/${pay.body.checkoutUrl.split('/').pop().split('?')[0]}/complete`, { outcome: 'SUCCEEDED' });
    const issue = await customer.client.post(`/bookings/${b.body.id}/issues`, { category: 'CLEANLINESS', description: 'The bathroom was not cleaned before arrival.' });
    expect(issue.status).toBe(201);
    const payout = await ctx.prisma.payout.findUniqueOrThrow({ where: { bookingId: b.body.id } });
    expect(payout.status).toBe('ON_HOLD');
    // Resolving with money requires FINANCE.
    const plain = await ctx.admin([]);
    expect((await plain.client.post(`/issues/${issue.body.id}/resolve`, { resolutionCode: 'PARTIAL_REFUND', internalNote: 'Goodwill', refundPaise: 50_000 })).status).toBe(403);
    const finance = await ctx.admin(['FINANCE']);
    const resolved = await finance.client.post(`/issues/${issue.body.id}/resolve`, {
      resolutionCode: 'PARTIAL_REFUND',
      internalNote: 'Photos confirm the complaint.',
      visibleSummary: 'We refunded ₹500 for the cleaning issue.',
      refundPaise: 50_000,
      payoutAdjustmentPaise: 50_000,
    });
    expect(resolved.body.status).toBe('RESOLVED');
    const after = await ctx.prisma.payout.findUniqueOrThrow({ where: { bookingId: b.body.id } });
    expect(after.status).toBe('PENDING');
    expect(Number(after.amountPaise)).toBe(Number(payout.amountPaise) - 50_000);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { payment: { bookingId: b.body.id } } });
    expect(refund.status).toBe('SUCCEEDED');
    expect((await customer.client.get(`/issues/${issue.body.id}`)).body.internalNote).toBeUndefined();
    expect((await customer.client.get(`/issues/${issue.body.id}`)).body.canReopen).toBe(true);
  });
});
