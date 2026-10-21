/**
 * Integration-test harness: the real Nest app on the real test PostgreSQL, with a controllable
 * clock and the mock adapters. Each suite resets the database to a small base catalogue.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient, type Role } from '@prisma/client';
import { POLICIES, POLICY_KEYS, type PermissionFlag } from '@propcare/shared';
import sharp from 'sharp';
import request from 'supertest';
import { AI_PROVIDER, MockAiProvider } from '../src/adapters/ai';
import { MockPaymentProvider, PAYMENT_PROVIDER } from '../src/adapters/payments';
import { ConsoleSmsProvider, SMS_PROVIDER } from '../src/adapters/sms';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { CLOCK, FixedClock } from '../src/core/clock';
import { PolicyService } from '../src/core/policy.service';
import { PrismaService } from '../src/core/prisma.service';
import { AiService } from '../src/modules/ai/ai.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { SEED_AMENITIES, SEED_CATEGORIES, SEED_SERVICE_AREAS } from '../prisma/seed-catalog';

export const API = '/api/v1';
let phoneCounter = 0;
export const nextPhone = () => `+9170${String(Date.now() % 100000).padStart(5, '0')}${String(++phoneCounter).padStart(3, '0')}`;

export class Client {
  private csrf: string | null = null;
  readonly agent: ReturnType<typeof request.agent>;
  constructor(baseUrl: string) {
    this.agent = request.agent(baseUrl);
  }
  private async token() {
    if (!this.csrf) {
      const res = await this.agent.get(`${API}/auth/csrf`);
      this.csrf = res.body.token as string;
    }
    return this.csrf;
  }
  get(path: string) {
    return this.agent.get(`${API}${path}`);
  }
  // The token is awaited before the request is built, so the CSRF cookie is attached.
  async post(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
    const token = await this.token();
    return this.agent.post(`${API}${path}`).set('x-csrf-token', token).set(headers).send(body as object);
  }
  async patch(path: string, body: unknown = {}) {
    const token = await this.token();
    return this.agent.patch(`${API}${path}`).set('x-csrf-token', token).send(body as object);
  }
  async put(path: string, body: unknown = {}) {
    const token = await this.token();
    return this.agent.put(`${API}${path}`).set('x-csrf-token', token).send(body as object);
  }
  async del(path: string) {
    const token = await this.token();
    return this.agent.delete(`${API}${path}`).set('x-csrf-token', token);
  }
  /** Uploads a file through presign → signed PUT → complete. Returns the attachment id. */
  async upload(ownerType: string, buffer: Buffer, mimeType: string, opts: { ownerId?: string; filename?: string; evidencePhase?: string } = {}) {
    const presign = await this.post('/uploads/presign', {
      ownerType,
      ownerId: opts.ownerId,
      filename: opts.filename ?? 'file',
      mimeType,
      sizeBytes: buffer.length,
      evidencePhase: opts.evidencePhase,
    });
    if (presign.status !== 201) throw new Error(`presign failed ${presign.status} ${JSON.stringify(presign.body)}`);
    const put = await this.agent.put(presign.body.upload.url).set('content-type', mimeType).send(buffer);
    if (put.status !== 200) throw new Error(`upload failed ${put.status} ${JSON.stringify(put.body)}`);
    const done = await this.post('/attachments/complete', { attachmentId: presign.body.attachmentId });
    if (done.status !== 200) throw new Error(`complete failed ${done.status} ${JSON.stringify(done.body)}`);
    return presign.body.attachmentId as string;
  }
}

export interface TestUser {
  id: string;
  phone: string;
  client: Client;
}

export class TestContext {
  constructor(
    readonly app: INestApplication,
    readonly prisma: PrismaService,
    readonly clock: FixedClock,
    readonly baseUrl: string,
  ) {}

  get mockAi() {
    return this.app.get<MockAiProvider>(AI_PROVIDER);
  }
  get payments() {
    return this.app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
  }
  get sms() {
    return this.app.get<ConsoleSmsProvider>(SMS_PROVIDER);
  }

  client() {
    return new Client(this.baseUrl);
  }

  async drainOutbox() {
    await this.app.get(NotificationsService).drain();
  }

  async login(phone: string, intent?: 'BOOKING') {
    const c = this.client();
    const o = await c.post('/auth/otp/request', { phone });
    if (o.status !== 200) throw new Error(`otp request ${o.status} ${JSON.stringify(o.body)}`);
    const v = await c.post('/auth/otp/verify', { challengeId: o.body.challengeId, code: '123456', intent });
    if (v.status !== 200) throw new Error(`otp verify ${v.status} ${JSON.stringify(v.body)}`);
    return c;
  }

