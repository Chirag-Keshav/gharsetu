'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { problemMessages } from '@propcare/shared';
import { ApiError, describeError, post, useApi } from '@/lib/api';
import { dateLabel, inr, todayIst } from '@/lib/format';
import { Alert, Button, cx, Form } from './ui';

interface Quote {
  nights: Array<{ date: string; pricePaise: number; basis: string }>;
  nightsTotalPaise: number;
  cleaningFeePaise: number;
  taxPaise: number;
  totalPaise: number;
  bookingMode: string;
}

interface Availability {
  from: string;
  to: string;
  unavailable: string[];
  minNights: number;
  maxNights: number;
}

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Six-month availability with check-out-day turnover (a night ending on a date frees that date). */
export function AvailabilityCalendar({ listingId, onPick, checkIn, checkOut }: { listingId: string; onPick?: (d: string) => void; checkIn?: string; checkOut?: string }) {
  const { data } = useApi<Availability>(`/public/listings/${listingId}/availability`);
  const [offset, setOffset] = useState(0);
  const blocked = useMemo(() => new Set(data?.unavailable ?? []), [data]);
  const today = todayIst();
  const months = [0, 1].map((m) => {
    const base = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    base.setUTCMonth(base.getUTCMonth() + offset + m);
    return base;
  });
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" disabled={offset === 0} onClick={() => setOffset((o) => o - 1)} className="rounded px-2 py-1 text-sm hover:bg-surface-2 disabled:opacity-40" aria-label="Previous month">
          ←
        </button>
        <p className="text-xs text-muted">Struck-out dates are unavailable</p>
        <button type="button" disabled={offset >= 4} onClick={() => setOffset((o) => o + 1)} className="rounded px-2 py-1 text-sm hover:bg-surface-2 disabled:opacity-40" aria-label="Next month">
          →
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {months.map((m) => {
          const year = m.getUTCFullYear();
          const month = m.getUTCMonth();
          const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
          const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
          return (
            <div key={m.toISOString()}>
              <p className="mb-1 text-sm font-medium">{m.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
              <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <span key={i} className="py-1 text-muted" aria-hidden>
                    {d}
                  </span>
                ))}
                {Array.from({ length: first }, (_, i) => (
                  <span key={`e${i}`} />
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
                  const past = iso < today;
                  const taken = blocked.has(iso);
                  const inRange = checkIn && checkOut && iso >= checkIn && iso < checkOut;
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={past || !onPick}
                      onClick={() => onPick?.(iso)}
                      aria-label={`${dateLabel(iso)}${taken ? ', unavailable' : ''}`}
                      className={cx(
                        'rounded py-1.5',
                        past && 'text-muted/50',
                        taken && !past && 'text-muted line-through',
                        inRange && 'bg-brand text-brand-ink',
                        (iso === checkIn || iso === checkOut) && 'ring-2 ring-brand',
                        !past && !taken && !inRange && onPick && 'hover:bg-surface-2',
                      )}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BookingWidget({
  listingId,
  basePricePaise,
  bookingMode,
  maxGuests,
  initial,
}: {
  listingId: string;
  basePricePaise: number;
  bookingMode: string;
  maxGuests: number;
  initial: { checkIn?: string; checkOut?: string; guests?: string };
}) {
  const router = useRouter();
  const [checkIn, setCheckIn] = useState(initial.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(initial.checkOut ?? '');
  const [guests, setGuests] = useState(Number(initial.guests ?? 2));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuote(null);
    setError(null);
    if (!checkIn || !checkOut || checkOut <= checkIn) return;
    let cancelled = false;
    setBusy(true);
    post<Quote>(`/public/listings/${listingId}/price-quote`, { checkIn, checkOut, guests })
      .then((q) => !cancelled && setQuote(q))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') setError(e.details.map((d) => problemMessages[d.code ?? ''] ?? d.message).join(' '));
        else setError(describeError(e));
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [checkIn, checkOut, guests, listingId]);

  const pick = (d: string) => {
    if (!checkIn || (checkIn && checkOut) || d <= checkIn) {
      setCheckIn(d);
      setCheckOut('');
    } else setCheckOut(d);
  };

  const proceed = () => {
    const target = `/book/${listingId}?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`;
    router.push(target);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <p className="text-lg">
          <span className="font-semibold">{inr(basePricePaise)}</span> <span className="text-sm text-muted">/ night from</span>
        </p>
        <Form onSubmit={proceed} className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="rounded-lg border border-line px-3 py-1.5 text-sm">
              <span className="block text-xs text-muted">Check-in</span>
              <input type="date" required min={todayIst()} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="w-full bg-transparent outline-none" />
            </label>
            <label className="rounded-lg border border-line px-3 py-1.5 text-sm">
              <span className="block text-xs text-muted">Check-out</span>
              <input type="date" required min={checkIn ? addDays(checkIn, 1) : todayIst(1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="w-full bg-transparent outline-none" />
            </label>
          </div>
          <label className="block rounded-lg border border-line px-3 py-1.5 text-sm">
            <span className="block text-xs text-muted">Guests (up to {maxGuests})</span>
            <input type="number" min={1} max={maxGuests} value={guests} onChange={(e) => setGuests(Number(e.target.value))} className="w-full bg-transparent outline-none" />
          </label>
          {error && <Alert tone="warn">{error}</Alert>}
          {quote && (
            <div className="space-y-1 text-sm">
              {quote.nights.map((n) => (
                <div key={n.date} className="flex justify-between text-muted">
                  <span>
                    {dateLabel(n.date, { year: undefined })} {n.basis !== 'BASE' && <span className="text-xs">({n.basis.toLowerCase()})</span>}
                  </span>
                  <span>{inr(n.pricePaise)}</span>
                </div>
              ))}
              <div className="flex justify-between text-muted">
                <span>Cleaning fee</span>
                <span>{inr(quote.cleaningFeePaise)}</span>
              </div>
              {quote.taxPaise > 0 && (
                <div className="flex justify-between text-muted">
                  <span>Taxes</span>
                  <span>{inr(quote.taxPaise)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2 font-semibold">
                <span>Total</span>
                <span>{inr(quote.totalPaise)}</span>
              </div>
              <p className="text-xs text-muted">No extra platform fee for guests.</p>
            </div>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={!quote} busy={busy}>
            {bookingMode === 'INSTANT' ? 'Book now' : 'Request to book'}
          </Button>
          {bookingMode !== 'INSTANT' && <p className="text-center text-xs text-muted">The owner approves requests; you pay only after approval.</p>}
        </Form>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold">Availability</h3>
        <AvailabilityCalendar listingId={listingId} onPick={pick} checkIn={checkIn} checkOut={checkOut} />
      </div>
    </div>
  );
}
