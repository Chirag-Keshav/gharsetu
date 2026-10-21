/**
 * Development seed (SPEC §9.1, §10, Appendix D). Creates configuration plus a small demo world:
 * admins, owners, customers, properties, published listings with photos, bookings, maintenance
 * requests and providers. Contains no product name (SPEC §0.2). Local development data only.
 *
 * Demo sign-in (OTP_TEST_MODE code 123456):
 *   Admin (all flags)  +91 90000 00001   Admin (ops)  +91 90000 00002   Admin (finance) +91 90000 00003
 *   Owner              +91 90000 00010   Owner 2      +91 90000 00011
 *   Customer           +91 90000 00020   Customer 2   +91 90000 00021
 */
import path from 'node:path';
import { Prisma, PrismaClient, type Listing } from '@prisma/client';
import {
  addDays,
  computeBookingCommission,
  computeEffectiveCommission,
  computeQuoteTotals,
  istDateOf,
  istInstant,
  isoToDate,
  PERMISSION_FLAGS,
  POLICIES,
  POLICY_KEYS,
  priceStay,
  type IsoDate,
} from '@propcare/shared';
import sharp from 'sharp';
import { LocalObjectStorage, S3ObjectStorage, type ObjectStorage } from '../src/adapters/storage';
import { findRepoRoot, loadEnv } from '../src/config/env';
import { FieldCipher, sha256 } from '../src/core/crypto';
import { SEED_AMENITIES, SEED_CATEGORIES, SEED_SERVICE_AREAS } from './seed-catalog';

const env = loadEnv();
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const cipher = new FieldCipher(env.ACCESS_NOTES_KEY);
const storage: ObjectStorage =
  env.STORAGE_DRIVER === 's3'
    ? new S3ObjectStorage({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        privateBucket: env.S3_PRIVATE_BUCKET!,
        publicBucket: env.S3_PUBLIC_BUCKET!,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        publicBaseUrl: env.PUBLIC_MEDIA_BASE_URL,
      })
    : new LocalObjectStorage(path.resolve(findRepoRoot(), env.STORAGE_LOCAL_DIR), env.STORAGE_SIGNING_SECRET);

const now = new Date();
const today = istDateOf(now);
const SYSTEM = { actorId: null, actorRole: 'SYSTEM' };

async function ref(prefix: string) {
  const rows = await prisma.$queryRaw<Array<{ ref: string }>>`SELECT next_reference(${prefix}) AS ref`;
  return rows[0].ref;
}

async function status(entityType: string, entityId: string, chain: Array<string | null>, actor: { actorId: string | null; actorRole: string } = SYSTEM) {
  for (let i = 1; i < chain.length; i++) {
    await prisma.statusEvent.create({ data: { entityType, entityId, fromStatus: chain[i - 1], toStatus: chain[i]!, actorId: actor.actorId, actorRole: actor.actorRole } });
  }
}

/** Placeholder photo: a soft gradient with a caption, with dummy EXIF to prove stripping works. */
async function photo(label: string, hue: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},50%,32%)"/>
    </linearGradient></defs>
    <rect width="1600" height="1067" fill="url(#g)"/>
    <circle cx="1250" cy="260" r="120" fill="hsla(${(hue + 180) % 360},80%,85%,0.55)"/>
    <path d="M0 820 Q400 640 800 800 T1600 760 V1067 H0Z" fill="hsla(${hue},40%,20%,0.45)"/>
    <text x="80" y="980" font-family="Segoe UI, Arial, sans-serif" font-size="72" fill="white" fill-opacity="0.92">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).withExif({ IFD0: { Make: 'SeedCam', Model: 'Demo', Copyright: 'Demo seed' } }).toBuffer();
}