  /** Creates a user directly in the database and signs them in. */
  async user(roles: Role[], opts: { flags?: PermissionFlag[]; name?: string; ownerVerified?: boolean } = {}): Promise<TestUser> {
    const phone = nextPhone();
    const u = await this.prisma.user.create({
      data: { phoneE164: phone, fullName: opts.name ?? `${roles[0]} ${phoneCounter}`, phoneVerifiedAt: new Date(), permissionFlags: opts.flags ?? [], lastActiveRole: roles[0] },
    });
    for (const role of roles) await this.prisma.userRole.create({ data: { userId: u.id, role } });
    if (roles.includes('OWNER')) {
      await this.prisma.ownerProfile.create({ data: { userId: u.id, verificationStatus: opts.ownerVerified === false ? 'NOT_SUBMITTED' : 'APPROVED' } });
    }
    return { id: u.id, phone, client: await this.login(phone) };
  }

  owner(opts: { ownerVerified?: boolean } = {}) {
    return this.user(['OWNER'], opts);
  }
  customer() {
    return this.user(['CUSTOMER']);
  }
  admin(flags: PermissionFlag[] = ['LISTING_REVIEW', 'COMPLETION_APPROVE', 'FINANCE', 'AUDIT_VIEW', 'CATALOG_ADMIN', 'USER_ADMIN', 'AI_ADMIN', 'ASSIGNMENT_OVERRIDE', 'QUOTE_DISCOUNT_APPROVE']) {
    return this.user(['ADMIN'], { flags });
  }

  async category(slug: string) {
    return this.prisma.serviceCategory.findUniqueOrThrow({ where: { slug } });
  }

