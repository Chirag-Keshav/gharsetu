import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError, describeError } from './api';
import { dateLabel, dateTimeLabel, inr, pct, rupeesInput, toneOf } from './format';

describe('formatting', () => {
  it('formats paise as Indian rupees', () => {
    expect(inr(1290750)).toBe('₹12,907.50');
    expect(inr(1400000)).toBe('₹14,000');
    expect(inr(null)).toBe('—');
  });

  it('formats basis points without trailing zeros', () => {
    expect(pct(1395)).toBe('13.95%');
    expect(pct(1550)).toBe('15.5%');
    expect(pct(2000)).toBe('20%');
    expect(pct(0)).toBe('0%');
  });

  it('shows calendar dates as dates and instants in IST', () => {
    expect(dateLabel('2026-12-14')).toContain('14 Dec');
    expect(dateTimeLabel('2026-10-20T08:30:00.000Z')).toMatch(/2:00\s?pm IST$/i);
  });

  it('round-trips rupee inputs and maps statuses to tones', () => {
    expect(rupeesInput(380000)).toBe('3800');
    expect(toneOf('CONFIRMED')).toBe('ok');
    expect(toneOf('SAFETY_RISK')).toBe('danger');
    expect(toneOf('SOMETHING_NEW')).toBe('neutral');
  });
});

describe('describeError', () => {
  it('turns terse detail codes into readable text', () => {
    const err = new ApiError(400, 'VALIDATION_FAILED', 'Some details need attention.', [{ path: 'evidence', code: 'MISSING_BEFORE', message: '0/1' }]);
    expect(describeError(err)).toBe('Some details need attention. Missing before 0/1');
  });

  it('keeps full sentences from the API', () => {
    const err = new ApiError(400, 'VALIDATION_FAILED', 'Check the form.', [{ path: 'pinCode', message: 'Enter a 6-digit PIN code' }]);
    expect(describeError(err)).toBe('Check the form. Enter a 6-digit PIN code');
  });
});

describe('HTML pattern attributes', () => {
  // Browsers compile `pattern` with the `v` flag, where an unescaped "-" in a class is a syntax
  // error and silently disables validation. Every pattern in the app must compile that way.
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));
  const patterns = walk(path.resolve(__dirname, '..'))
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/pattern="([^"]+)"/g)].map((m) => ({ file: path.basename(f), pattern: m[1] })));

  it('finds the patterns', () => expect(patterns.length).toBeGreaterThan(5));
  it.each(patterns)('$file: $pattern compiles with the v flag', ({ pattern }) => {
    expect(() => new RegExp(`^(?:${pattern})$`, 'v')).not.toThrow();
  });
});
