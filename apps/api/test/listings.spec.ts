/** SPEC §8.2, §8.3, §8.4 acceptance criteria and §18.2 scenarios 1, 2 and 10. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { findRepoRoot } from '../src/config/env';
import { createTestContext, testJpeg, type TestContext, type TestUser } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const FORBIDDEN_PUBLIC = ['addressLine1', 'accessNotes', 'checkinInstructions', 'ownerUserId', 'phone', 'pinCode', '12 Secret Lane', 'Key under the blue pot', 'Door code'];

async function completeListing(owner: TestUser, propertyId: string) {
  const created = await owner.client.post(`/properties/${propertyId}/listing`);
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  await owner.client.patch(`/listings/${id}`, {
    title: 'Bright villa with a garden pool',
    description: 'A calm four-bedroom villa with a pool and garden, five minutes from the beach. '.repeat(2),
    maxGuests: 6,
    bedrooms: 3,
    beds: 3,
    bathrooms: 2,
    basePricePaise: 600_000,
    cleaningFeePaise: 50_000,
    checkinInstructions: 'Door code 9911',
    houseRules: { petsAllowed: false, smokingAllowed: false, eventsAllowed: false, quietHours: '22:00-07:00' },
  });
  const amenities = await ctx.client().get('/amenities');
  await owner.client.put(`/listings/${id}/amenities`, { amenityIds: amenities.body.items.slice(0, 3).map((a: { id: string }) => a.id) });
  for (let i = 0; i < 5; i++) {
    const att = await owner.client.upload('LISTING', await testJpeg(`#${(i * 3 + 1).toString(16).repeat(6)}`), 'image/jpeg', { ownerId: id, filename: `p${i}.jpg` });
    expect((await owner.client.post(`/listings/${id}/photos`, { attachmentId: att, caption: `Photo ${i}` })).status).toBe(201);
  }
  return id;
}

async function submitVerification(owner: TestUser, propertyId: string) {
  const pdf = Buffer.from('%PDF-1.4\n% test document\n');
  const idDoc = await owner.client.upload('VERIFICATION', pdf, 'application/pdf', { filename: 'id.pdf' });
  const deed = await owner.client.upload('VERIFICATION', pdf, 'application/pdf', { filename: 'deed.pdf' });
  const res = await owner.client.post(`/properties/${propertyId}/verification`, {
    ownerDocuments: [{ docType: 'GOVERNMENT_ID', attachmentId: idDoc }],
    propertyDocuments: [{ docType: 'TITLE_OR_SALE_DEED', attachmentId: deed }],
  });
  expect(res.status).toBe(201);
  return { idDoc, deed };
}

describe('owner onboarding and listing review (§18.2 scenarios 1–2)', () => {
  it('runs wizard → verification → submit → changes requested → fix → publish, and keeps private data private', async () => {
    await ctx.reset();
    const owner = await ctx.owner({ ownerVerified: false });
    const admin = await ctx.admin();
    const property = await ctx.property(owner);
    const listingId = await completeListing(owner, property.id);

    // Cannot submit before verification documents are submitted.
    const early = await owner.client.post(`/listings/${listingId}/submit`);
    expect(early.body.error.details[0].code).toBe('VERIFICATION_DOCUMENTS_REQUIRED');
    const docs = await submitVerification(owner, property.id);
    // Documents come back to the owner only as receipts, never as downloads.
    expect((await owner.client.get(`/attachments/${docs.deed}/download-url`)).status).toBe(404);
    const status = await owner.client.get(`/properties/${property.id}/verification`);
    expect(status.body.property.status).toBe('PENDING');
    expect(JSON.stringify(status.body)).not.toContain('objectKey');

    expect((await owner.client.post(`/listings/${listingId}/submit`)).body.status).toBe('SUBMITTED');
    // Not public yet.
    expect((await ctx.client().get(`/public/listings/${listingId}`)).status).toBe(404);

    // Publish gate: verification still pending.
    const blocked = await admin.client.post(`/admin/listings/${listingId}/publish`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['OWNER_NOT_VERIFIED', 'PROPERTY_NOT_VERIFIED']));

    // AI review assistant summary is available to the admin.
    const ai = await admin.client.post('/ai/suggestions', { featureKey: 'listing_review', subjectType: 'LISTING', subjectId: listingId });
    expect(ai.status).toBe(201);

    // Admin downloads of verification documents are signed and audited.
    expect((await admin.client.get(`/attachments/${docs.deed}/download-url`)).body.url).toContain('/storage/download?');
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'document.accessed', entityId: docs.deed } })).toBe(1);

    const queue = await admin.client.get('/admin/verifications');
    for (const v of queue.body.items) expect((await admin.client.post(`/admin/verifications/${v.id}/approve`, {})).body.status).toBe('APPROVED');

    const changes = await admin.client.post(`/admin/listings/${listingId}/request-changes`, { message: 'Please add a photo of the bathroom.' });
    expect(changes.body.status).toBe('CHANGES_REQUESTED');
    const messages = await owner.client.get(`/listings/${listingId}/review-messages`);
    expect(messages.body.items[0].body).toContain('bathroom');
    const extra = await owner.client.upload('LISTING', await testJpeg('#777777'), 'image/jpeg', { ownerId: listingId });
    await owner.client.post(`/listings/${listingId}/photos`, { attachmentId: extra, caption: 'Bathroom' });
    expect((await owner.client.post(`/listings/${listingId}/submit`)).body.status).toBe('SUBMITTED');
    expect((await admin.client.post(`/admin/listings/${listingId}/publish`)).body.status).toBe('PUBLISHED');
    await ctx.drainOutbox();

    // Public contract: no private fields, photos only as public variants without EXIF.
    const pub = await ctx.client().get(`/public/listings/${listingId}`);
    expect(pub.status).toBe(200);
    const text = JSON.stringify(pub.body);
    for (const f of FORBIDDEN_PUBLIC) expect(text).not.toContain(f);
    expect(pub.body.photos).toHaveLength(6);
    expect(pub.body.approxLatitude).toBe(15.58);
    const variantUrl: string = pub.body.photos[0].variants.sm.url;
    const variantFile = path.join(findRepoRoot(), '.data/test-storage/public', variantUrl.replace('/media/', ''));
    // Read with Node (long-path aware) and give sharp the bytes.
    const meta = await sharp(readFileSync(variantFile)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('webp');
    const media = await ctx.client().agent.get(variantUrl);
    expect(media.status).toBe(200);

    const search = await ctx.client().get('/public/listings?q=anjuna');
    expect(search.body.items.map((i: { id: string }) => i.id)).toContain(listingId);
    for (const f of FORBIDDEN_PUBLIC) expect(JSON.stringify(search.body)).not.toContain(f);

    // Owner pauses: public copies are removed and search no longer returns it.
    expect((await owner.client.post(`/listings/${listingId}/pause`)).body.status).toBe('PAUSED');
    await ctx.drainOutbox();
    expect((await ctx.client().get(`/public/listings/${listingId}`)).status).toBe(404);
    expect((await ctx.client().get('/public/listings?q=anjuna')).body.items).toHaveLength(0);
    expect((await ctx.client().agent.get(variantUrl)).status).toBe(404);
    expect((await owner.client.post(`/listings/${listingId}/resume`)).body.status).toBe('PUBLISHED');

    // Admin pause can only be lifted by an admin.
    await admin.client.post(`/admin/listings/${listingId}/pause`, { message: 'Complaint under review' });
    expect((await owner.client.post(`/listings/${listingId}/resume`)).status).toBe(403);
    expect((await admin.client.post(`/admin/listings/${listingId}/resume`)).body.status).toBe('PUBLISHED');

    // Content edits on a live listing go to the post-moderation queue.
    await owner.client.patch(`/listings/${listingId}`, { title: 'Bright villa with pool and garden' });
    const edited = await admin.client.get('/admin/listings?edited=true');
    expect(edited.body.items.map((i: { id: string }) => i.id)).toContain(listingId);

    // A material location change forces re-review.
    await owner.client.patch(`/properties/${property.id}`, { pinCode: '403516', locality: 'Calangute' });
    expect((await owner.client.get(`/listings/${listingId}`)).body.status).toBe('SUBMITTED');
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'property.updated', entityId: property.id } })).toBeGreaterThan(0);
    const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { action: 'property.updated', entityId: property.id } });
    expect(JSON.stringify(audit.metadata)).not.toContain('Key under');
  });

  it('enforces service-mode rules for listings and requests (§3.2)', async () => {
    const owner = await ctx.owner();
    const care = await ctx.property(owner, { serviceMode: 'CARE' });
    expect((await owner.client.post(`/properties/${care.id}/listing`)).body.error.details[0].code).toBe('MODE_EXCLUDES_LIST');
    const list = await ctx.property(owner, { serviceMode: 'LIST' });
    const cat = await ctx.category('plumbing-leak-repair');
    const req = await owner.client.post('/service-requests', {
      propertyId: list.id,
      categoryId: cat.id,
      title: 'Leak',
      description: 'A leak under the sink for two days.',
      intakeAnswers: { water_supply_affected: false, leak_visible: false, leak_location: 'Kitchen' },
    });
    expect(req.body.error.details[0].code).toBe('MODE_EXCLUDES_CARE');
  });
});

describe('isolation between owners (§18.1 object-level authorisation)', () => {
  it('returns 404 for another owner’s property, listing, attachments and calendar', async () => {
    const a = await ctx.owner();
    const b = await ctx.owner();
    const prop = await ctx.property(a);
    const listing = await a.client.post(`/properties/${prop.id}/listing`);
    const att = await a.client.upload('PROPERTY', await testJpeg(), 'image/jpeg', { ownerId: prop.id });
    expect((await b.client.get(`/properties/${prop.id}`)).status).toBe(404);
    expect((await b.client.patch(`/properties/${prop.id}`, { nickname: 'mine' })).status).toBe(404);
    expect((await b.client.get(`/listings/${listing.body.id}`)).status).toBe(404);
    expect((await b.client.patch(`/listings/${listing.body.id}`, { title: 'x' })).status).toBe(404);
    expect((await b.client.get(`/listings/${listing.body.id}/calendar?from=2026-11-01&to=2026-11-30`)).status).toBe(404);
    expect((await b.client.get(`/attachments/${att}/download-url`)).status).toBe(404);
    expect((await a.client.get(`/attachments/${att}/download-url`)).status).toBe(200);
    expect((await b.client.get('/properties')).body.items).toHaveLength(0);
    // Owners cannot attach files to someone else's property.
    const presign = await b.client.post('/uploads/presign', { ownerType: 'PROPERTY', ownerId: prop.id, filename: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 100 });
    expect(presign.status).toBe(404);
    // A customer cannot read owner endpoints.
    const customer = await ctx.customer();
    expect((await customer.client.get(`/properties/${prop.id}`)).status).toBe(403);
  });

  it('validates uploads by content sniffing and size', async () => {
    const owner = await ctx.owner();
    const prop = await ctx.property(owner);
    const presign = await owner.client.post('/uploads/presign', { ownerType: 'PROPERTY', ownerId: prop.id, filename: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 20 });
    await owner.client.agent.put(presign.body.upload.url).set('content-type', 'image/jpeg').send(Buffer.from('this is not really a jpeg file'));
    const done = await owner.client.post('/attachments/complete', { attachmentId: presign.body.attachmentId });
    expect(done.status).toBe(422);
    expect(done.body.error.details[0].code).toBe('CONTENT_MISMATCH');
    const tooBig = await owner.client.post('/uploads/presign', { ownerType: 'PROPERTY', filename: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024 });
    expect(tooBig.body.error.details[0].code).toBe('TOO_LARGE');
    const exe = await owner.client.post('/uploads/presign', { ownerType: 'PROPERTY', filename: 'x.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 });
    expect(exe.body.error.details[0].code).toBe('UNSUPPORTED_TYPE');
  });

  it('blocks calendar blocks over booked dates and supports owner blocks', async () => {
    const owner = await ctx.owner();
    const listing = await ctx.publishedListing(owner);
    const ok = await owner.client.post(`/listings/${listing.id}/blocks`, { startDate: '2026-12-24', endDate: '2026-12-27', note: 'Family' });
    expect(ok.status).toBe(201);
    const overlap = await owner.client.post(`/listings/${listing.id}/blocks`, { startDate: '2026-12-26', endDate: '2026-12-28' });
    expect(overlap.body.error.code).toBe('DATES_UNAVAILABLE');
    const cal = await owner.client.get(`/listings/${listing.id}/calendar?from=2026-12-01&to=2026-12-31`);
    expect(cal.body.items[0].label).toBe('Family');
  });
});
