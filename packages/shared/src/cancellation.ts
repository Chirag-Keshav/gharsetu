/**
 * Cancellation and refunds (SPEC §7 rule 16). Tiers are evaluated from the highest threshold down,
 * measured against the check-in instant in IST.
 */
import { z } from 'zod';
import { computeBookingCommission } from './commission';
import { applyBps } from './money';

export const cancellationTierSchema = z.object({
  hoursBeforeCheckInAtLeast: z.number().int().min(0),
  refundBps: z.number().int().min(0).max(10_000),
});
export const cancellationRulesSchema = z.array(cancellationTierSchema).max(10);
export type CancellationTier = z.infer<typeof cancellationTierSchema>;

export type CancellationInitiator = 'CUSTOMER' | 'OWNER' | 'ADMIN';

export function selectRefundBps(rules: CancellationTier[], hoursBeforeCheckIn: number): number {
  const sorted = [...rules].sort((a, b) => b.hoursBeforeCheckInAtLeast - a.hoursBeforeCheckInAtLeast);
  for (const tier of sorted) {
    if (hoursBeforeCheckIn >= tier.hoursBeforeCheckInAtLeast) return tier.refundBps;
  }
  return 0;
}

export interface RefundInput {
  rules: CancellationTier[];
  checkInAt: Date;
  cancelAt: Date;
  roomRevenuePaise: number;
  taxPaise: number;
  commissionBps: number;
  initiator: CancellationInitiator;
  /** Admin (FINANCE) may choose a different refund share with a reason; defaults to full refund. */
  adminRefundBps?: number;
}

export interface RefundResult {
  refundBps: number;
  hoursBeforeCheckIn: number;
  refundedRoomRevenuePaise: number;
  refundedTaxPaise: number;
  refundPaise: number;
  retainedRoomRevenuePaise: number;
  retainedTaxPaise: number;
  commissionPaise: number;
  ownerPayoutPaise: number;
}

export function computeCancellationRefund(input: RefundInput): RefundResult {
  const hoursBeforeCheckIn = (input.checkInAt.getTime() - input.cancelAt.getTime()) / 3_600_000;
  let refundBps: number;
  if (input.initiator === 'CUSTOMER') refundBps = selectRefundBps(input.rules, hoursBeforeCheckIn);
  else if (input.initiator === 'OWNER') refundBps = 10_000;
  else refundBps = input.adminRefundBps ?? 10_000;

  const refundedRoomRevenuePaise = applyBps(input.roomRevenuePaise, refundBps);
  const refundedTaxPaise = applyBps(input.taxPaise, refundBps);
  const retainedRoomRevenuePaise = input.roomRevenuePaise - refundedRoomRevenuePaise;
  const { commissionPaise, ownerPayoutPaise } = computeBookingCommission(retainedRoomRevenuePaise, input.commissionBps);
  return {
    refundBps,
    hoursBeforeCheckIn,
    refundedRoomRevenuePaise,
    refundedTaxPaise,
    refundPaise: refundedRoomRevenuePaise + refundedTaxPaise,
    retainedRoomRevenuePaise,
    retainedTaxPaise: input.taxPaise - refundedTaxPaise,
    commissionPaise,
    ownerPayoutPaise,
  };
}
