'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorAlert, Loading, PageHeader, StatusBadge, Table, Tabs } from '@/components/ui';
import { useApi } from '@/lib/api';
import { dateLabel, dateTimeLabel, inr } from '@/lib/format';

export interface OwnerBooking {
  id: string;
  reference: string;
  status: string;
  listing: { id: string; title: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  totalPaise: number;
  roomRevenuePaise: number;
  commissionBpsApplied: number;
  commissionPaise: number;
  ownerPayoutPaise: number;
  requestExpiresAt: string | null;
  guest: { firstName: string; phone: string | null; phoneRevealed: boolean };
  payout: { id: string; status: string; amountPaise: number; eligibleAt: string | null } | null;
}

export default function OwnerBookings() {
  const [scope, setScope] = useState<'requests' | 'upcoming' | 'past' | 'all'>('upcoming');
  const { data, error, isLoading } = useApi<{ items: OwnerBooking[] }>(`/bookings?scope=${scope}&limit=100`);
  return (
    <>
      <PageHeader title="Bookings" />
      <Tabs
        value={scope}
        onChange={setScope}
        tabs={[
          { id: 'requests', label: 'Requests' },
          { id: 'upcoming', label: 'Upcoming' },
          { id: 'past', label: 'Past' },
          { id: 'all', label: 'All' },
        ]}
      />
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && (
        <Table
          head={['Booking', 'Guest', 'Dates', 'Status', 'Your payout']}
          empty="No bookings here"
          rows={data.items.map((b) => [
            <Link key="r" href={`/owner/bookings/${b.id}`} className="font-medium underline">
              {b.reference}
              <span className="block text-xs font-normal text-muted">{b.listing.title}</span>
            </Link>,
            `${b.guest.firstName} · ${b.guests} guest${b.guests > 1 ? 's' : ''}`,
            `${dateLabel(b.checkIn, { year: undefined })} → ${dateLabel(b.checkOut, { year: undefined })}`,
            <div key="s">
              <StatusBadge status={b.status} />
              {b.status === 'REQUESTED' && b.requestExpiresAt && <span className="block text-xs text-warn">Respond by {dateTimeLabel(b.requestExpiresAt)}</span>}
            </div>,
            inr(b.ownerPayoutPaise),
          ])}
        />
      )}
    </>
  );
}
