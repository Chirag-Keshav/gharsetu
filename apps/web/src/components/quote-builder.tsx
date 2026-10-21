'use client';
import { useState } from 'react';
import { computeQuoteTotals, isValidQuantity, LINE_DIRECTIONS, LINE_TYPES, rupeesToPaise, statusLabel } from '@propcare/shared';
import { del, patch, post } from '@/lib/api';
import { inr, rupeesInput } from '@/lib/format';
import { useAction } from '@/lib/use-action';
import { AiPanel } from './shared';
import type { Quote, QuoteLine } from './quote-view';
import { Alert, Button, Card, ErrorAlert, TextArea, TextField } from './ui';

interface EditLine {
  description: string;
  quantity: string;
  unit: string;
  price: string;
  taxPct: string;
  lineType: string;
  direction: string;
  cost: string;
}

const blank = (): EditLine => ({ description: '', quantity: '1', unit: 'job', price: '', taxPct: '18', lineType: 'LABOUR', direction: 'ADD', cost: '' });
const fromLine = (l: QuoteLine): EditLine => ({
  description: l.description,
  quantity: String(Number(l.quantity)),
  unit: l.unit,
  price: rupeesInput(l.unitPricePaise),
  taxPct: String(l.taxRateBps / 100),
  lineType: l.lineType,
  direction: l.direction,
  cost: l.internalCostPaise == null ? '' : rupeesInput(l.internalCostPaise),
});

