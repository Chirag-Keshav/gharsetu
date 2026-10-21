'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BOOKING_STATUSES, statusLabel } from '@propcare/shared';
import { ErrorAlert, Loading, PageHeader, SelectField, StatusBadge, Table } from '@/components/ui';
import { useApi } from '@/lib/api';
import { dateLabel, inr } from '@/lib/format';

interface Row {
  id: string;
  reference: string;
  status: string;
  listing: { title: string };
  checkIn: string;
  checkOut: string;
  totalPaise: number;
  commissionPaise: number;
  customer: { name: string | null };
  owner: { name: string | null };
}

function List() {
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const { data, error, isLoading } = useApi<{ items: Row[] }>(`/admin/bookings?limit=100${status ? `&status=${status}` : ''}`);
  return (
    <>
      <PageHeader title="Bookings" actions={<SelectField label="Status" value={status} placeholder="All" onChange={(e) => setStatus(e.target.value)} options={BOOKING_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />} />
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && (
        <Table
          head={['Booking', 'Guest', 'Host', 'Dates', 'Total', 'Commission', 'Status']}
          empty="No bookings"
          rows={data.items.map((b) => [
            <Link key="b" href={`/admin/bookings/${b.id}`} className="font-medium underline">
              {b.reference}
              <span className="block max-w-[200px] truncate text-xs font-normal text-muted">{b.listing.title}</span>
            </Link>,
            b.customer.name ?? '—',
            b.owner.name ?? '—',
            `${dateLabel(b.checkIn, { year: undefined })} → ${dateLabel(b.checkOut, { year: undefined })}`,
            inr(b.totalPaise),
            inr(b.commissionPaise),
            <StatusBadge key="s" status={b.status} />,
          ])}
        />
      )}
    </>
  );
}

export default function AdminBookings() {
  return (
    <Suspense fallback={<Loading />}>
      <List />
    </Suspense>
  );
}
