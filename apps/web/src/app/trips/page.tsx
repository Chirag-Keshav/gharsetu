'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Empty, ErrorAlert, LinkButton, Loading, PageHeader, StatusBadge, Tabs } from '@/components/ui';
import { useApi } from '@/lib/api';
import { dateLabel, inr } from '@/lib/format';
import { RoleGate } from '@/lib/session';

export interface BookingSummary {
  id: string;
  reference: string;
  status: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  totalPaise: number;
  listing: { id: string; title: string; publicAreaLabel: string; coverPhoto: { sm: { url: string } } | null };
}

function Trips() {
  const [scope, setScope] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const { data, error, isLoading } = useApi<{ items: BookingSummary[] }>(`/bookings?scope=${scope}&limit=50`);
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader title="My trips" actions={<LinkButton href="/search">Find a stay</LinkButton>} />
      <Tabs
        tabs={[
          { id: 'upcoming', label: 'Upcoming and requested' },
          { id: 'past', label: 'Past and cancelled' },
          { id: 'all', label: 'All' },
        ]}
        value={scope}
        onChange={setScope}
      />
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && data.items.length === 0 && <Empty title="No trips here yet" action={<LinkButton href="/search">Explore stays</LinkButton>} />}
      <ul className="grid gap-4 sm:grid-cols-2">
        {data?.items.map((b) => (
          <li key={b.id}>
            <Link href={`/trips/${b.id}`} className="flex gap-3 rounded-xl border border-line bg-surface p-3 transition hover:border-brand">
              {b.listing.coverPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element -- public variant
                <img src={b.listing.coverPhoto.sm.url} alt="" width={120} height={80} loading="lazy" className="h-20 w-28 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="h-20 w-28 shrink-0 rounded-lg bg-surface-2" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium">{b.listing.title}</p>
                  <StatusBadge status={b.status} />
                </div>
                <p className="text-sm text-muted">{b.listing.publicAreaLabel}</p>
                <p className="mt-1 text-sm">
                  {dateLabel(b.checkIn, { year: undefined })} → {dateLabel(b.checkOut)} · {inr(b.totalPaise)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TripsPage() {
  return <RoleGate role="CUSTOMER">{() => <Trips />}</RoleGate>;
}
