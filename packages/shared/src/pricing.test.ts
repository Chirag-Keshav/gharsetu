import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { istInstant } from './dates';
import { computeQuoteTotals, priceStay, quoteSendProblems, stayRequestProblems, type QuoteLineInput } from './pricing';

describe('maintenance quote totals (SPEC §7 rule 3)', () => {
  it('matches the Appendix A.2 example', () => {
    const totals = computeQuoteTotals([
      { quantity: '1.000', unitPricePaise: 180000, taxRateBps: 0, direction: 'ADD', lineType: 'LABOUR' },
      { quantity: '1.000', unitPricePaise: 45000, taxRateBps: 0, direction: 'ADD', lineType: 'MATERIAL' },
    ]);
    expect(totals.subtotalPaise).toBe(225000);
    expect(totals.taxPaise).toBe(0);
    expect(totals.totalPaise).toBe(225000);
  });

  it('rounds per line and subtracts deductions', () => {
    const totals = computeQuoteTotals([
      { quantity: '2.5', unitPricePaise: 333, taxRateBps: 1800, direction: 'ADD', lineType: 'LABOUR' }, // 832.5→833, tax 149.94→150
      { quantity: '1', unitPricePaise: 100, taxRateBps: 1800, direction: 'DEDUCT', lineType: 'DISCOUNT' }, // 100, tax 18
    ]);
    expect(totals.lines[0].lineTotalPaise).toBe(833);
    expect(totals.lines[0].lineTaxPaise).toBe(150);
    expect(totals.subtotalPaise).toBe(733);
    expect(totals.taxPaise).toBe(132);
    expect(totals.totalPaise).toBe(865);
    expect(totals.discountPaise).toBe(100);
    expect(totals.discountBps).toBe(1200); // 100 / 833 = 12.0 %
  });

  it('totals always equal the sum of parts (property)', () => {
    const line = fc.record({
      quantity: fc.integer({ min: 1, max: 100_000 }).map((m) => (m / 1000).toFixed(3)),
      unitPricePaise: fc.nat(10_000_000),
      taxRateBps: fc.integer({ min: 0, max: 2800 }),
      direction: fc.constantFrom('ADD' as const, 'DEDUCT' as const),
      lineType: fc.constantFrom('LABOUR' as const, 'MATERIAL' as const, 'DISCOUNT' as const),
    });
    fc.assert(
      fc.property(fc.array(line, { maxLength: 20 }), (lines: QuoteLineInput[]) => {
        const t = computeQuoteTotals(lines);
        const sign = (d: string) => (d === 'ADD' ? 1 : -1);
        const sub = t.lines.reduce((s, l) => s + sign(l.direction) * l.lineTotalPaise, 0);
        const tax = t.lines.reduce((s, l) => s + sign(l.direction) * l.lineTaxPaise, 0);
        expect(t.subtotalPaise).toBe(sub);
        expect(t.taxPaise).toBe(tax);
        expect(t.totalPaise).toBe(sub + tax);
        for (const l of t.lines) {
          expect(Number.isInteger(l.lineTotalPaise)).toBe(true);
          expect(Number.isInteger(l.lineTaxPaise)).toBe(true);
        }
      }),
    );
  });

  it('validates quotes before sending (SPEC §7 rule 2)', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const lines = [{ quantity: '1', unitPricePaise: 100, taxRateBps: 0, direction: 'ADD' as const, lineType: 'LABOUR' as const }];
    const ok = quoteSendProblems({ lines, totals: computeQuoteTotals(lines), validUntil: new Date('2026-10-27T00:00:00Z'), scope: 'Fix', now });
    expect(ok).toEqual([]);
    const bad = quoteSendProblems({
      lines: [],
      totals: computeQuoteTotals([]),
      validUntil: new Date('2026-10-19T00:00:00Z'),
      scope: ' ',
      now,
    });
    expect(bad).toEqual(expect.arrayContaining(['NO_LINE_ITEMS', 'VALID_UNTIL_NOT_FUTURE', 'TOTAL_NOT_POSITIVE', 'SCOPE_MISSING']));
  });
});

describe('stay pricing (SPEC §7 rule 13, Appendix A.3)', () => {
  const input = {
    basePricePaise: 400000,
    weekendPricePaise: 500000,
    cleaningFeePaise: 100000,
    priceRules: [],
    weekendNights: ['FRI' as const, 'SAT' as const],
    taxRateBps: 0,
  };

  it('prices Thursday to Sunday like the worked example', () => {
    const q = priceStay(input, '2026-11-12', '2026-11-15');
    expect(q.nights).toEqual([
      { date: '2026-11-12', pricePaise: 400000, basis: 'BASE' },
      { date: '2026-11-13', pricePaise: 500000, basis: 'WEEKEND' },
      { date: '2026-11-14', pricePaise: 500000, basis: 'WEEKEND' },
    ]);
    expect(q.nightsTotalPaise).toBe(1400000);
    expect(q.roomRevenuePaise).toBe(1500000);
    expect(q.totalPaise).toBe(1500000);
  });

  it('applies seasonal rules over weekend and base prices', () => {
    const q = priceStay(
      { ...input, priceRules: [{ startDate: '2026-11-13', endDate: '2026-11-13', nightlyPricePaise: 900000 }] },
      '2026-11-12',
      '2026-11-15',
    );
    expect(q.nights.map((n) => n.basis)).toEqual(['BASE', 'SEASONAL', 'WEEKEND']);
    expect(q.nightsTotalPaise).toBe(400000 + 900000 + 500000);
  });

  it('validates nights, guests, notice and window', () => {
    const rules = { minNights: 2, maxNights: 5, maxGuests: 4, advanceNoticeHours: 24, maxAdvanceDays: 90, checkInTime: '14:00' };
    const now = new Date('2026-10-20T06:00:00Z');
    expect(stayRequestProblems(rules, { checkIn: '2026-11-12', checkOut: '2026-11-15', guests: 4 }, now, '2026-10-20')).toEqual([]);
    expect(stayRequestProblems(rules, { checkIn: '2026-11-12', checkOut: '2026-11-13', guests: 5 }, now, '2026-10-20')).toEqual([
      'MIN_NIGHTS',
      'TOO_MANY_GUESTS',
    ]);
    // Check-in tomorrow 14:00 IST is 08:30Z tomorrow: 26.5 h away → OK; today → too soon.
    expect(stayRequestProblems(rules, { checkIn: '2026-10-20', checkOut: '2026-10-22', guests: 1 }, now, '2026-10-20')).toContain('ADVANCE_NOTICE');
    expect(stayRequestProblems(rules, { checkIn: '2027-03-01', checkOut: '2027-03-03', guests: 1 }, now, '2026-10-20')).toContain(
      'BEYOND_BOOKING_WINDOW',
    );
    expect(istInstant('2026-10-21', '14:00').toISOString()).toBe('2026-10-21T08:30:00.000Z');
  });
});
