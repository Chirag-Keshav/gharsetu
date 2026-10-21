import type { Metadata } from 'next';
import Link from 'next/link';
import { PROPERTY_TYPES, statusLabel } from '@propcare/shared';
import { ListingCard } from '@/components/listing-card';
import { SearchForm } from '@/components/search-form';
import { publicApi, type ListingCardData } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Search stays' };

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const key of ['q', 'checkIn', 'checkOut', 'guests', 'propertyType', 'bedrooms', 'minRating', 'sort', 'cursor', 'amenities', 'minPricePaise', 'maxPricePaise']) {
    const v = sp[key];
    const val = Array.isArray(v) ? v.join(',') : v;
    if (val) qs.set(key, val);
  }
  // Rupee inputs from the filter form become paise for the API.
  if (one(sp.minPrice)) qs.set('minPricePaise', String(Math.round(Number(one(sp.minPrice)) * 100)));
  if (one(sp.maxPrice)) qs.set('maxPricePaise', String(Math.round(Number(one(sp.maxPrice)) * 100)));
  const [results, amenities] = await Promise.all([
    publicApi<{ items: ListingCardData[]; nextCursor: string | null }>(`/public/listings?${qs.toString()}`, 20),
    publicApi<{ items: Array<{ slug: string; name: string }> }>('/amenities', 3600),
  ]);
  const selected = new Set(one(sp.amenities).split(',').filter(Boolean));
  const stayQuery = sp.checkIn && sp.checkOut ? `?checkIn=${one(sp.checkIn)}&checkOut=${one(sp.checkOut)}&guests=${one(sp.guests) || '2'}` : '';
  const next = new URLSearchParams(qs);
  if (results?.nextCursor) next.set('cursor', results.nextCursor);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <SearchForm compact initial={{ q: one(sp.q), checkIn: one(sp.checkIn), checkOut: one(sp.checkOut), guests: one(sp.guests) || '2' }} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside aria-label="Filters">
          <form method="get" className="space-y-4 rounded-2xl border border-line bg-surface p-4 text-sm">
            {['q', 'checkIn', 'checkOut', 'guests'].map((k) => (one(sp[k]) ? <input key={k} type="hidden" name={k} value={one(sp[k])} /> : null))}
            <div>
              <label htmlFor="sort" className="mb-1 block font-medium">
                Sort by
              </label>
              <select id="sort" name="sort" defaultValue={one(sp.sort) || 'relevance'} className="w-full rounded-lg border border-line bg-surface px-2 py-2">
                <option value="relevance">Best match</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
                <option value="rating">Rating</option>
                <option value="newest">Newest</option>
              </select>
            </div>
            <fieldset>
              <legend className="mb-1 font-medium">Nightly price (₹)</legend>
              <div className="flex gap-2">
                <input aria-label="Minimum price" name="minPrice" type="number" min={0} placeholder="Min" defaultValue={one(sp.minPrice)} className="w-full rounded-lg border border-line bg-surface px-2 py-2" />
                <input aria-label="Maximum price" name="maxPrice" type="number" min={0} placeholder="Max" defaultValue={one(sp.maxPrice)} className="w-full rounded-lg border border-line bg-surface px-2 py-2" />
              </div>
            </fieldset>
            <div>
              <label htmlFor="propertyType" className="mb-1 block font-medium">
                Property type
              </label>
              <select id="propertyType" name="propertyType" defaultValue={one(sp.propertyType)} className="w-full rounded-lg border border-line bg-surface px-2 py-2">
                <option value="">Any</option>
                {PROPERTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {statusLabel(t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="bedrooms" className="mb-1 block font-medium">
                  Bedrooms
                </label>
                <input id="bedrooms" name="bedrooms" type="number" min={0} defaultValue={one(sp.bedrooms)} className="w-full rounded-lg border border-line bg-surface px-2 py-2" />
              </div>
              <div>
                <label htmlFor="minRating" className="mb-1 block font-medium">
                  Min rating
                </label>
                <select id="minRating" name="minRating" defaultValue={one(sp.minRating)} className="w-full rounded-lg border border-line bg-surface px-2 py-2">
                  <option value="">Any</option>
                  <option value="3">3+</option>
                  <option value="4">4+</option>
                  <option value="4.5">4.5+</option>
                </select>
              </div>
            </div>
            <fieldset>
              <legend className="mb-1 font-medium">Amenities</legend>
              <div className="grid max-h-56 gap-1 overflow-y-auto">
                {(amenities?.items ?? []).map((a) => (
                  <label key={a.slug} className="flex items-center gap-2">
                    <input type="checkbox" name="amenities" value={a.slug} defaultChecked={selected.has(a.slug)} className="accent-[var(--brand)]" />
                    {a.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2">
              <button type="submit" className="flex-1 rounded-lg bg-brand px-3 py-2 font-medium text-brand-ink">
                Apply filters
              </button>
              <Link href="/search" className="rounded-lg border border-line px-3 py-2">
                Reset
              </Link>
            </div>
          </form>
        </aside>
        <section aria-label="Results">
          <h1 className="mb-4 text-lg font-semibold">
            {results ? `${results.items.length}${results.nextCursor ? '+' : ''} stay${results.items.length === 1 ? '' : 's'}` : 'Search is unavailable'}
            {one(sp.q) && <span className="text-muted"> for “{one(sp.q)}”</span>}
          </h1>
          {!results ? (
            <p className="text-muted">We could not load results. Please try again.</p>
          ) : results.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
              <p className="font-medium">No stays match these filters.</p>
              <p className="mt-1 text-sm text-muted">Try different dates, fewer filters or a nearby city.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {results.items.map((l, i) => (
                  <ListingCard key={l.id} l={l} priority={i === 0} query={stayQuery} />
                ))}
              </div>
              {results.nextCursor && (
                <div className="mt-6 text-center">
                  <Link href={`/search?${next.toString()}`} className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium">
                    Show more stays
                  </Link>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
