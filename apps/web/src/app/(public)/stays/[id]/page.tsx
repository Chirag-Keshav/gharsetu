import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { statusLabel } from '@propcare/shared';
import { BookingWidget } from '@/components/booking-widget';
import { brand } from '@/lib/brand';
import { dateLabel, inr } from '@/lib/format';
import { publicApi, type PublicVariant } from '@/lib/server-api';

export const revalidate = 60;

interface PublicListing {
  id: string;
  title: string;
  description: string;
  propertyType: string | null;
  publicAreaLabel: string;
  city: string | null;
  state: string | null;
  approxLatitude: number | null;
  approxLongitude: number | null;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  houseRules: { quietHours?: string | null; petsAllowed: boolean; smokingAllowed: boolean; eventsAllowed: boolean; additionalRules?: string | null };
  checkInTime: string;
  checkOutTime: string;
  basePricePaise: number;
  weekendPricePaise: number | null;
  cleaningFeePaise: number;
  minNights: number;
  maxNights: number;
  bookingMode: string;
  cancellationPolicy: { name: string; description: string | null; rules: Array<{ hoursBeforeCheckInAtLeast: number; refundBps: number }> } | null;
  amenities: Array<{ slug: string; name: string; group: string }>;
  photos: Array<{ id: string; caption: string | null; variants: { sm: PublicVariant; lg: PublicVariant } }>;
  ratingAvg: number | null;
  ratingCount: number;
  reviews: { items: Array<{ id: string; rating: number; body: string; authorFirstName: string; createdAt: string }> };
}

async function load(id: string) {
  return publicApi<PublicListing>(`/public/listings/${id}`, 60);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const l = await load((await params).id);
  if (!l) return { title: 'Stay not found' };
  return {
    title: l.title,
    description: `${statusLabel(l.propertyType ?? 'OTHER')} in ${l.publicAreaLabel} for up to ${l.maxGuests} guests. From ${inr(l.basePricePaise)} per night.`,
    openGraph: { title: l.title, images: l.photos[0] ? [l.photos[0].variants.lg.url] : [] },
  };
}

