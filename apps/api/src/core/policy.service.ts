import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { parsePolicyValue, POLICIES, POLICY_KEYS, type PolicyKey, type PolicyValue } from '@propcare/shared';
import { PrismaService } from './prisma.service';

const TTL_MS = 30_000;

/**
 * Database-backed business policy (SPEC §10) with a short cache. Values are validated against the
 * shared registry; missing rows fall back to the registry default.
 */
@Injectable()
export class PolicyService {
  private cache: { values: Map<string, unknown>; loadedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async load(): Promise<Map<string, unknown>> {
    if (this.cache && Date.now() - this.cache.loadedAt < TTL_MS) return this.cache.values;
    const rows = await this.prisma.policySetting.findMany();
    const values = new Map<string, unknown>();
    for (const row of rows) {
      if (!(row.key in POLICIES)) continue;
      try {
        values.set(row.key, parsePolicyValue(row.key as PolicyKey, row.valueJson));
      } catch {
        // An invalid stored value falls back to the registry default.
      }
    }
    this.cache = { values, loadedAt: Date.now() };
    return values;
  }

  async get<K extends PolicyKey>(key: K): Promise<PolicyValue<K>> {
    const values = await this.load();
    return (values.has(key) ? values.get(key) : POLICIES[key].defaultValue) as PolicyValue<K>;
  }

  async all(): Promise<Record<PolicyKey, unknown>> {
    const values = await this.load();
    return Object.fromEntries(POLICY_KEYS.map((k) => [k, values.has(k) ? values.get(k) : POLICIES[k].defaultValue])) as Record<
      PolicyKey,
      unknown
    >;
  }

  /** Validates and stores a value; callers check the edit flag and write the audit event. */
  async set(key: PolicyKey, value: unknown, updatedBy: string | null, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const parsed = parsePolicyValue(key, value);
    await db.policySetting.upsert({
      where: { key },
      create: { key, valueJson: parsed as Prisma.InputJsonValue, description: POLICIES[key].description, updatedBy },
      update: { valueJson: parsed as Prisma.InputJsonValue, updatedBy },
    });
    this.invalidate();
    return parsed;
  }

  invalidate(): void {
    this.cache = null;
  }

  /** Inserts any missing defaults (idempotent). */
  async ensureDefaults(): Promise<void> {
    await this.prisma.policySetting.createMany({
      data: POLICY_KEYS.map((key) => ({
        key,
        valueJson: POLICIES[key].defaultValue as Prisma.InputJsonValue,
        description: POLICIES[key].description,
      })),
      skipDuplicates: true,
    });
    this.invalidate();
  }
}
