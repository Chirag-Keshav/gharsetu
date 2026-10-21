'use client';
import { useMemo, useState } from 'react';
import { del, post, useApi } from '@/lib/api';
import { dateLabel, inr, rupeesInput, todayIst } from '@/lib/format';
import { useAction } from '@/lib/use-action';
import { rupeesToPaise } from '@propcare/shared';
import { Button, Card, ErrorAlert, Form, TextField, cx } from './ui';

interface Occupancy {
  id: string;
  kind: string;
  startDate: string;
  endDate: string;
  label: string;
  bookingId: string | null;
  removable: boolean;
}

const KIND_CLASS: Record<string, string> = {
  BOOKING: 'bg-brand text-brand-ink',
  HOLD: 'bg-warn-soft text-warn',
  BLOCK_OWNER: 'bg-surface-2 text-muted line-through',
  BLOCK_ADMIN: 'bg-surface-2 text-muted line-through',
  BLOCK_MAINTENANCE: 'bg-info-soft text-info',
};

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Owner calendar: bookings, holds, maintenance and owner blocks for the next 12 weeks, plus blocking and seasonal prices. */
export function OwnerCalendar({ listingId, basePricePaise }: { listingId: string; basePricePaise: number }) {
  const from = todayIst();
  const to = addDays(from, 83);
  const cal = useApi<{ items: Occupancy[] }>(`/listings/${listingId}/calendar?from=${from}&to=${to}`);
  const rules = useApi<{ items: Array<{ id: string; startDate: string; endDate: string; nightlyPricePaise: number; reason: string | null }> }>(`/listings/${listingId}/price-rules`);
  const [block, setBlock] = useState({ startDate: '', endDate: '', note: '' });
  const [rule, setRule] = useState({ startDate: '', endDate: '', price: '', reason: '' });
  const { busy, error, run } = useAction();

  const days = useMemo(() => Array.from({ length: 84 }, (_, i) => addDays(from, i)), [from]);
  const occupancyOf = (d: string) => cal.data?.items.find((o) => o.startDate <= d && d < o.endDate);
  const priceOf = (d: string) => rules.data?.items.find((r) => r.startDate <= d && d <= r.endDate)?.nightlyPricePaise;

  return (
    <div className="space-y-6">
      <Card title="Next 12 weeks">
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-brand" /> Booked</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-warn-soft" /> Held / requested</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-info-soft" /> Maintenance</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-surface-2" /> Blocked</span>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="font-medium text-muted">{d}</div>
          ))}
          {Array.from({ length: (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => <div key={`pad-${i}`} />)}
          {days.map((d) => {
            const o = occupancyOf(d);
            const special = priceOf(d);
            return (
              <div key={d} title={o ? o.label : special ? `Seasonal price ${inr(special)}` : undefined} className={cx('rounded-md border border-line px-1 py-1.5', o && KIND_CLASS[o.kind])}>
                <div className="font-medium">{Number(d.slice(8))}</div>
                <div className="truncate text-[10px] opacity-80">{o ? o.label : special ? inr(special) : ''}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Block dates">
          <Form
            className="space-y-3"
            onSubmit={() =>
              run('block', async () => {
                await post(`/listings/${listingId}/blocks`, { startDate: block.startDate, endDate: block.endDate, note: block.note || null });
                setBlock({ startDate: '', endDate: '', note: '' });
                await cal.mutate();
              })
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <TextField label="From" type="date" required min={from} value={block.startDate} onChange={(e) => setBlock({ ...block, startDate: e.target.value })} />
              <TextField label="Until (check-out day)" type="date" required min={block.startDate || from} value={block.endDate} onChange={(e) => setBlock({ ...block, endDate: e.target.value })} />
            </div>
            <TextField label="Note (only you see this)" maxLength={200} value={block.note} onChange={(e) => setBlock({ ...block, note: e.target.value })} />
            <Button type="submit" variant="secondary" busy={busy === 'block'}>
              Block dates
            </Button>
          </Form>
          <ul className="mt-4 space-y-1 text-sm">
            {cal.data?.items
              .filter((o) => o.removable)
              .map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <span>
                    {dateLabel(o.startDate, { year: undefined })} → {dateLabel(o.endDate, { year: undefined })} · {o.label}
                  </span>
                  <Button size="sm" variant="ghost" busy={busy === o.id} onClick={() => run(o.id, async () => { await del(`/listings/${listingId}/blocks/${o.id}`); await cal.mutate(); })}>
                    Unblock
                  </Button>
                </li>
              ))}
          </ul>
        </Card>
        <Card title="Seasonal prices">
          <Form
            className="space-y-3"
            onSubmit={() =>
              run('rule', async () => {
                await post(`/listings/${listingId}/price-rules`, { startDate: rule.startDate, endDate: rule.endDate, nightlyPricePaise: rupeesToPaise(rule.price) ?? 0, reason: rule.reason || null });
                setRule({ startDate: '', endDate: '', price: '', reason: '' });
                await rules.mutate();
              })
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <TextField label="First night" type="date" required min={from} value={rule.startDate} onChange={(e) => setRule({ ...rule, startDate: e.target.value })} />
              <TextField label="Last night" type="date" required min={rule.startDate || from} value={rule.endDate} onChange={(e) => setRule({ ...rule, endDate: e.target.value })} />
            </div>
            <TextField label="Nightly price (₹)" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder={rupeesInput(basePricePaise)} value={rule.price} onChange={(e) => setRule({ ...rule, price: e.target.value })} />
            <TextField label="Reason (optional)" maxLength={200} value={rule.reason} onChange={(e) => setRule({ ...rule, reason: e.target.value })} placeholder="Festival week" />
            <Button type="submit" variant="secondary" busy={busy === 'rule'}>
              Add price
            </Button>
          </Form>
          <ul className="mt-4 space-y-1 text-sm">
            {rules.data?.items.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span>
                  {dateLabel(r.startDate, { year: undefined })} – {dateLabel(r.endDate, { year: undefined })}: {inr(r.nightlyPricePaise)}
                  {r.reason && <span className="text-muted"> · {r.reason}</span>}
                </span>
                <Button size="sm" variant="ghost" busy={busy === r.id} onClick={() => run(r.id, async () => { await del(`/listings/${listingId}/price-rules/${r.id}`); await rules.mutate(); })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <ErrorAlert error={error} />
    </div>
  );
}