export default async function StayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const l = await load(id);
  if (!l) notFound();
  // Structured data with the public area only — never the exact address (SPEC §8.4 SEO).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VacationRental',
    name: l.title,
    description: l.description.slice(0, 300),
    image: l.photos.map((p) => p.variants.lg.url),
    address: { '@type': 'PostalAddress', addressLocality: l.city, addressRegion: l.state, addressCountry: 'IN' },
    ...(l.ratingAvg ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: l.ratingAvg, reviewCount: l.ratingCount } } : {}),
    brand: brand.productName,
  };
  const [hero, ...rest] = l.photos;
  const rules = l.houseRules;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{l.title}</h1>
      <p className="mt-1 text-sm text-muted">
        {l.ratingAvg ? `★ ${l.ratingAvg.toFixed(1)} (${l.ratingCount} review${l.ratingCount === 1 ? '' : 's'}) · ` : 'New listing · '}
        {l.publicAreaLabel}
      </p>

      <div className="mt-4 grid gap-2 overflow-hidden rounded-2xl sm:grid-cols-4 sm:grid-rows-2">
        {hero && (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized public variants
          <img
            src={hero.variants.lg.url}
            alt={hero.caption ?? l.title}
            width={hero.variants.lg.width}
            height={hero.variants.lg.height}
            fetchPriority="high"
            className="h-full max-h-[480px] w-full object-cover sm:col-span-2 sm:row-span-2"
          />
        )}
        {rest.slice(0, 4).map((p) => (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized public variants
          <img key={p.id} src={p.variants.sm.url} alt={p.caption ?? ''} width={p.variants.sm.width} height={p.variants.sm.height} loading="lazy" className="hidden h-full w-full object-cover sm:block" />
        ))}
      </div>
      {rest.length > 4 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-brand">Show all {l.photos.length} photos</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {rest.slice(4).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- pre-sized public variants
              <img key={p.id} src={p.variants.lg.url} alt={p.caption ?? ''} width={p.variants.lg.width} height={p.variants.lg.height} loading="lazy" className="w-full rounded-xl object-cover" />
            ))}
          </div>
        </details>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold">
              {statusLabel(l.propertyType ?? 'OTHER')} · {l.maxGuests} guests · {l.bedrooms} bedrooms · {l.beds} beds · {l.bathrooms} bathrooms
            </h2>
            <div className="prose-text mt-3 text-sm leading-relaxed">
              {l.description.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-lg font-semibold">What this place offers</h2>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {l.amenities.map((a) => (
                <li key={a.slug} className="flex items-center gap-2">
                  <span aria-hidden className="text-brand">✓</span> {a.name}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-3 text-lg font-semibold">House rules</h2>
            <ul className="space-y-1 text-sm">
              <li>Check-in from {l.checkInTime} · Check-out by {l.checkOutTime}</li>
              {rules.quietHours && <li>Quiet hours {rules.quietHours}</li>}
              <li>{rules.petsAllowed ? 'Pets allowed' : 'No pets'}</li>
              <li>{rules.smokingAllowed ? 'Smoking allowed' : 'No smoking'}</li>
              <li>{rules.eventsAllowed ? 'Events allowed' : 'No parties or events'}</li>
              <li>
                Stays of {l.minNights}–{l.maxNights} nights
              </li>
              {rules.additionalRules && <li className="text-muted">{rules.additionalRules}</li>}
            </ul>
          </section>
          {l.cancellationPolicy && (
            <section>
              <h2 className="mb-2 text-lg font-semibold">Cancellation policy: {l.cancellationPolicy.name}</h2>
              <ul className="space-y-1 text-sm">
                {[...l.cancellationPolicy.rules]
                  .sort((a, b) => b.hoursBeforeCheckInAtLeast - a.hoursBeforeCheckInAtLeast)
                  .map((r) => (
                    <li key={r.hoursBeforeCheckInAtLeast}>
                      Cancel at least {r.hoursBeforeCheckInAtLeast >= 48 ? `${r.hoursBeforeCheckInAtLeast / 24} days` : `${r.hoursBeforeCheckInAtLeast} hours`} before check-in: {r.refundBps / 100}% refund
                    </li>
                  ))}
                <li className="text-muted">Otherwise no refund. (Placeholder policy wording.)</li>
              </ul>
            </section>
          )}
          <section>
            <h2 className="mb-2 text-lg font-semibold">Location</h2>
            <p className="text-sm">{l.publicAreaLabel}</p>
            {l.approxLatitude !== null && (
              <p className="text-sm text-muted">
                Approximate area around {l.approxLatitude.toFixed(2)}, {l.approxLongitude?.toFixed(2)}.
              </p>
            )}
            <p className="mt-1 text-sm text-muted">The exact address is shared on your booking page once the booking is confirmed.</p>
          </section>
          <section>
            <h2 className="mb-3 text-lg font-semibold">Reviews</h2>
            {l.reviews.items.length === 0 ? (
              <p className="text-sm text-muted">No reviews yet.</p>
            ) : (
              <ul className="space-y-4">
                {l.reviews.items.map((r) => (
                  <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
                    <p className="text-sm font-medium">
                      {'★'.repeat(r.rating)}
                      <span className="sr-only">{r.rating} out of 5</span> · {r.authorFirstName} · <span className="text-muted">{dateLabel(r.createdAt, { weekday: undefined, day: undefined })}</span>
                    </p>
                    <p className="mt-1 text-sm">{r.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <BookingWidget listingId={l.id} basePricePaise={l.basePricePaise} bookingMode={l.bookingMode} maxGuests={l.maxGuests} initial={{ checkIn: sp.checkIn, checkOut: sp.checkOut, guests: sp.guests }} />
        </aside>
      </div>
    </div>
  );
}
