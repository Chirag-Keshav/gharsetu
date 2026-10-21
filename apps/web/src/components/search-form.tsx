'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { AI_LABEL, statusLabel } from '@propcare/shared';
import { api, describeError, post } from '@/lib/api';
import { inr, todayIst } from '@/lib/format';
import { Button, cx, Form } from './ui';

export interface SearchValues {
  q?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: string;
}

function toQuery(v: Record<string, string | number | string[] | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, val] of Object.entries(v)) {
    if (val === null || val === undefined || val === '' || (Array.isArray(val) && !val.length)) continue;
    p.set(k, Array.isArray(val) ? val.join(',') : String(val));
  }
  return p.toString();
}

/** Location with autosuggest (published listings only), dates and guests. */
export function SearchForm({ initial = {}, compact = false }: { initial?: SearchValues; compact?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState(initial.q ?? '');
  const [checkIn, setCheckIn] = useState(initial.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(initial.checkOut ?? '');
  const [guests, setGuests] = useState(initial.guests ?? '2');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) return setSuggestions([]);
    const t = setTimeout(() => {
      api<{ items: string[] }>(`/public/locations/suggest?q=${encodeURIComponent(q)}`)
        .then((r) => setSuggestions(r.items))
        .catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Form
      onSubmit={() => router.push(`/search?${toQuery({ q, checkIn, checkOut: checkIn ? checkOut : '', guests })}`)}
      className={cx('grid gap-2 rounded-2xl border border-line bg-surface p-2 shadow-sm', compact ? 'sm:grid-cols-[2fr_1fr_1fr_0.7fr_auto]' : 'sm:grid-cols-[2fr_1fr_1fr_0.7fr_auto] sm:p-3')}
    >
      <label className="flex flex-col rounded-xl px-3 py-1.5 hover:bg-surface-2">
        <span className="text-xs font-medium text-muted">Where</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} list={listId} placeholder="City, area or state" className="bg-transparent text-sm outline-none" autoComplete="off" />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col rounded-xl px-3 py-1.5 hover:bg-surface-2">
        <span className="text-xs font-medium text-muted">Check-in</span>
        <input
          type="date"
          value={checkIn}
          min={todayIst()}
          onChange={(e) => {
            setCheckIn(e.target.value);
            if (checkOut && checkOut <= e.target.value) setCheckOut('');
          }}
          className="bg-transparent text-sm outline-none"
        />
      </label>
      <label className="flex flex-col rounded-xl px-3 py-1.5 hover:bg-surface-2">
        <span className="text-xs font-medium text-muted">Check-out</span>
        <input type="date" value={checkOut} min={checkIn || todayIst(1)} required={!!checkIn} onChange={(e) => setCheckOut(e.target.value)} className="bg-transparent text-sm outline-none" />
      </label>
      <label className="flex flex-col rounded-xl px-3 py-1.5 hover:bg-surface-2">
        <span className="text-xs font-medium text-muted">Guests</span>
        <input type="number" min={1} max={50} value={guests} onChange={(e) => setGuests(e.target.value)} className="w-full bg-transparent text-sm outline-none" />
      </label>
      <Button type="submit" size="lg" className="h-full min-h-12">
        Search
      </Button>
    </Form>
  );
}

interface NlFilters {
  q: string | null;
  checkIn: string | null;
  checkOut: string | null;
  guests: number | null;
  minPricePaise: number | null;
  maxPricePaise: number | null;
  propertyType: string | null;
  amenities: string[];
  bedrooms: number | null;
  minRating: number | null;
}

/**
 * AI natural-language search (AI-CUS-01): the model only proposes filters, shown as editable chips;
 * the search itself stays deterministic.
 */
export function NaturalLanguageSearch() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<NlFilters | null>(null);

  const chips: Array<[keyof NlFilters, string]> = filters
    ? ([
        ['q', filters.q ? `📍 ${filters.q}` : ''],
        ['checkIn', filters.checkIn ? `📅 ${filters.checkIn} → ${filters.checkOut ?? '?'}` : ''],
        ['guests', filters.guests ? `👥 ${filters.guests} guests` : ''],
        ['maxPricePaise', filters.maxPricePaise ? `≤ ${inr(filters.maxPricePaise)} / night` : ''],
        ['propertyType', filters.propertyType ? statusLabel(filters.propertyType) : ''],
        ['bedrooms', filters.bedrooms ? `${filters.bedrooms}+ bedrooms` : ''],
        ['minRating', filters.minRating ? `★ ${filters.minRating}+` : ''],
        ['amenities', filters.amenities.length ? filters.amenities.join(', ') : ''],
      ] as Array<[keyof NlFilters, string]>).filter(([, label]) => label)
    : [];

  const remove = (key: keyof NlFilters) =>
    setFilters((f) => (f ? { ...f, [key]: key === 'amenities' ? [] : null, ...(key === 'checkIn' ? { checkOut: null } : {}) } : f));

  const run = () => {
    if (!filters) return;
    router.push(
      `/search?${toQuery({
        q: filters.q,
        checkIn: filters.checkIn && filters.checkOut ? filters.checkIn : null,
        checkOut: filters.checkIn && filters.checkOut ? filters.checkOut : null,
        guests: filters.guests,
        maxPricePaise: filters.maxPricePaise,
        propertyType: filters.propertyType,
        amenities: filters.amenities,
        bedrooms: filters.bedrooms,
        minRating: filters.minRating,
      })}`,
    );
  };

  return (
    <div className="rounded-2xl border border-ai/30 bg-ai-soft/60 p-3">
      <Form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await post<{ filters: NlFilters }>('/search/parse', { query: text });
            setFilters(res.filters);
          } catch (e) {
            setError(describeError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="sr-only" htmlFor="nl-search">
          Describe your stay
        </label>
        <input
          id="nl-search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          minLength={3}
          placeholder="Try: a villa in Goa for 6 with a pool next weekend under ₹15,000"
          className="h-11 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
        />
        <Button type="submit" variant="ai" busy={busy}>
          ✨ Understand my search
        </Button>
      </Form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {filters && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ai">{AI_LABEL}. Remove anything that looks wrong.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {chips.length === 0 && <span className="text-sm text-muted">No filters found — try adding a place or dates.</span>}
            {chips.map(([key, label]) => (
              <span key={key} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-sm">
                {label}
                <button type="button" onClick={() => remove(key)} aria-label={`Remove ${label}`} className="text-muted hover:text-danger">
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={run}>Search with these filters</Button>
            <Button variant="ghost" onClick={() => setFilters(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
