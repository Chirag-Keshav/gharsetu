/**
 * Money utilities (SPEC §5 "Money"). Amounts are integer paise; rates are basis points; rounding is
 * half-up to the nearest paisa. Intermediate products use BigInt so nothing ever touches floats.
 */

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${value}`);
  }
}

/** Computes round_half_up(a × b / c) for non-negative integers. */
export function mulDivRoundHalfUp(a: number, b: number, c: number): number {
  assertNonNegativeInt(a, 'a');
  assertNonNegativeInt(b, 'b');
  if (!Number.isSafeInteger(c) || c <= 0) throw new RangeError(`c must be a positive integer, got ${c}`);
  const numerator = BigInt(a) * BigInt(b);
  const divisor = BigInt(c);
  let quotient = numerator / divisor;
  const remainder = numerator % divisor;
  if (remainder * 2n >= divisor) quotient += 1n;
  const result = Number(quotient);
  if (!Number.isSafeInteger(result)) throw new RangeError('Result exceeds safe integer range');
  return result;
}

/** round_half_up(amount × bps / 10000). */
export function applyBps(amountPaise: number, bps: number): number {
  return mulDivRoundHalfUp(amountPaise, bps, 10_000);
}

const QUANTITY_RE = /^\d{1,9}(\.\d{1,3})?$/;

/** Parses a quantity with up to three decimals (NUMERIC(12,3)) into thousandths. */
export function parseQuantityMilli(quantity: string | number): number {
  const text = typeof quantity === 'number' ? String(quantity) : quantity.trim();
  if (!QUANTITY_RE.test(text)) throw new RangeError(`Invalid quantity: ${quantity}`);
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
}

export function formatQuantityMilli(milli: number): string {
  assertNonNegativeInt(milli, 'milli');
  const whole = Math.floor(milli / 1000);
  const frac = String(milli % 1000).padStart(3, '0');
  return `${whole}.${frac}`;
}

export function isValidQuantity(quantity: string): boolean {
  return QUANTITY_RE.test(quantity.trim());
}

/** Formats paise as Indian rupees, e.g. 129075050 → "₹12,90,750.50". */
export function formatInr(paise: number, opts: { withPaise?: boolean } = {}): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const grouped = rupees.toLocaleString('en-IN');
  const showPaise = opts.withPaise ?? p !== 0;
  return `${negative ? '−' : ''}₹${grouped}${showPaise ? '.' + String(p).padStart(2, '0') : ''}`;
}

/** Converts a rupee amount typed by a person ("1,250.5") into paise; returns null when invalid. */
export function rupeesToPaise(input: string | number): number | null {
  const text = String(input).replace(/[,\s₹]/g, '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function bpsToPercentString(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`;
}
