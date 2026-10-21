import Link from 'next/link';
import { statusLabel } from '@propcare/shared';
import { inr } from '@/lib/format';
import type { ListingCardData } from '@/lib/server-api';

/** Search result card. Only the first visible card is an LCP candidate; the rest load lazily. */
export function ListingCard({ l, priority = false, query = '' }: { l: ListingCardData; priority?: boolean; query?: string }) {
  return (
    <Link href={`/stays/${l.id}${query}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-brand hover:shadow-md">
      <div className="relative aspect-[3/2] bg-surface-2">
        {l.coverPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- variants are pre-sized WebP served by the API
          <img
            src={l.coverPhoto.sm.url}
            srcSet={`${l.coverPhoto.sm.url} ${l.coverPhoto.sm.width}w, ${l.coverPhoto.lg.url} ${l.coverPhoto.lg.width}w`}
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            alt={l.title}
            width={l.coverPhoto.sm.width}
            height={l.coverPhoto.sm.height}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
            {...(priority ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted">Photos coming soon</div>
        )}
        {l.bookingMode === 'INSTANT' && <span className="absolute left-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-xs font-medium">⚡ Instant book</span>}
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm text-muted">{l.publicAreaLabel}</p>
          {l.ratingAvg ? (
            <p className="shrink-0 text-sm">
              ★ {l.ratingAvg.toFixed(1)} <span className="text-muted">({l.ratingCount})</span>
            </p>
          ) : (
            <p className="shrink-0 text-xs text-muted">New</p>
          )}
        </div>
        <h3 className="line-clamp-2 font-medium leading-snug">{l.title}</h3>
        <p className="text-sm text-muted">
          {statusLabel(l.propertyType)} · {l.maxGuests} guests · {l.bedrooms} bedroom{l.bedrooms === 1 ? '' : 's'}
        </p>
        <p className="pt-1 text-sm">
          {l.stayTotalPaise ? (
            <>
              <span className="font-semibold">{inr(l.stayTotalPaise)}</span> <span className="text-muted">total</span>
            </>
          ) : (
            <>
              From <span className="font-semibold">{inr(l.priceFromPaise)}</span> <span className="text-muted">/ night</span>
            </>
          )}
        </p>
      </div>
    </Link>
  );
}