/** Admin quote builder (SPEC §8.5): live totals from the shared pricing rules; the server recomputes on save. */
export function QuoteBuilder({ requestId, draft, finance, onSaved }: { requestId: string; draft: Quote | null; finance: boolean; onSaved: () => void }) {
  const [lines, setLines] = useState<EditLine[]>(() => (draft?.lineItems.length ? draft.lineItems.map(fromLine) : [blank()]));
  const [scope, setScope] = useState(draft?.scope ?? '');
  const [exclusions, setExclusions] = useState((draft?.exclusions ?? []).join('\n'));
  const [assumptions, setAssumptions] = useState((draft?.assumptions ?? []).join('\n'));
  const [duration, setDuration] = useState(draft?.estimatedDuration ?? '');
  const { busy, error, run } = useAction();

  const payloadLines = lines
    .filter((l) => l.description.trim())
    .map((l) => ({
      description: l.description.trim(),
      quantity: l.quantity,
      unit: l.unit || 'unit',
      unitPricePaise: rupeesToPaise(l.price || '0') ?? 0,
      taxRateBps: Math.round(Number(l.taxPct || 0) * 100),
      lineType: l.lineType,
      direction: l.direction,
      ...(finance && l.cost ? { internalCostPaise: rupeesToPaise(l.cost) ?? 0 } : {}),
    }));
  const valid = payloadLines.every((l) => isValidQuantity(l.quantity));
  const totals = valid ? computeQuoteTotals(payloadLines as Parameters<typeof computeQuoteTotals>[0]) : null;
  const listOf = (t: string) => t.split('\n').map((s) => s.trim()).filter(Boolean);
  const body = { lineItems: payloadLines, scope: scope || null, exclusions: listOf(exclusions), assumptions: listOf(assumptions), estimatedDuration: duration || null };
  const update = (i: number, k: keyof EditLine, v: string) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));

  const save = async () => (draft ? patch<Quote>(`/quotes/${draft.id}`, body) : post<Quote>(`/service-requests/${requestId}/quotes`, body, true));

  return (
    <Card title={draft ? `Draft ${draft.reference} v${draft.version}` : 'New quote'}>
      <div className="space-y-4">
        <AiPanel<{ lineItems: Array<Omit<QuoteLine, 'taxRateBps'>>; outlierWarnings: string[]; rationale: string }>
          feature="quote_draft"
          subjectType="SERVICE_REQUEST"
          subjectId={requestId}
          title="Draft lines"
          autoload={false}
          applyLabel="Use these lines"
          onApply={(o) => setLines(o.lineItems.map((l) => ({ ...fromLine({ ...l, taxRateBps: 1800 }) })))}
        >
          {(o) => (
            <div className="space-y-1">
              <ul className="list-disc pl-5">
                {o.lineItems.map((l, i) => (
                  <li key={i}>
                    {l.description}: {Number(l.quantity)} {l.unit} × {inr(l.unitPricePaise)}
                  </li>
                ))}
              </ul>
              {o.outlierWarnings.map((w) => (
                <p key={w} className="text-warn">⚠ {w}</p>
              ))}
              <p className="text-muted">{o.rationale}</p>
            </div>
          )}
        </AiPanel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="pb-1">Description</th>
                <th className="pb-1">Type</th>
                <th className="pb-1">Qty</th>
                <th className="pb-1">Unit</th>
                <th className="pb-1">Rate ₹</th>
                <th className="pb-1">Tax %</th>
                {finance && <th className="pb-1">Cost ₹</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2">
                    <input aria-label="Description" className="w-full rounded-md border border-line bg-surface px-2 py-1" value={l.description} maxLength={300} onChange={(e) => update(i, 'description', e.target.value)} />
                  </td>
                  <td className="py-1 pr-2">
                    <select aria-label="Line type" className="rounded-md border border-line bg-surface px-1 py-1" value={`${l.lineType}:${l.direction}`} onChange={(e) => { const [t, d] = e.target.value.split(':'); update(i, 'lineType', t); update(i, 'direction', d); }}>
                      {LINE_TYPES.flatMap((t) => LINE_DIRECTIONS.filter((d) => (t === 'DISCOUNT' ? d === 'DEDUCT' : d === 'ADD')).map((d) => <option key={`${t}:${d}`} value={`${t}:${d}`}>{statusLabel(t)}</option>))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label="Quantity" className="w-16 rounded-md border border-line bg-surface px-2 py-1" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, 'quantity', e.target.value)} aria-invalid={!isValidQuantity(l.quantity) || undefined} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label="Unit" className="w-16 rounded-md border border-line bg-surface px-2 py-1" value={l.unit} maxLength={30} onChange={(e) => update(i, 'unit', e.target.value)} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label="Rate in rupees" className="w-24 rounded-md border border-line bg-surface px-2 py-1" inputMode="decimal" value={l.price} onChange={(e) => update(i, 'price', e.target.value)} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label="Tax percent" className="w-14 rounded-md border border-line bg-surface px-2 py-1" inputMode="decimal" value={l.taxPct} onChange={(e) => update(i, 'taxPct', e.target.value)} />
                  </td>
                  {finance && (
                    <td className="py-1 pr-2">
                      <input aria-label="Internal cost in rupees" className="w-24 rounded-md border border-line bg-surface px-2 py-1" inputMode="decimal" value={l.cost} onChange={(e) => update(i, 'cost', e.target.value)} />
                    </td>
                  )}
                  <td className="py-1">
                    <Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, blank()])}>
          Add line
        </Button>
        {totals && (
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{inr(totals.subtotalPaise)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tax</span><span>{inr(totals.taxPaise)}</span></div>
            <div className="flex justify-between font-semibold"><span>Total</span><span>{inr(totals.totalPaise)}</span></div>
          </div>
        )}
        {!valid && <Alert tone="warn">Quantities can have at most three decimals.</Alert>}
        <TextArea label="Scope of work (shown to the owner)" required rows={3} maxLength={5000} value={scope} onChange={(e) => setScope(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextArea label="Exclusions (one per line)" rows={3} value={exclusions} onChange={(e) => setExclusions(e.target.value)} />
          <TextArea label="Assumptions (one per line)" rows={3} value={assumptions} onChange={(e) => setAssumptions(e.target.value)} />
          <TextField label="Estimated duration" maxLength={100} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Half a day" />
        </div>
        <ErrorAlert error={error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" busy={busy === 'save'} disabled={!valid} onClick={() => run('save', async () => { await save(); onSaved(); })}>
            Save draft
          </Button>
          <Button busy={busy === 'send'} disabled={!valid} onClick={() => run('send', async () => { const q = await save(); await post(`/quotes/${q.id}/send`, {}, true); onSaved(); })}>
            Save and send to owner
          </Button>
          {draft && (
            <Button variant="ghost" busy={busy === 'delete'} onClick={() => run('delete', async () => { await del(`/quotes/${draft.id}`); onSaved(); })}>
              Delete draft
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