  /** A property via the API. */
  async property(owner: TestUser, overrides: Record<string, unknown> = {}) {
    const res = await owner.client.post('/properties', {
      nickname: 'Test villa',
      propertyType: 'VILLA',
      addressLine1: '12 Secret Lane',
      locality: 'Anjuna',
      city: 'Anjuna',
      district: 'North Goa',
      state: 'Goa',
      pinCode: '403509',
      latitude: 15.58261,
      longitude: 73.74171,
      accessNotes: 'Key under the blue pot',
      serviceMode: 'LIST_AND_CARE',
      ...overrides,
    });
    if (res.status !== 201) throw new Error(`property ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string };
  }

  /** A published listing written straight to the database (for booking tests). */
  async publishedListing(owner: TestUser, overrides: Partial<Prisma.ListingUncheckedCreateInput> = {}, propertyOverrides: Record<string, unknown> = {}) {
    const property = await this.property(owner, propertyOverrides);
    await this.prisma.property.update({ where: { id: property.id }, data: { verificationStatus: 'APPROVED' } });
    const rows = await this.prisma.$queryRaw<Array<{ ref: string }>>`SELECT next_reference('LST') AS ref`;
    return this.prisma.listing.create({
      data: {
        reference: rows[0].ref,
        propertyId: property.id,
        ownerUserId: owner.id,
        status: 'PUBLISHED',
        title: 'Sunny test villa near the beach',
        description: 'A lovely test villa. '.repeat(5),
        maxGuests: 6,
        bedrooms: 3,
        beds: 3,
        bathrooms: 2,
        basePricePaise: 400_000n,
        weekendPricePaise: 500_000n,
        cleaningFeePaise: 100_000n,
        minNights: 1,
        maxNights: 14,
        advanceNoticeHours: 24,
        maxAdvanceDays: 365,
        bookingMode: 'INSTANT',
        cancellationPolicyKey: 'MODERATE',
        publicAreaLabel: 'Anjuna, North Goa',
        approxLatitude: 15.58,
        approxLongitude: 73.74,
        checkinInstructions: 'Door code 4242',
        publishedAt: new Date(),
        ...overrides,
      },
    });
  }

  async provider(categorySlugs: string[], opts: { status?: 'ACTIVE' | 'INACTIVE'; verification?: 'APPROVED' | 'PENDING'; areaName?: string } = {}) {
    const area = await this.prisma.serviceArea.findFirstOrThrow({ where: { name: opts.areaName ?? 'North Goa' } });
    const cats = await this.prisma.serviceCategory.findMany({ where: { slug: { in: categorySlugs } } });
    return this.prisma.serviceProvider.create({
      data: {
        name: `Provider ${++phoneCounter}`,
        providerType: 'INDIVIDUAL',
        phone: nextPhone(),
        status: opts.status ?? 'ACTIVE',
        verificationStatus: opts.verification ?? 'APPROVED',
        internalRating: 4,
        skills: { create: cats.map((c) => ({ categoryId: c.id })) },
        areas: { create: [{ serviceAreaId: area.id }] },
      },
    });
  }

  async reset() {
    await this.app.get(AiService).idle();
    await resetDatabase(this.prisma);
    this.app.get(PolicyService).invalidate();
    this.mockAi.received.length = 0;
    this.mockAi.behaviour = 'normal';
    this.payments.failRefunds = false;
  }

  async setPolicy(key: (typeof POLICY_KEYS)[number], value: unknown) {
    await this.app.get(PolicyService).set(key, value, null);
  }

  async close() {
    await this.app.get(AiService).idle();
    await this.app.close();
  }
}

export async function resetDatabase(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await seedBase(prisma);
}

/** Minimal configuration every suite needs. */
export async function seedBase(prisma: PrismaClient) {
  await prisma.policySetting.createMany({
    data: POLICY_KEYS.map((key) => ({ key, valueJson: POLICIES[key].defaultValue as Prisma.InputJsonValue })),
  });
  await prisma.cancellationPolicy.createMany({
    data: [
      { key: 'FLEXIBLE', name: 'Flexible', rules: [{ hoursBeforeCheckInAtLeast: 24, refundBps: 10000 }] },
      { key: 'MODERATE', name: 'Moderate', rules: [{ hoursBeforeCheckInAtLeast: 120, refundBps: 10000 }, { hoursBeforeCheckInAtLeast: 48, refundBps: 5000 }] },
      { key: 'STRICT', name: 'Strict', rules: [{ hoursBeforeCheckInAtLeast: 336, refundBps: 5000 }] },
    ],
  });
  await prisma.commissionBenchmark.createMany({
    data: [
      { platformName: 'Airbnb', commissionBps: 1550, asOfDate: new Date('2026-10-20T00:00:00Z') },
      { platformName: 'MakeMyTrip', commissionBps: 2000, asOfDate: new Date('2026-10-20T00:00:00Z') },
    ],
  });
  await prisma.amenity.createMany({ data: SEED_AMENITIES.map(([slug, name, group, iconKey]) => ({ slug, name, group, iconKey })) });
  const areas = [];
  for (const a of SEED_SERVICE_AREAS) areas.push(await prisma.serviceArea.create({ data: a }));
  for (const [i, c] of SEED_CATEGORIES.entries()) {
    const cat = await prisma.serviceCategory.create({
      data: {
        slug: c.slug,
        name: c.name,
        description: c.description,
        displayOrder: i,
        inspectionUsuallyRequired: c.inspectionUsuallyRequired,
        intakeSchema: c.intake as unknown as Prisma.InputJsonValue,
        dangerRules: c.intake.dangerRules as unknown as Prisma.InputJsonValue,
        requiredEvidence: c.requiredEvidence as unknown as Prisma.InputJsonValue,
        paymentPolicy: {},
      },
    });
    await prisma.checklistTemplate.create({ data: { categoryId: cat.id, version: 1, items: c.checklist as unknown as Prisma.InputJsonValue } });
    // Bengaluru does not offer pest control in tests, to exercise OUT_OF_SERVICE_AREA.
    const enabled = c.slug === 'pest-control' ? areas.filter((a) => a.name !== 'Bengaluru Central') : areas;
    await prisma.categoryServiceArea.createMany({ data: enabled.map((a) => ({ categoryId: cat.id, serviceAreaId: a.id })) });
  }
}

export async function createTestContext(): Promise<TestContext> {
  const clock = new FixedClock(new Date());
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const ctx = new TestContext(app, app.get(PrismaService), clock, `http://127.0.0.1:${address.port}`);
  await ctx.reset();
  return ctx;
}

/** A small JPEG with EXIF metadata (including a GPS-like comment) for media tests. */
export function testJpeg(color = '#3a8fb7'): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestCam', ImageDescription: 'GPS 15.58261,73.74171' } })
    .toBuffer();
}

export const isoDay = (offsetDays: number, from = new Date()) => {
  const d = new Date(from.getTime() + 5.5 * 3_600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
};
