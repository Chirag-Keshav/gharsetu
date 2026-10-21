import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyBps,
  formatInr,
  formatQuantityMilli,
  mulDivRoundHalfUp,
  parseQuantityMilli,
  rupeesToPaise,
} from './money';

describe('mulDivRoundHalfUp', () => {
  it('rounds half up', () => {
    expect(mulDivRoundHalfUp(1, 1, 2)).toBe(1); // 0.5 → 1
    expect(mulDivRoundHalfUp(1, 1, 3)).toBe(0); // 0.33 → 0
    expect(mulDivRoundHalfUp(2, 1, 3)).toBe(1); // 0.67 → 1
    expect(mulDivRoundHalfUp(13175, 1, 10)).toBe(1318); // 1317.5 → 1318 (Appendix A.3)
  });

  it('rejects negatives and floats', () => {
    expect(() => mulDivRoundHalfUp(-1, 1, 1)).toThrow();
    expect(() => mulDivRoundHalfUp(1.5, 1, 1)).toThrow();
  });

  it('matches exact rational rounding for random inputs', () => {
    fc.assert(
      fc.property(fc.nat(10_000_000), fc.nat(10_000), fc.integer({ min: 1, max: 100_000 }), (a, b, c) => {
        const r = mulDivRoundHalfUp(a, b, c);
        const exact = (BigInt(a) * BigInt(b) * 2n) / BigInt(c); // floor(2x)
        // r is the unique integer with r - 0.5 <= x < r + 0.5
        expect(BigInt(r) * 2n <= exact + 1n).toBe(true);
        expect(Number.isInteger(r)).toBe(true);
        expect(Math.abs(r - (a * b) / c)).toBeLessThanOrEqual(0.5 + 1e-9);
      }),
    );
  });
});

describe('quantities and formatting', () => {
  it('parses quantities with up to three decimals', () => {
    expect(parseQuantityMilli('1')).toBe(1000);
    expect(parseQuantityMilli('1.5')).toBe(1500);
    expect(parseQuantityMilli('0.125')).toBe(125);
    expect(() => parseQuantityMilli('1.2345')).toThrow();
    expect(() => parseQuantityMilli('-1')).toThrow();
    expect(formatQuantityMilli(1500)).toBe('1.500');
  });

  it('formats INR with Indian grouping', () => {
    expect(formatInr(129075000)).toBe('₹12,90,750');
    expect(formatInr(1290750)).toBe('₹12,907.50');
    expect(rupeesToPaise('12,907.5')).toBe(1290750);
    expect(rupeesToPaise('abc')).toBeNull();
  });

  it('applies basis points', () => {
    expect(applyBps(1_500_000, 1395)).toBe(209_250);
  });
});
