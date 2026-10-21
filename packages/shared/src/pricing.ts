/**
 * PricingService maths (SPEC §7 rules 3 and 13). Pure functions so API, web previews and tests agree.
 */
import { addDays, diffDays, eachNight, istInstant, type IsoDate, weekdayOf } from './dates';
import type { LineDirection, LineType, Weekday } from './enums';
import { applyBps, mulDivRoundHalfUp, parseQuantityMilli } from './money';

// ---------------------------------------------------------------------------------------------
// Maintenance quotes
// ---------------------------------------------------------------------------------------------

export interface QuoteLineInput {
  quantity: string;
  unitPricePaise: number;
  taxRateBps: number;
  direction: LineDirection;
  lineType: LineType;
}

export interface QuoteLineComputed extends QuoteLineInput {
  quantityMilli: number;
  lineTotalPaise: number;
  lineTaxPaise: number;
}

export interface QuoteTotals {
  lines: QuoteLineComputed[];
  addSubtotalPaise: number;
  deductSubtotalPaise: number;
  /** Σ DISCOUNT-type deductions, used for the discount approval threshold. */
  discountPaise: number;
  /** discountPaise relative to the additions, in basis points (rounded half-up). */
  discountBps: number;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export function computeQuoteLine(line: QuoteLineInput): QuoteLineComputed {
  const quantityMilli = parseQuantityMilli(line.quantity);
  const lineTotalPaise = mulDivRoundHalfUp(quantityMilli, line.unitPricePaise, 1000);
  const lineTaxPaise = applyBps(lineTotalPaise, line.taxRateBps);
  return { ...line, quantityMilli, lineTotalPaise, lineTaxPaise };
}

/**
 * subtotal = Σ ADD − Σ DEDUCT; tax = Σ line tax (signed the same way); total = subtotal + tax.
 * Results can be negative when deductions exceed additions; callers reject such quotes.
 */
export function computeQuoteTotals(lines: QuoteLineInput[]): QuoteTotals {
  const computed = lines.map(computeQuoteLine);
  let add = 0;
  let deduct = 0;
  let tax = 0;
  let discount = 0;
  for (const l of computed) {
    if (l.direction === 'ADD') {
      add += l.lineTotalPaise;
      tax += l.lineTaxPaise;
    } else {
      deduct += l.lineTotalPaise;
      tax -= l.lineTaxPaise;
      if (l.lineType === 'DISCOUNT') discount += l.lineTotalPaise;
    }
  }
  const subtotal = add - deduct;
  return {
    lines: computed,
    addSubtotalPaise: add,
    deductSubtotalPaise: deduct,
    discountPaise: discount,
    discountBps: add > 0 ? mulDivRoundHalfUp(discount, 10_000, add) : 0,
    subtotalPaise: subtotal,
    taxPaise: tax,
    totalPaise: subtotal + tax,
  };
}

export interface QuoteSendCheckInput {
  lines: Array<{ quantity: string }>;
  totals: Pick<QuoteTotals, 'totalPaise' | 'subtotalPaise' | 'taxPaise'>;
  validUntil: Date;
  scope: string | null | undefined;
  now: Date;
}

/** SPEC §7 rule 2. Returns the list of failed checks (empty = OK to send). */
export function quoteSendProblems(input: QuoteSendCheckInput): string[] {
  const problems: string[] = [];
  if (input.lines.length === 0) problems.push('NO_LINE_ITEMS');
  if (input.validUntil.getTime() <= input.now.getTime()) problems.push('VALID_UNTIL_NOT_FUTURE');
  if (input.totals.totalPaise <= 0) problems.push('TOTAL_NOT_POSITIVE');
  if (input.totals.subtotalPaise < 0 || input.totals.taxPaise < 0) problems.push('NEGATIVE_AMOUNT');
  if (!input.scope || !input.scope.trim()) problems.push('SCOPE_MISSING');
  if (input.lines.some((l) => parseQuantityMilli(l.quantity) <= 0)) problems.push('QUANTITY_NOT_POSITIVE');
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Stays
// ---------------------------------------------------------------------------------------------

export interface SeasonalRule {
  startDate: IsoDate;
  /** Inclusive. */
  endDate: IsoDate;
  nightlyPricePaise: number;
}

export interface StayPricingInput {
  basePricePaise: number;
  weekendPricePaise?: number | null;
  cleaningFeePaise: number;
  priceRules: SeasonalRule[];
  weekendNights: Weekday[];
  taxRateBps: number;
}

export type NightBasis = 'BASE' | 'WEEKEND' | 'SEASONAL';

export interface NightPrice {
  date: IsoDate;
  pricePaise: number;
  basis: NightBasis;
}

export interface StayPrice {
  currency: 'INR';
  nights: NightPrice[];
  nightsTotalPaise: number;
  cleaningFeePaise: number;
  roomRevenuePaise: number;
  taxPaise: number;
  totalPaise: number;
}

export function nightlyPrice(input: StayPricingInput, date: IsoDate): NightPrice {
  const rule = input.priceRules.find((r) => r.startDate <= date && date <= r.endDate);
  if (rule) return { date, pricePaise: rule.nightlyPricePaise, basis: 'SEASONAL' };
  if (input.weekendPricePaise != null && input.weekendNights.includes(weekdayOf(date))) {
    return { date, pricePaise: input.weekendPricePaise, basis: 'WEEKEND' };
  }
  return { date, pricePaise: input.basePricePaise, basis: 'BASE' };
}

export function priceStay(input: StayPricingInput, checkIn: IsoDate, checkOut: IsoDate): StayPrice {
  const nights = eachNight(checkIn, checkOut).map((d) => nightlyPrice(input, d));
  const nightsTotalPaise = nights.reduce((sum, n) => sum + n.pricePaise, 0);
  const roomRevenuePaise = nightsTotalPaise + input.cleaningFeePaise;
  const taxPaise = applyBps(roomRevenuePaise, input.taxRateBps);
  return {
    currency: 'INR',
    nights,
    nightsTotalPaise,
    cleaningFeePaise: input.cleaningFeePaise,
    roomRevenuePaise,
    taxPaise,
    totalPaise: roomRevenuePaise + taxPaise,
  };
}

export interface StayRules {
  minNights: number;
  maxNights: number;
  maxGuests: number;
  advanceNoticeHours: number;
  maxAdvanceDays: number;
  checkInTime: string;
}

export const STAY_PROBLEMS = [
  'CHECKOUT_NOT_AFTER_CHECKIN',
  'MIN_NIGHTS',
  'MAX_NIGHTS',
  'TOO_MANY_GUESTS',
  'ADVANCE_NOTICE',
  'BEYOND_BOOKING_WINDOW',
] as const;
export type StayProblem = (typeof STAY_PROBLEMS)[number];

/** Validates nights, guests, advance notice and booking window (SPEC §7 rule 13). */
export function stayRequestProblems(
  rules: StayRules,
  req: { checkIn: IsoDate; checkOut: IsoDate; guests: number },
  now: Date,
  todayIst: IsoDate,
): StayProblem[] {
  const problems: StayProblem[] = [];
  const nights = diffDays(req.checkIn, req.checkOut);
  if (nights <= 0) return ['CHECKOUT_NOT_AFTER_CHECKIN'];
  if (nights < rules.minNights) problems.push('MIN_NIGHTS');
  if (nights > rules.maxNights) problems.push('MAX_NIGHTS');
  if (req.guests > rules.maxGuests) problems.push('TOO_MANY_GUESTS');
  const checkInAt = istInstant(req.checkIn, rules.checkInTime);
  if (checkInAt.getTime() - now.getTime() < rules.advanceNoticeHours * 3_600_000) problems.push('ADVANCE_NOTICE');
  if (req.checkIn > addDays(todayIst, rules.maxAdvanceDays)) problems.push('BEYOND_BOOKING_WINDOW');
  return problems;
}
