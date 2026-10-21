import Link from 'next/link';
import { ListingCard } from '@/components/listing-card';
import { NaturalLanguageSearch, SearchForm } from '@/components/search-form';
import { brand } from '@/lib/brand';
import { publicApi, type ListingCardData } from '@/lib/server-api';

export const revalidate = 60;

export default async function Home() {
  const featured = await publicApi<{ items: ListingCardData[] }>('/public/listings?sort=rating&limit=6', 60);
  return (
    <div>
      <section className="border-b border-line bg-gradient-to-b from-brand-soft to-canvas">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-10 sm:pt-16">
          <p className="text-sm font-medium text-brand">Short stays · Property care · India</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">Your property, taken care of — and put to work — even when you&apos;re miles away.</h1>
          <p className="mt-4 max-w-2xl text-muted">Book verified homes for holidays and workations, or let our care team maintain and list your property.</p>
          <div className="mt-8 space-y-3">
            <SearchForm />
            <NaturalLanguageSearch />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">Guest favourites</h2>
          <Link href="/search" className="text-sm font-medium text-brand hover:underline">
            See all stays →
          </Link>
        </div>
        {featured?.items.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.items.map((l, i) => (
              <ListingCard key={l.id} l={l} priority={i === 0} />
            ))}
          </div>
        ) : (
          <p className="text-muted">New stays are being reviewed. Check back soon.</p>
        )}
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 md:grid-cols-3">
          {[
            ['🛠️', 'Maintain my property', 'Report an issue, approve an itemised quote, follow the work with before-and-after photos, and pay when you accept.'],
            ['🏡', 'List my property for stays', 'We verify your listing, take bookings and payments, and pay you out — at a lower commission than the big platforms.'],
            ['🤝', 'Both — list and maintain', 'Maintenance is scheduled around confirmed stays, with optional cleaning after each guest leaves.'],
          ].map(([icon, title, text]) => (
            <div key={title} className="rounded-2xl border border-line p-5">
              <p className="text-2xl" aria-hidden>
                {icon}
              </p>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </div>
          ))}
          <div className="md:col-span-3">
            <Link href="/auth?intent=owner" className="inline-flex rounded-lg bg-brand px-5 py-3 text-sm font-medium text-brand-ink">
              Get started as an owner with {brand.productName}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
