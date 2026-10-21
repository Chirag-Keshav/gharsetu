/**
 * Creates the first admin (SPEC §2.1): `pnpm seed:admin --phone +91XXXXXXXXXX [--name "Full Name"] [--flags A,B]`.
 * Defaults to every permission flag. Fails if the phone already holds OWNER or CUSTOMER (ADMIN is exclusive).
 */
import { PrismaClient } from '@prisma/client';
import { maskPhone, normaliseIndianPhone, PERMISSION_FLAGS } from '@propcare/shared';
import { loadEnv } from '../src/config/env';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const env = loadEnv();
  const phone = normaliseIndianPhone(arg('phone') ?? '');
  if (!phone) throw new Error('Usage: pnpm seed:admin --phone +91XXXXXXXXXX [--name "Full Name"] [--flags FINANCE,AUDIT_VIEW]');
  const flags = (arg('flags')?.split(',').map((f) => f.trim()) ?? [...PERMISSION_FLAGS]).filter((f) => (PERMISSION_FLAGS as readonly string[]).includes(f));
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const existing = await prisma.user.findUnique({ where: { phoneE164: phone }, include: { roles: true } });
    if (existing?.roles.some((r) => r.role !== 'ADMIN')) throw new Error('That phone already has an owner/customer role. Admin accounts must use a separate number.');
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { permissionFlags: flags, ...(arg('name') ? { fullName: arg('name') } : {}) } })
      : await prisma.user.create({ data: { phoneE164: phone, fullName: arg('name') ?? 'Administrator', permissionFlags: flags, lastActiveRole: 'ADMIN' } });
    await prisma.userRole.upsert({ where: { userId_role: { userId: user.id, role: 'ADMIN' } }, create: { userId: user.id, role: 'ADMIN' }, update: {} });
    await prisma.auditEvent.create({ data: { actorRole: 'SYSTEM', action: 'staff.created_by_cli', entityType: 'USER', entityId: user.id, metadata: { flags } } });
    console.log(`Admin ready: ${maskPhone(phone)} with flags ${flags.join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
