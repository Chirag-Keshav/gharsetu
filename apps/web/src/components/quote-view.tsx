'use client';
import { statusLabel } from '@propcare/shared';
import { dateLabel, inr, pct } from '@/lib/format';

export interface QuoteLine {
  id?: string;
  description: string;
  quantity: string;
  unit: string;
  unitPricePaise: number;
  taxRateBps: number;
  lineTotalPaise?: number;
  lineTaxPaise?: number;
  lineType: string;
  direction: string;
  internalCostPaise?: number | null;
}

export interface Quote {
  id: string;
  reference: string;
  requestId: string;
  quoteType: string;
  workOrderId: string | null;
  version: number;
  status: string;
  lineItems: QuoteLine[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  scope: string | null;
  exclusions: string[];
  assumptions: string[];
  estimatedDuration: string | null;
  validUntil: string | null;
  sentAt: string | null;
  approvedAt: string | null;
  internalCostPaise?: number;
  marginPaise?: number;
}

/** Read-only quote table: the exact lines and totals the owner approves. */
export function QuoteTable({ q }: { q: Quote }) {
  return (
    <div className="space-y-3 text-sm">
      {q.scope && <p className="whitespace-pre-wrap">{q.scope}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-1 font-medium">Item</th>
              <th className="py-1 text-right font-medium">Qty</th>
              <th className="py-1 text-right font-medium">Rate</th>
              <th className="py-1 text-right font-medium">Tax</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.lineItems.map((l, i) => (
              <tr key={l.id ?? i}>
                <td className="py-1.5">
                  {l.description}
                  <span className="block text-xs text-muted">{statusLabel(l.lineType)}</span>
                </td>
                <td className="py-1.5 text-right">
                  {Number(l.quantity)} {l.unit}
                </td>
                <td className="py-1.5 text-right">{inr(l.unitPricePaise)}</td>
                <td className="py-1.5 text-right">{pct(l.taxRateBps)}</td>
                <td className="py-1.5 text-right">
                  {l.direction === 'DEDUCT' ? '−' : ''}
                  {inr(l.lineTotalPaise)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-2 text-right text-muted">Subtotal</td>
              <td className="pt-2 text-right">{inr(q.subtotalPaise)}</td>
            </tr>
            <tr>
              <td colSpan={4} className="text-right text-muted">Tax</td>
              <td className="text-right">{inr(q.taxPaise)}</td>
            </tr>
            <tr className="font-semibold">
              <td colSpan={4} className="text-right">Total</td>
              <td className="text-right">{inr(q.totalPaise)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {(q.exclusions.length > 0 || q.assumptions.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {q.exclusions.length > 0 && (
            <div>
              <p className="font-medium">Not included</p>
              <ul className="list-disc pl-5 text-muted">{q.exclusions.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {q.assumptions.length > 0 && (
            <div>
              <p className="font-medium">Assumptions</p>
              <ul className="list-disc pl-5 text-muted">{q.assumptions.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted">
        {q.estimatedDuration && `Estimated duration: ${q.estimatedDuration} · `}
        {q.validUntil && `Valid until ${dateLabel(q.validUntil)}`}
      </p>
    </div>
  );
}