async function main() {
  if (await prisma.user.findUnique({ where: { phoneE164: '+919000000001' } })) {
    console.log('Demo data already present — skipping seed. Run "pnpm db:reset" for a fresh demo database.');
    return;
  }
  console.log('Seeding configuration…');

  // --- policies, cancellation policies, benchmarks ------------------------------------------------
  await prisma.policySetting.createMany({
    data: POLICY_KEYS.map((key) => ({ key, valueJson: POLICIES[key].defaultValue as Prisma.InputJsonValue, description: POLICIES[key].description })),
    skipDuplicates: true,
  });
  await prisma.cancellationPolicy.createMany({
    skipDuplicates: true,
    data: [
      { key: 'FLEXIBLE', name: 'Flexible', description: 'Full refund up to 24 hours before check-in. (Placeholder — business and legal to confirm.)', rules: [{ hoursBeforeCheckInAtLeast: 24, refundBps: 10000 }] },
      { key: 'MODERATE', name: 'Moderate', description: 'Full refund up to 5 days before check-in, 50 % up to 48 hours. (Placeholder.)', rules: [{ hoursBeforeCheckInAtLeast: 120, refundBps: 10000 }, { hoursBeforeCheckInAtLeast: 48, refundBps: 5000 }] },
      { key: 'STRICT', name: 'Strict', description: '50 % refund up to 14 days before check-in. (Placeholder.)', rules: [{ hoursBeforeCheckInAtLeast: 336, refundBps: 5000 }] },
    ],
  });
  await prisma.commissionBenchmark.createMany({
    data: [
      { platformName: 'Airbnb', commissionBps: 1550, asOfDate: isoToDate('2026-10-20'), sourceUrl: 'https://www.hostfully.com/blog/airbnb-host-fees/', note: 'Indicative host-only service fee on the booking subtotal before taxes, per secondary sources. VERIFY against actual terms.' },
      { platformName: 'MakeMyTrip', commissionBps: 2000, asOfDate: isoToDate('2026-10-20'), sourceUrl: 'https://docs.rentalsunited.com/hc/en-gb/articles/33814995338653-Integration-overview-MakeMyTrip', note: 'Indicative; actual partner terms vary by contract. VERIFY.' },
    ],
  });
  const benchmarks = await prisma.commissionBenchmark.findMany();
  const commission = computeEffectiveCommission(
    benchmarks.map((b) => ({ id: b.id, platformName: b.platformName, commissionBps: b.commissionBps, enabled: b.enabled })),
    { benchmarkMode: 'MIN', undercutMode: 'RELATIVE', undercutBps: 1000, floorBps: 500, ceilingBps: 2500 },
  );
  await prisma.commissionRateHistory.create({
    data: { benchmarkBps: commission.benchmarkBps, effectiveBps: commission.effectiveBps, inputs: { settings: commission.settings, benchmarks: commission.benchmarks } as unknown as Prisma.InputJsonValue, reason: 'SEED' },
  });

  // --- amenities, service areas, categories ------------------------------------------------------
  await prisma.amenity.createMany({ data: SEED_AMENITIES.map(([slug, name, group, iconKey]) => ({ slug, name, group, iconKey })) });
  const amenities = await prisma.amenity.findMany();
  const amenity = (slug: string) => amenities.find((a) => a.slug === slug)!.id;
  const areas: Array<{ id: string; name: string }> = [];
  for (const a of SEED_SERVICE_AREAS) areas.push(await prisma.serviceArea.create({ data: a }));
  const area = (name: string) => areas.find((a) => a.name === name)!.id;
  const categories: Record<string, string> = {};
  for (const [i, c] of SEED_CATEGORIES.entries()) {
    const created = await prisma.serviceCategory.create({
      data: {
        slug: c.slug,
        name: c.name,
        description: c.description,
        displayOrder: (i + 1) * 10,
        inspectionUsuallyRequired: c.inspectionUsuallyRequired,
        safetyNotes: c.safetyNotes ?? null,
        intakeSchema: c.intake as unknown as Prisma.InputJsonValue,
        dangerRules: c.intake.dangerRules as unknown as Prisma.InputJsonValue,
        requiredEvidence: c.requiredEvidence as unknown as Prisma.InputJsonValue,
        paymentPolicy: { deposit: null, final: 'REMAINDER_ON_COMPLETION_ACCEPTED' },
        attachmentRules: { maxFiles: 10 },
      },
    });
    categories[c.slug] = created.id;
    await prisma.checklistTemplate.create({ data: { categoryId: created.id, version: 1, items: c.checklist as unknown as Prisma.InputJsonValue } });
    await prisma.categoryServiceArea.createMany({ data: areas.map((a) => ({ categoryId: created.id, serviceAreaId: a.id })) });
  }

  // --- providers (directory records; they never log in) ------------------------------------------
  const providers = [
    { name: 'Sharma Electricals', providerType: 'INDIVIDUAL', contactName: 'Deepak Sharma', phone: '+918100000001', rating: 5, skills: ['electrical-repairs'], areas: ['North Goa', 'Bengaluru Central'] },
    { name: 'AquaFix Plumbing Crew', providerType: 'GROUP', contactName: 'Joseph D’Souza', phone: '+918100000002', rating: 4, skills: ['plumbing-leak-repair', 'roof-waterproofing'], areas: ['North Goa', 'Lonavala–Khandala', 'Pune', 'Bengaluru Central'] },
    { name: 'Coastal Painters Collective', providerType: 'GROUP', contactName: 'Maria Fernandes', phone: '+918100000003', rating: 4, skills: ['painting-wall-finishing', 'flooring-tiling'], areas: ['North Goa', 'Kochi', 'Lonavala–Khandala'] },
    { name: 'Ramesh Gowda', providerType: 'INDIVIDUAL', contactName: 'Ramesh Gowda', phone: '+918100000004', rating: 4, skills: ['carpentry-doors-windows', 'general-handyman'], areas: ['Bengaluru Central'] },
    { name: 'GreenThumb Gardens', providerType: 'GROUP', contactName: 'Sunita Rawat', phone: '+918100000005', rating: 3, skills: ['garden-outdoor'], areas: ['North Goa', 'Lonavala–Khandala', 'Dehradun–Mussoorie'] },
    { name: 'SafeHome Pest Services', providerType: 'GROUP', contactName: 'Imran Khan', phone: '+918100000006', rating: 4, skills: ['pest-control'], areas: SEED_SERVICE_AREAS.map((a) => a.name) },
    { name: 'Sparkle Deep Cleaning', providerType: 'GROUP', contactName: 'Lakshmi Nair', phone: '+918100000007', rating: 5, skills: ['deep-cleaning', 'pre-arrival-preparation', 'property-inspection'], areas: SEED_SERVICE_AREAS.map((a) => a.name) },
    { name: 'Anil Kumar', providerType: 'INDIVIDUAL', contactName: 'Anil Kumar', phone: '+918100000008', rating: null, skills: ['electrical-repairs', 'general-handyman'], areas: ['North Goa'], pending: true },
  ];
  for (const p of providers) {
    await prisma.serviceProvider.create({
      data: {
        name: p.name,
        providerType: p.providerType as 'INDIVIDUAL' | 'GROUP',
        contactName: p.contactName,
        phone: p.phone,
        status: 'ACTIVE',
        verificationStatus: (p as { pending?: boolean }).pending ? 'PENDING' : 'APPROVED',
        internalRating: p.rating,
        availabilityNotes: p.providerType === 'GROUP' ? 'Weekdays 9–6; weekend on request' : 'Mon–Sat mornings',
        internalNotes: 'Seeded demo provider.',
        skills: { create: p.skills.map((s) => ({ categoryId: categories[s] })) },
        areas: { create: p.areas.map((a) => ({ serviceAreaId: area(a) })) },
      },
    });
  }

  // --- users --------------------------------------------------------------------------------------
  console.log('Seeding demo users…');
  const mkUser = async (phone: string, name: string, roles: Array<'OWNER' | 'CUSTOMER' | 'ADMIN'>, flags: string[] = []) => {
    const u = await prisma.user.create({
      data: { phoneE164: phone, fullName: name, phoneVerifiedAt: now, permissionFlags: flags, lastActiveRole: roles[0] },
    });
    for (const role of roles) await prisma.userRole.create({ data: { userId: u.id, role } });
    if (roles.includes('OWNER')) await prisma.ownerProfile.create({ data: { userId: u.id, defaultServiceMode: 'LIST_AND_CARE', verificationStatus: 'APPROVED', payoutAccountRef: 'HDFC ••••4821' } });
    return u;
  };
  const admin = await mkUser('+919000000001', 'Asha Rao', ['ADMIN'], [...PERMISSION_FLAGS]);
  const opsAdmin = await mkUser('+919000000002', 'Vikram Shah', ['ADMIN'], ['LISTING_REVIEW', 'COMPLETION_APPROVE']);
  await mkUser('+919000000003', 'Meera Iyer', ['ADMIN'], ['FINANCE', 'AUDIT_VIEW']);
  const priya = await mkUser('+919000000010', 'Priya Menon', ['OWNER', 'CUSTOMER']);
  const rahul = await mkUser('+919000000011', 'Rahul Desai', ['OWNER']);
  const ananya = await mkUser('+919000000020', 'Ananya Gupta', ['CUSTOMER']);
  const karan = await mkUser('+919000000021', 'Karan Mehta', ['CUSTOMER']);
  await prisma.ownerProfile.update({ where: { userId: rahul.id }, data: { verificationStatus: 'APPROVED', payoutAccountRef: 'ICICI ••••0937' } });

  // --- properties ---------------------------------------------------------------------------------
  console.log('Seeding properties and listings…');
  interface PropSeed {
    owner: string;
    nickname: string;
    type: string;
    line1: string;
    locality: string;
    city: string;
    district: string;
    state: string;
    pin: string;
    lat: number;
    lng: number;
    mode: 'CARE' | 'LIST' | 'LIST_AND_CARE';
    verified: boolean;
    listing?: {
      status: 'PUBLISHED' | 'SUBMITTED' | 'DRAFT';
      title: string;
      description: string;
      guests: number;
      bedrooms: number;
      beds: number;
      baths: number;
      base: number;
      weekend: number | null;
      cleaning: number;
      mode: 'INSTANT' | 'OWNER_APPROVAL';
      policy: string;
      amenities: string[];
      photos: string[];
      hue: number;
      minNights?: number;
      pets?: boolean;
    };
  }
  const props: PropSeed[] = [
    {
      owner: priya.id, nickname: 'Anjuna Sea Breeze Villa', type: 'VILLA', line1: 'House 14, Flea Market Road', locality: 'Anjuna', city: 'Anjuna', district: 'North Goa', state: 'Goa', pin: '403509', lat: 15.5826, lng: 73.7417, mode: 'LIST_AND_CARE', verified: true,
      listing: {
        status: 'PUBLISHED', title: 'Sea Breeze Villa with private pool near Anjuna beach', guests: 8, bedrooms: 4, beds: 5, baths: 4, base: 1_400_000, weekend: 1_800_000, cleaning: 250_000, mode: 'INSTANT', policy: 'MODERATE',
        description: 'A bright four-bedroom Goan villa with a private pool, shaded verandas and a lush garden, a short walk from Anjuna beach and the Wednesday flea market.\n\nThe open kitchen is fully equipped, every bedroom has air conditioning and an attached bathroom, and a caretaker lives on site to help with check-in and local tips.\n\nQuiet hours from 10 pm. Perfect for families and small groups.',
        amenities: ['wifi', 'pool', 'air-conditioning', 'kitchen', 'parking', 'garden', 'caretaker', 'power-backup', 'hot-water', 'first-aid'], photos: ['Pool and garden', 'Living room', 'Master bedroom', 'Kitchen', 'Veranda', 'Bathroom'], hue: 190,
      },
    },
    {
      owner: priya.id, nickname: 'Assagao Garden Cottage', type: 'COTTAGE', line1: '2/118 Church Road', locality: 'Assagao', city: 'Assagao', district: 'North Goa', state: 'Goa', pin: '403507', lat: 15.5946, lng: 73.7741, mode: 'LIST', verified: true,
      listing: {
        status: 'PUBLISHED', title: 'Quiet garden cottage in leafy Assagao', guests: 3, bedrooms: 1, beds: 2, baths: 1, base: 450_000, weekend: 550_000, cleaning: 80_000, mode: 'OWNER_APPROVAL', policy: 'FLEXIBLE', pets: true,
        description: 'A cosy one-bedroom cottage tucked into a mango orchard in Assagao, ten minutes from Anjuna and Vagator. Fast Wi-Fi and a dedicated desk make it ideal for a workation.\n\nPets are welcome. Requests are approved by the owner, usually within a few hours.',
        amenities: ['wifi', 'workspace', 'kitchen', 'garden', 'pet-friendly', 'hot-water', 'parking'], photos: ['Cottage exterior', 'Bedroom', 'Work corner', 'Garden path', 'Kitchenette'], hue: 110,
      },
    },
    {
      owner: priya.id, nickname: 'Indiranagar flat', type: 'APARTMENT', line1: 'Flat 302, 12th Main', locality: 'Indiranagar', city: 'Bengaluru', district: 'Bengaluru Urban', state: 'Karnataka', pin: '560038', lat: 12.9719, lng: 77.6412, mode: 'CARE', verified: false,
    },
    {
      owner: rahul.id, nickname: 'Hilltop Farmhouse', type: 'FARMHOUSE', line1: 'Survey 44, Tungarli Dam Road', locality: 'Tungarli', city: 'Lonavala', district: 'Pune', state: 'Maharashtra', pin: '410401', lat: 18.7546, lng: 73.4062, mode: 'LIST_AND_CARE', verified: true,
      listing: {
        status: 'PUBLISHED', title: 'Hilltop farmhouse with valley views in Lonavala', guests: 10, bedrooms: 4, beds: 6, baths: 3, base: 1_200_000, weekend: 1_600_000, cleaning: 300_000, mode: 'INSTANT', policy: 'STRICT', minNights: 2,
        description: 'A spacious stone farmhouse on a hilltop above Tungarli lake with sweeping valley views, a large lawn and a barbecue area. Monsoon mist and winter sunsets are spectacular.\n\nFour bedrooms sleep up to ten guests. A caretaker cooks simple Maharashtrian meals on request.',
        amenities: ['wifi', 'parking', 'garden', 'bbq', 'caretaker', 'mountain-view', 'power-backup', 'kitchen', 'tv'], photos: ['Valley view', 'Lawn and barbecue', 'Living hall', 'Bedroom', 'Dining area', 'Sunset terrace'], hue: 30,
      },
    },
    {
      owner: rahul.id, nickname: 'Fort Kochi Heritage Homestay', type: 'HOMESTAY', line1: '7/402 Princess Street', locality: 'Fort Kochi', city: 'Kochi', district: 'Ernakulam', state: 'Kerala', pin: '682001', lat: 9.9658, lng: 76.2421, mode: 'LIST', verified: true,
      listing: {
        status: 'PUBLISHED', title: 'Heritage homestay in the heart of Fort Kochi', guests: 4, bedrooms: 2, beds: 2, baths: 2, base: 550_000, weekend: null, cleaning: 60_000, mode: 'INSTANT', policy: 'MODERATE',
        description: 'Stay in a restored 1920s Kochi home with high ceilings, teak floors and a courtyard, a short walk from the Chinese fishing nets, cafés and art galleries.\n\nBreakfast with Kerala specialities is included.',
        amenities: ['wifi', 'air-conditioning', 'hot-water', 'housekeeping', 'tv', 'first-aid'], photos: ['Courtyard', 'Heritage bedroom', 'Breakfast table', 'Street view', 'Sitting room'], hue: 15,
      },
    },
    {
      owner: rahul.id, nickname: 'Mussoorie Pine Cabin', type: 'COTTAGE', line1: 'Pine Hill Estate, Camel’s Back Road', locality: 'Camel’s Back', city: 'Mussoorie', district: 'Dehradun', state: 'Uttarakhand', pin: '248179', lat: 30.4598, lng: 78.0664, mode: 'LIST', verified: true,
      listing: {
        status: 'PUBLISHED', title: 'Pine-wood cabin with Himalayan views', guests: 2, bedrooms: 1, beds: 1, baths: 1, base: 380_000, weekend: 480_000, cleaning: 50_000, mode: 'INSTANT', policy: 'FLEXIBLE',
        description: 'A warm pine cabin for two on Camel’s Back Road with a fireplace, a reading nook and views of the Himalayan snow line on clear mornings.\n\nThe Mall Road is a fifteen-minute walk.',
        amenities: ['wifi', 'mountain-view', 'hot-water', 'workspace', 'first-aid'], photos: ['Cabin in the pines', 'Fireplace nook', 'Bedroom', 'Morning view', 'Deck'], hue: 140,
      },
    },
    {
      owner: rahul.id, nickname: 'Udaipur Lakeview Haveli', type: 'HOMESTAY', line1: '21 Lal Ghat', locality: 'Lal Ghat', city: 'Udaipur', district: 'Udaipur', state: 'Rajasthan', pin: '313001', lat: 24.5788, lng: 73.6829, mode: 'LIST', verified: false,
      listing: {
        status: 'SUBMITTED', title: 'Lakeview rooms in a restored haveli — call 98765 43210 for discounts', guests: 6, bedrooms: 3, beds: 3, baths: 3, base: 900_000, weekend: 1_100_000, cleaning: 100_000, mode: 'OWNER_APPROVAL', policy: 'MODERATE',
        description: 'A restored haveli on the ghats of Lake Pichola with a rooftop terrace overlooking City Palace. Three rooms with jharokha windows and traditional decor. Best rooftop in India, guaranteed!',
        amenities: ['wifi', 'air-conditioning', 'hot-water', 'tv'], photos: ['Rooftop at dusk', 'Jharokha room', 'Courtyard', 'Lake view', 'Bathroom'], hue: 45,
      },
    },
    {
      owner: rahul.id, nickname: 'Koregaon Park apartment', type: 'APARTMENT', line1: 'B-1104, Lane 6', locality: 'Koregaon Park', city: 'Pune', district: 'Pune', state: 'Maharashtra', pin: '411001', lat: 18.5362, lng: 73.8939, mode: 'LIST_AND_CARE', verified: false,
      listing: { status: 'DRAFT', title: '', description: '', guests: 2, bedrooms: 1, beds: 1, baths: 1, base: 0, weekend: null, cleaning: 0, mode: 'INSTANT', policy: 'MODERATE', amenities: [], photos: [], hue: 260 },
    },
  ];

  const listingByName: Record<string, Listing> = {};
  const propertyByName: Record<string, string> = {};
  for (const p of props) {
    const property = await prisma.property.create({
      data: {
        ownerUserId: p.owner,
        nickname: p.nickname,
        propertyType: p.type,
        addressLine1: p.line1,
        locality: p.locality,
        city: p.city,
        district: p.district,
        state: p.state,
        pinCode: p.pin,
        latitude: p.lat,
        longitude: p.lng,
        serviceMode: p.mode,
        verificationStatus: p.verified ? 'APPROVED' : p.listing?.status === 'SUBMITTED' ? 'PENDING' : 'NOT_SUBMITTED',
        accessNotes: cipher.encrypt('Key with caretaker next door; gate code shared on confirmation.'),
      },
    });
    propertyByName[p.nickname] = property.id;
    if (p.verified) {
      await prisma.verification.create({ data: { subjectType: 'PROPERTY', subjectId: property.id, status: 'APPROVED', submittedAt: now, reviewedAt: now, reviewedBy: admin.id } });
    }
    if (p.listing?.status === 'SUBMITTED') {
      // Pending verification with a placeholder document for the admin queue.
      const v = await prisma.verification.create({ data: { subjectType: 'PROPERTY', subjectId: property.id, status: 'PENDING', submittedAt: now } });
      const docKey = `verification/2026/${v.id}-deed.pdf`;
      await storage.put('private', docKey, Buffer.from('%PDF-1.4\n% placeholder ownership document for local development\n'), 'application/pdf');
      const att = await prisma.attachment.create({
        data: { ownerType: 'VERIFICATION', ownerId: v.id, objectKey: docKey, originalFilename: 'sale-deed.pdf', mimeType: 'application/pdf', sizeBytes: 64, status: 'AVAILABLE', uploadedBy: p.owner, visibility: 'INTERNAL' },
      });
      await prisma.verificationDocument.create({ data: { ownerType: 'VERIFICATION', ownerId: v.id, docType: 'TITLE_OR_SALE_DEED', attachmentId: att.id, objectKey: docKey } });
    }
    if (!p.listing) continue;
    const L = p.listing;
    const listing = await prisma.listing.create({
      data: {
        reference: await ref('LST'),
        propertyId: property.id,
        ownerUserId: p.owner,
        status: L.status,
        title: L.title,
        description: L.description,
        maxGuests: L.guests,
        bedrooms: L.bedrooms,
        beds: L.beds,
        bathrooms: L.baths,
        houseRules: { quietHours: '22:00-07:00', petsAllowed: !!L.pets, smokingAllowed: false, eventsAllowed: false, additionalRules: 'Please respect the neighbours.' },
        basePricePaise: BigInt(L.base),
        weekendPricePaise: L.weekend === null ? null : BigInt(L.weekend),
        cleaningFeePaise: BigInt(L.cleaning),
        minNights: L.minNights ?? 1,
        maxNights: 21,
        advanceNoticeHours: 24,
        maxAdvanceDays: 365,
        bookingMode: L.mode,
        cancellationPolicyKey: L.policy,
        publicAreaLabel: `${p.locality}, ${p.district === p.city ? p.state : p.district}`,
        approxLatitude: Math.round(p.lat * 100) / 100,
        approxLongitude: Math.round(p.lng * 100) / 100,
        checkinInstructions: 'The caretaker meets you at the gate. Door code and Wi-Fi password are in the welcome folder on the dining table.',
        publishedAt: L.status === 'PUBLISHED' ? now : null,
        submittedAt: L.status === 'DRAFT' ? null : now,
        reviewedAt: L.status === 'PUBLISHED' ? now : null,
        reviewedBy: L.status === 'PUBLISHED' ? opsAdmin.id : null,
        amenities: { create: L.amenities.map((slug) => ({ amenityId: amenity(slug) })) },
      },
    });
    listingByName[p.nickname] = listing;
    await status('LISTING', listing.id, L.status === 'PUBLISHED' ? [null, 'DRAFT', 'SUBMITTED', 'PUBLISHED'] : L.status === 'SUBMITTED' ? [null, 'DRAFT', 'SUBMITTED'] : [null, 'DRAFT']);
    for (const [i, caption] of L.photos.entries()) {
      const key = `listing/2026/${listing.id}-${i}.jpg`;
      const body = await photo(caption, (L.hue + i * 18) % 360);
      await storage.put('private', key, body, 'image/jpeg');
      const att = await prisma.attachment.create({
        data: { ownerType: 'LISTING', ownerId: listing.id, objectKey: key, originalFilename: `${caption}.jpg`, mimeType: 'image/jpeg', sizeBytes: body.length, sha256: sha256(body), status: 'AVAILABLE', uploadedBy: p.owner },
      });
      await prisma.listingPhoto.create({ data: { listingId: listing.id, attachmentId: att.id, position: i, caption, isCover: i === 0 } });
    }
    // The API's outbox dispatcher builds public, EXIF-free variants for published listings.
    if (L.status === 'PUBLISHED') await prisma.outboxEvent.create({ data: { type: 'listing.photos_changed', payload: { listingId: listing.id } } });
  }

  // --- bookings --------------------------------------------------------------------------------------
  console.log('Seeding bookings…');
  const weekendNights = POLICIES['pricing.weekend_nights'].defaultValue;
  const makeBooking = async (listing: Listing, customerId: string, checkIn: IsoDate, checkOut: IsoDate, guests: number, state: 'COMPLETED' | 'CONFIRMED' | 'REQUESTED') => {
    const price = priceStay(
      { basePricePaise: Number(listing.basePricePaise), weekendPricePaise: listing.weekendPricePaise === null ? null : Number(listing.weekendPricePaise), cleaningFeePaise: Number(listing.cleaningFeePaise), priceRules: [], weekendNights, taxRateBps: 0 },
      checkIn,
      checkOut,
    );
    const { commissionPaise, ownerPayoutPaise } = computeBookingCommission(price.roomRevenuePaise, commission.appliedBps);
    const policy = await prisma.cancellationPolicy.findUniqueOrThrow({ where: { key: listing.cancellationPolicyKey! } });
    const checkInAt = istInstant(checkIn, listing.checkInTime);
    const checkOutAt = istInstant(checkOut, listing.checkOutTime);
    const b = await prisma.booking.create({
      data: {
        reference: await ref('BKG'),
        listingId: listing.id,
        customerUserId: customerId,
        ownerUserId: listing.ownerUserId,
        status: state,
        checkInDate: isoToDate(checkIn),
        checkOutDate: isoToDate(checkOut),
        checkInAt,
        checkOutAt,
        nights: price.nights.length,
        guestsCount: guests,
        bookingModeSnapshot: listing.bookingMode,
        cancellationPolicySnapshot: { key: policy.key, name: policy.name, rules: policy.rules } as Prisma.InputJsonValue,
        pricingSnapshot: price as unknown as Prisma.InputJsonValue,
        nightsTotalPaise: BigInt(price.nightsTotalPaise),
        cleaningFeePaise: BigInt(price.cleaningFeePaise),
        taxPaise: 0n,
        totalPaise: BigInt(price.totalPaise),
        commissionBpsApplied: commission.appliedBps,
        commissionBenchmarkSnapshot: { appliedBps: commission.appliedBps, benchmarkBps: commission.benchmarkBps, settings: commission.settings, benchmarks: commission.benchmarks } as unknown as Prisma.InputJsonValue,
        commissionPaise: BigInt(commissionPaise),
        ownerPayoutPaise: BigInt(ownerPayoutPaise),
        requestedAt: new Date(checkInAt.getTime() - 20 * 86_400_000),
        requestExpiresAt: state === 'REQUESTED' ? new Date(now.getTime() + 20 * 3_600_000) : null,
        confirmedAt: state === 'REQUESTED' ? null : new Date(checkInAt.getTime() - 19 * 86_400_000),
        completedAt: state === 'COMPLETED' ? checkOutAt : null,
      },
    });
    await status('BOOKING', b.id, state === 'REQUESTED' ? [null, 'REQUESTED'] : state === 'CONFIRMED' ? [null, 'AWAITING_PAYMENT', 'CONFIRMED'] : [null, 'AWAITING_PAYMENT', 'CONFIRMED', 'COMPLETED']);
    if (state !== 'REQUESTED') {
      await prisma.listingOccupancy.create({ data: { listingId: listing.id, startDate: isoToDate(checkIn), endDate: isoToDate(checkOut), kind: 'BOOKING_CONFIRMED', bookingId: b.id } });
      const payment = await prisma.payment.create({
        data: { bookingId: b.id, payerUserId: customerId, provider: 'mock', providerPaymentId: `mock_pay_seed_${b.reference}`, amountPaise: BigInt(price.totalPaise), status: 'SUCCEEDED', paidAt: b.confirmedAt },
      });
      const inv = await ref('INV');
      await prisma.invoice.create({
        data: { reference: inv, kind: 'BOOKING_RECEIPT', bookingId: b.id, paymentId: payment.id, ownerUserId: listing.ownerUserId, recipientUserId: customerId, invoiceNumber: inv, amountPaise: BigInt(price.totalPaise), lines: [{ label: `Stay ${b.reference}`, amountPaise: price.totalPaise }] },
      });
      await prisma.payout.create({
        data: {
          reference: await ref('PYT'),
          bookingId: b.id,
          ownerUserId: listing.ownerUserId,
          amountPaise: BigInt(ownerPayoutPaise),
          status: state === 'COMPLETED' ? 'PAID' : 'PENDING',
          eligibleAt: new Date(checkInAt.getTime() + 24 * 3_600_000),
          paidAt: state === 'COMPLETED' ? checkOutAt : null,
          paymentReference: state === 'COMPLETED' ? 'UTR-SEED-0001' : null,
        },
      });
    }
    return b;
  };

  const villa = listingByName['Anjuna Sea Breeze Villa'];
  const cottage = listingByName['Assagao Garden Cottage'];
  const farm = listingByName['Hilltop Farmhouse'];
  const kochi = listingByName['Fort Kochi Heritage Homestay'];
  const b1 = await makeBooking(villa, ananya.id, addDays(today, -38), addDays(today, -35), 6, 'COMPLETED');
  const b2 = await makeBooking(kochi, karan.id, addDays(today, -30), addDays(today, -28), 2, 'COMPLETED');
  await makeBooking(farm, karan.id, addDays(today, 31), addDays(today, 33), 8, 'CONFIRMED');
  await makeBooking(cottage, ananya.id, addDays(today, 17), addDays(today, 20), 2, 'REQUESTED');
  await prisma.review.create({ data: { bookingId: b1.id, listingId: villa.id, customerUserId: ananya.id, rating: 5, body: 'Lovely villa, spotless pool and a very helpful caretaker. We would come back.' } });
  await prisma.review.create({ data: { bookingId: b2.id, listingId: kochi.id, customerUserId: karan.id, rating: 4, body: 'Beautiful old house in a great location. Breakfast was excellent.' } });
  await prisma.listing.update({ where: { id: villa.id }, data: { ratingAvg: 5, ratingCount: 1 } });
  await prisma.listing.update({ where: { id: kochi.id }, data: { ratingAvg: 4, ratingCount: 1 } });
  await prisma.listingOccupancy.create({ data: { listingId: villa.id, startDate: isoToDate(addDays(today, 64)), endDate: isoToDate(addDays(today, 67)), kind: 'BLOCK_OWNER', note: 'Family visit', createdBy: priya.id } });

  // --- maintenance requests -----------------------------------------------------------------------
  console.log('Seeding maintenance requests…');
  const flatId = propertyByName['Indiranagar flat'];
  const r1 = await prisma.serviceRequest.create({
    data: {
      reference: await ref('REQ'),
      ownerUserId: priya.id,
      propertyId: flatId,
      categoryId: categories['plumbing-leak-repair'],
      title: 'Leak under kitchen sink',
      description: 'Water collects in the cabinet after the tap is used. The flat is currently unoccupied, so please coordinate access through the caretaker.',
      intakeAnswers: { water_supply_affected: false, leak_visible: false, leak_location: 'Kitchen sink cabinet' },
      status: 'SUBMITTED',
      preferredWindows: [{ start: istInstant(addDays(today, 5), '09:00').toISOString(), end: istInstant(addDays(today, 5), '13:00').toISOString() }],
      submittedAt: new Date(now.getTime() - 5 * 3_600_000),
    },
  });
  await status('SERVICE_REQUEST', r1.id, [null, 'SUBMITTED'], { actorId: priya.id, actorRole: 'OWNER' });
  const r2 = await prisma.serviceRequest.create({
    data: {
      reference: await ref('REQ'),
      ownerUserId: priya.id,
      propertyId: propertyByName['Anjuna Sea Breeze Villa'],
      categoryId: categories['electrical-repairs'],
      title: 'Bedroom switchboard sparking',
      description: 'The caretaker noticed sparks and a burning smell from the switchboard in the second bedroom when the AC was switched on.',
      intakeAnswers: { affected_area: 'Second bedroom switchboard', power_outage: false, sparking_or_burning: true },
      urgency: 'SAFETY_RISK',
      safetyFlag: true,
      safetyGuidanceKeys: ['electrical.sparking'],
      status: 'UNDER_REVIEW',
      handledByAdminId: opsAdmin.id,
      firstResponseAt: new Date(now.getTime() - 2 * 3_600_000),
      submittedAt: new Date(now.getTime() - 3 * 3_600_000),
    },
  });
  await status('SERVICE_REQUEST', r2.id, [null, 'SUBMITTED', 'UNDER_REVIEW']);
  await prisma.adminAlert.create({ data: { type: 'SAFETY_FLAGGED_REQUEST', entityType: 'SERVICE_REQUEST', entityId: r2.id, metadata: { reference: r2.reference } } });
  const r3 = await prisma.serviceRequest.create({
    data: {
      reference: await ref('REQ'),
      ownerUserId: rahul.id,
      propertyId: propertyByName['Hilltop Farmhouse'],
      categoryId: categories['painting-wall-finishing'],
      title: 'Repaint exterior walls after monsoon',
      description: 'Exterior walls on the west side have peeling paint and damp patches after the monsoon. Please repaint before the winter season.',
      intakeAnswers: { rooms_surfaces: 'West exterior walls', interior_exterior: 'exterior', approx_area_sqft: 900, desired_finish: 'satin', damp_present: true },
      status: 'QUOTATION_SENT',
      handledByAdminId: opsAdmin.id,
      firstResponseAt: new Date(now.getTime() - 40 * 3_600_000),
      submittedAt: new Date(now.getTime() - 48 * 3_600_000),
    },
  });
  await status('SERVICE_REQUEST', r3.id, [null, 'SUBMITTED', 'UNDER_REVIEW', 'QUOTATION_DRAFT', 'QUOTATION_SENT']);
  const lines = [
    { description: 'Surface preparation, putty and primer', quantity: '900', unit: 'sq ft', unitPricePaise: 1800, taxRateBps: 0, lineType: 'LABOUR' as const, direction: 'ADD' as const },
    { description: 'Exterior weather-shield paint, two coats', quantity: '900', unit: 'sq ft', unitPricePaise: 3200, taxRateBps: 0, lineType: 'MATERIAL' as const, direction: 'ADD' as const },
    { description: 'Scaffolding and travel', quantity: '1', unit: 'job', unitPricePaise: 450_000, taxRateBps: 0, lineType: 'TRAVEL' as const, direction: 'ADD' as const },
    { description: 'Returning-owner discount', quantity: '1', unit: 'job', unitPricePaise: 200_000, taxRateBps: 0, lineType: 'DISCOUNT' as const, direction: 'DEDUCT' as const },
  ];
  const totals = computeQuoteTotals(lines);
  const quote = await prisma.quote.create({
    data: {
      reference: await ref('QUO'),
      requestId: r3.id,
      version: 1,
      status: 'DRAFT',
      subtotalPaise: BigInt(totals.subtotalPaise),
      taxPaise: BigInt(totals.taxPaise),
      totalPaise: BigInt(totals.totalPaise),
      scope: 'Prepare and repaint the west-facing exterior walls (about 900 sq ft) with two coats of weather-shield paint, including damp-patch treatment.',
      exclusions: ['Structural crack repair', 'Interior walls'],
      assumptions: ['Clear access around the west side', 'Dry weather for three consecutive days'],
      estimatedDuration: '4 days',
      validUntil: istInstant(addDays(today, 7), '23:59'),
      createdBy: opsAdmin.id,
      lineItems: {
        create: totals.lines.map((l, i) => ({
          position: i,
          description: lines[i].description,
          quantity: new Prisma.Decimal(l.quantityMilli / 1000),
          unit: lines[i].unit,
          unitPricePaise: BigInt(l.unitPricePaise),
          taxRateBps: 0,
          lineTotalPaise: BigInt(l.lineTotalPaise),
          lineTaxPaise: BigInt(l.lineTaxPaise),
          lineType: l.lineType,
          direction: l.direction,
        })),
      },
    },
  });
  await prisma.quote.update({ where: { id: quote.id }, data: { status: 'SENT', sentAt: new Date(now.getTime() - 20 * 3_600_000), sentBy: opsAdmin.id } });
  await status('QUOTE', quote.id, [null, 'DRAFT', 'SENT']);

  console.log(`
Seed complete.
  Effective commission: ${commission.appliedBps} bps (benchmark ${commission.benchmarkBps} bps)
  Sign in with OTP code 123456 (OTP_TEST_MODE=true):
    Admin (all flags) +91 90000 00001 · Ops admin +91 90000 00002 · Finance admin +91 90000 00003
    Owner Priya +91 90000 00010 (also customer) · Owner Rahul +91 90000 00011
    Customer Ananya +91 90000 00020 · Customer Karan +91 90000 00021
  Start the API so the outbox builds public photo variants.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
