/**
 * Commission engine (SPEC §7 rule 14, Appendix A.3). Owner-side commission is set from
 * admin-maintained benchmarks minus a configurable undercut, clamped to a floor and ceiling.
 */
import type { BenchmarkMode, UndercutMode } from './enums';
import { applyBps, mulDivRoundHalfUp } from './money';

export interface CommissionBenchmarkInput {
  id: string;
  platformName: string;
  commissionBps: number;
  enabled: boolean;
}

export interface CommissionSettings {
  benchmarkMode: BenchmarkMode;
  specificBenchmarkId?: string | null;
  undercutMode: UndercutMode;
  undercutBps: number;
  floorBps: number;
  ceilingBps: number;
}

export interface EffectiveCommission {
  /** null when no enabled benchmark exists (the ceiling is applied; see docs/DECISIONS.md). */
  benchmarkBps: number | null;
  effectiveBps: number;
  appliedBps: number;
  source: 'COMPUTED' | 'OWNER_OVERRIDE' | 'NO_BENCHMARK_FALLBACK';
  benchmarks: Array<Pick<CommissionBenchmarkInput, 'id' | 'platformName' | 'commissionBps'>>;
  settings: CommissionSettings;
  ownerOverrideBps: number | null;
}

export function selectBenchmarkBps(benchmarks: CommissionBenchmarkInput[], settings: CommissionSettings): number | null {
  const enabled = benchmarks.filter((b) => b.enabled);
  if (enabled.length === 0) return null;
  const rates = enabled.map((b) => b.commissionBps);
  switch (settings.benchmarkMode) {
    case 'MIN':
      return Math.min(...rates);
    case 'MAX':
      return Math.max(...rates);
    case 'AVG':
      return mulDivRoundHalfUp(
        rates.reduce((a, b) => a + b, 0),
        1,
        rates.length,
      );
    case 'SPECIFIC': {
      const chosen = enabled.find((b) => b.id === settings.specificBenchmarkId);
      return chosen ? chosen.commissionBps : null;
    }
  }
}

export function computeEffectiveCommission(
  benchmarks: CommissionBenchmarkInput[],
  settings: CommissionSettings,
  ownerOverrideBps?: number | null,
): EffectiveCommission {
  const benchmarkBps = selectBenchmarkBps(benchmarks, settings);
  let effectiveBps: number;
  let source: EffectiveCommission['source'] = 'COMPUTED';
  if (benchmarkBps === null) {
    effectiveBps = settings.ceilingBps;
    source = 'NO_BENCHMARK_FALLBACK';
  } else {
    const raw =
      settings.undercutMode === 'RELATIVE'
        ? mulDivRoundHalfUp(benchmarkBps, Math.max(0, 10_000 - settings.undercutBps), 10_000)
        : Math.max(0, benchmarkBps - settings.undercutBps);
    effectiveBps = Math.min(settings.ceilingBps, Math.max(settings.floorBps, raw));
  }
  const hasOverride = ownerOverrideBps !== null && ownerOverrideBps !== undefined;
  return {
    benchmarkBps,
    effectiveBps,
    appliedBps: hasOverride ? ownerOverrideBps : effectiveBps,
    source: hasOverride ? 'OWNER_OVERRIDE' : source,
    benchmarks: benchmarks
      .filter((b) => b.enabled)
      .map((b) => ({ id: b.id, platformName: b.platformName, commissionBps: b.commissionBps })),
    settings,
    ownerOverrideBps: hasOverride ? ownerOverrideBps : null,
  };
}

/** commission = round_half_up(room_revenue × bps / 10000); payout = room_revenue − commission. */
export function computeBookingCommission(roomRevenuePaise: number, appliedBps: number) {
  const commissionPaise = applyBps(roomRevenuePaise, appliedBps);
  return { commissionPaise, ownerPayoutPaise: roomRevenuePaise - commissionPaise };
}
