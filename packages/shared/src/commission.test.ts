import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeCancellationRefund, selectRefundBps } from './cancellation';
import { computeBookingCommission, computeEffectiveCommission, type CommissionSettings } from './commission';

const benchmarks = [
  { id: 'a', platformName: 'Airbnb', commissionBps: 1550, enabled: true },
  { id: 'm', platformName: 'MakeMyTrip', commissionBps: 2000, enabled: true },
];
const settings: CommissionSettings = {
  benchmarkMode: 'MIN',
  undercutMode: 'RELATIVE',
  undercutBps: 1000,
  floorBps: 500,
  ceilingBps: 2500,
};

describe('commission engine (SPEC §7 rule 14, Appendix A.3)', () => {
  it('reproduces the 10 % lower example', () => {
    const c = computeEffectiveCommission(benchmarks, settings);
    expect(c.benchmarkBps).toBe(1550);
    expect(c.appliedBps).toBe(1395);
    expect(computeBookingCommission(1_500_000, c.appliedBps)).toEqual({ commissionPaise: 209_250, ownerPayoutPaise: 1_290_750 });
  });

  it('reproduces the 15 % lower example (1317.5 rounds to 1318)', () => {
    const c = computeEffectiveCommission(benchmarks, { ...settings, undercutBps: 1500 });
    expect(c.appliedBps).toBe(1318);
    expect(computeBookingCommission(1_500_000, 1318)).toEqual({ commissionPaise: 197_700, ownerPayoutPaise: 1_302_300 });
  });

  it('supports AVG, MAX, SPECIFIC, POINTS, clamping and overrides', () => {
    expect(computeEffectiveCommission(benchmarks, { ...settings, benchmarkMode: 'AVG' }).benchmarkBps).toBe(1775);
    expect(computeEffectiveCommission(benchmarks, { ...settings, benchmarkMode: 'MAX' }).benchmarkBps).toBe(2000);
    expect(
      computeEffectiveCommission(benchmarks, { ...settings, benchmarkMode: 'SPECIFIC', specificBenchmarkId: 'm' }).benchmarkBps,
    ).toBe(2000);
    expect(computeEffectiveCommission(benchmarks, { ...settings, undercutMode: 'POINTS', undercutBps: 200 }).appliedBps).toBe(1350);
    expect(computeEffectiveCommission(benchmarks, { ...settings, undercutBps: 9000 }).appliedBps).toBe(500); // floor
    const o = computeEffectiveCommission(benchmarks, settings, 1000);
    expect(o.appliedBps).toBe(1000);
    expect(o.source).toBe('OWNER_OVERRIDE');
    expect(computeEffectiveCommission([], settings).source).toBe('NO_BENCHMARK_FALLBACK');
  });

  it('commission + payout always equals room revenue (property)', () => {
    fc.assert(
      fc.property(fc.nat(1_000_000_000), fc.integer({ min: 0, max: 10_000 }), (revenue, rate) => {
        const { commissionPaise, ownerPayoutPaise } = computeBookingCommission(revenue, rate);
        expect(commissionPaise + ownerPayoutPaise).toBe(revenue);
        expect(commissionPaise).toBeGreaterThanOrEqual(0);
        expect(ownerPayoutPaise).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('effective rate always lies within floor and ceiling (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 10_000 }), (bench, undercut) => {
        const c = computeEffectiveCommission([{ id: 'x', platformName: 'X', commissionBps: bench, enabled: true }], {
          ...settings,
          undercutBps: undercut,
        });
        expect(c.appliedBps).toBeGreaterThanOrEqual(500);
        expect(c.appliedBps).toBeLessThanOrEqual(2500);
      }),
    );
  });
});

describe('cancellation refunds (SPEC §7 rule 16)', () => {
  const moderate = [
    { hoursBeforeCheckInAtLeast: 120, refundBps: 10000 },
    { hoursBeforeCheckInAtLeast: 48, refundBps: 5000 },
  ];
  const checkInAt = new Date('2026-11-12T08:30:00Z');
  const hoursBefore = (h: number) => new Date(checkInAt.getTime() - h * 3_600_000);

  it('selects tiers at every boundary', () => {
    expect(selectRefundBps(moderate, 120)).toBe(10000);
    expect(selectRefundBps(moderate, 119.999)).toBe(5000);
    expect(selectRefundBps(moderate, 48)).toBe(5000);
    expect(selectRefundBps(moderate, 47.999)).toBe(0);
    expect(selectRefundBps(moderate, -5)).toBe(0);
  });

  it('refunds room revenue and tax proportionally and recomputes commission', () => {
    const r = computeCancellationRefund({
      rules: moderate,
      checkInAt,
      cancelAt: hoursBefore(60),
      roomRevenuePaise: 1_500_000,
      taxPaise: 180_000,
      commissionBps: 1395,
      initiator: 'CUSTOMER',
    });
    expect(r.refundBps).toBe(5000);
    expect(r.refundedRoomRevenuePaise).toBe(750_000);
    expect(r.refundedTaxPaise).toBe(90_000);
    expect(r.refundPaise).toBe(840_000);
    expect(r.retainedRoomRevenuePaise).toBe(750_000);
    expect(r.commissionPaise).toBe(104_625);
    expect(r.ownerPayoutPaise).toBe(645_375);
  });

  it('gives a full refund when the owner cancels', () => {
    const r = computeCancellationRefund({
      rules: moderate,
      checkInAt,
      cancelAt: hoursBefore(1),
      roomRevenuePaise: 1_000_000,
      taxPaise: 0,
      commissionBps: 1395,
      initiator: 'OWNER',
    });
    expect(r.refundPaise).toBe(1_000_000);
    expect(r.ownerPayoutPaise).toBe(0);
  });

  it('refund + retained always equals the amount paid (property)', () => {
    fc.assert(
      fc.property(fc.nat(100_000_000), fc.nat(10_000_000), fc.integer({ min: -100, max: 1000 }), (room, tax, h) => {
        const r = computeCancellationRefund({
          rules: moderate,
          checkInAt,
          cancelAt: hoursBefore(h),
          roomRevenuePaise: room,
          taxPaise: tax,
          commissionBps: 1395,
          initiator: 'CUSTOMER',
        });
        expect(r.refundPaise + r.retainedRoomRevenuePaise + r.retainedTaxPaise).toBe(room + tax);
        expect(r.commissionPaise + r.ownerPayoutPaise).toBe(r.retainedRoomRevenuePaise);
      }),
    );
  });
});
