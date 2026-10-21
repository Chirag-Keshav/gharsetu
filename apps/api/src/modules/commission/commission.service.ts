import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  benchmarkSchema,
  computeEffectiveCommission,
  isoToDate,
  type CommissionSettings,
  type EffectiveCommission,
} from '@propcare/shared';
import type { z } from 'zod';
import type { Actor, UserActor } from '../../core/context';
import { notFound } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService, type Db } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { iso, isoDay } from '../../core/serialize';

/** Commission engine (SPEC §7 rule 14, §8.9 COM-01). Admin endpoints require FINANCE. */
@Injectable()
export class CommissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly records: RecordsService,
  ) {}

  async settings(): Promise<CommissionSettings> {
    return {
      benchmarkMode: await this.policy.get('commission.benchmark_mode'),
      specificBenchmarkId: await this.policy.get('commission.specific_benchmark_id'),
      undercutMode: await this.policy.get('commission.undercut_mode'),
      undercutBps: await this.policy.get('commission.undercut_bps'),
      floorBps: await this.policy.get('commission.floor_bps'),
      ceilingBps: await this.policy.get('commission.ceiling_bps'),
    };
  }

  async effective(ownerUserId: string | null, db: Db = this.prisma, override?: Partial<CommissionSettings>): Promise<EffectiveCommission> {
    const [benchmarks, settings, profile] = await Promise.all([
      db.commissionBenchmark.findMany({ where: { enabled: true } }),
      this.settings(),
      ownerUserId ? db.ownerProfile.findUnique({ where: { userId: ownerUserId } }) : Promise.resolve(null),
    ]);
    return computeEffectiveCommission(
      benchmarks.map((b) => ({ id: b.id, platformName: b.platformName, commissionBps: b.commissionBps, enabled: b.enabled })),
      { ...settings, ...override },
      profile?.commissionOverrideBps ?? null,
    );
  }

  /** Snapshot stored on each booking at creation; never changes afterwards. */
  snapshotOf(c: EffectiveCommission) {
    return {
      appliedBps: c.appliedBps,
      effectiveBps: c.effectiveBps,
      benchmarkBps: c.benchmarkBps,
      source: c.source,
      benchmarks: c.benchmarks,
      settings: c.settings,
      ownerOverrideBps: c.ownerOverrideBps,
    } as unknown as Prisma.InputJsonValue;
  }

  serializeBenchmark(b: { id: string; platformName: string; commissionBps: number; note: string | null; sourceUrl: string | null; asOfDate: Date; enabled: boolean; updatedAt: Date }) {
    return {
      id: b.id,
      platformName: b.platformName,
      commissionBps: b.commissionBps,
      note: b.note,
      sourceUrl: b.sourceUrl,
      asOfDate: isoDay(b.asOfDate),
      enabled: b.enabled,
      updatedAt: iso(b.updatedAt),
    };
  }

  async benchmarks() {
    const rows = await this.prisma.commissionBenchmark.findMany({ orderBy: { platformName: 'asc' } });
    return { items: rows.map((b) => this.serializeBenchmark(b)) };
  }

  async recordHistory(db: Db, actor: Actor, reason: string) {
    const c = await this.effective(null, db);
    await db.commissionRateHistory.create({
      data: {
        benchmarkBps: c.benchmarkBps,
        effectiveBps: c.effectiveBps,
        inputs: { settings: c.settings, benchmarks: c.benchmarks } as unknown as Prisma.InputJsonValue,
        changedBy: actor.userId,
        reason,
      },
    });
  }

  async createBenchmark(actor: UserActor, input: z.infer<typeof benchmarkSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.commissionBenchmark.create({
        data: { ...input, asOfDate: isoToDate(input.asOfDate), enteredBy: actor.userId },
      });
      await this.records.audit(tx, actor, { action: 'commission.benchmark_created', entityType: 'COMMISSION_BENCHMARK', entityId: b.id, metadata: { commissionBps: b.commissionBps } });
      await this.recordHistory(tx, actor, 'BENCHMARK_CREATED');
      return this.serializeBenchmark(b);
    });
  }

  async updateBenchmark(actor: UserActor, id: string, input: Partial<z.infer<typeof benchmarkSchema>>) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.commissionBenchmark.findUnique({ where: { id } });
      if (!existing) throw notFound();
      const b = await tx.commissionBenchmark.update({
        where: { id },
        data: { ...input, asOfDate: input.asOfDate ? isoToDate(input.asOfDate) : undefined, enteredBy: actor.userId },
      });
      await this.records.audit(tx, actor, {
        action: 'commission.benchmark_updated',
        entityType: 'COMMISSION_BENCHMARK',
        entityId: id,
        metadata: { fields: Object.keys(input), from: existing.commissionBps, to: b.commissionBps },
      });
      await this.recordHistory(tx, actor, 'BENCHMARK_UPDATED');
      return this.serializeBenchmark(b);
    });
  }

  /** Applies commission.* policy values in one audited step and records the new effective rate. */
  async updateSettings(actor: UserActor, patch: Partial<CommissionSettings>) {
    const keyMap: Record<keyof CommissionSettings, string> = {
      benchmarkMode: 'commission.benchmark_mode',
      specificBenchmarkId: 'commission.specific_benchmark_id',
      undercutMode: 'commission.undercut_mode',
      undercutBps: 'commission.undercut_bps',
      floorBps: 'commission.floor_bps',
      ceilingBps: 'commission.ceiling_bps',
    };
    await this.prisma.$transaction(async (tx) => {
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const key = keyMap[field as keyof CommissionSettings] as Parameters<PolicyService['set']>[0];
        await this.policy.set(key, value, actor.userId, tx);
      }
      await this.records.audit(tx, actor, { action: 'commission.settings_updated', entityType: 'POLICY', entityId: null, metadata: patch as Record<string, unknown> });
    });
    this.policy.invalidate();
    await this.recordHistory(this.prisma, actor, 'SETTINGS_UPDATED');
    return this.preview();
  }

  /** Effective rate preview, optionally with unsaved settings, plus history (SPEC §8.9). */
  async preview(override?: Partial<CommissionSettings>) {
    const current = await this.effective(null);
    const proposed = override && Object.keys(override).length ? await this.effective(null, this.prisma, override) : null;
    const history = await this.prisma.commissionRateHistory.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    return {
      current,
      proposed,
      history: history.map((h) => ({ id: h.id, benchmarkBps: h.benchmarkBps, effectiveBps: h.effectiveBps, reason: h.reason, createdAt: iso(h.createdAt) })),
    };
  }

  async setOwnerOverride(actor: UserActor, ownerUserId: string, bps: number | null, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.ownerProfile.findUnique({ where: { userId: ownerUserId } });
      if (!profile) throw notFound();
      await tx.ownerProfile.update({
        where: { userId: ownerUserId },
        data: { commissionOverrideBps: bps, commissionOverrideReason: bps === null ? null : reason },
      });
      await this.records.audit(tx, actor, {
        action: 'commission.owner_override_set',
        entityType: 'OWNER_PROFILE',
        entityId: ownerUserId,
        metadata: { from: profile.commissionOverrideBps, to: bps, reason },
      });
      return { ownerUserId, commissionOverrideBps: bps };
    });
  }

  /** Owner-facing: their effective rate only, no internal settings. */
  async ownerView(ownerUserId: string) {
    const c = await this.effective(ownerUserId);
    return {
      effectiveBps: c.appliedBps,
      hasOverride: c.source === 'OWNER_OVERRIDE',
      benchmarkBps: c.source === 'OWNER_OVERRIDE' ? null : c.benchmarkBps,
    };
  }
}
