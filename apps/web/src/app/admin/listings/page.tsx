'use client';
import Link from 'next/link';
import { useState } from 'react';
import { LISTING_STATUSES, statusLabel } from '@propcare/shared';
import { ErrorAlert, Loading, PageHeader, SelectField, StatusBadge, Table } from '@/components/ui';
import { useApi } from '@/lib/api';
import { inr } from '@/lib/format';

interface Row {
  id: string;
  reference: string;
  title: string;
  status: string;
  city: string;
  state: string;
  basePricePaise: number;
  editedSinceReview: boolean;
  waitingHours: number | null;
  propertyVerification: string;
  ownerVerification: string;
}

export default function AdminListings() {
  const [filter, setFilter] = useState('SUBMITTED');
  const query = filter === 'EDITED' ? 'edited=true' : `status=${filter}`;
  const { data, error, isLoading } = useApi<{ items: Row[] }>(`/admin/listings?${query}&limit=100`);
  return (
    <>
      <PageHeader
        title="Listing review"
        actions={
          <SelectField
            label="Show"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={[{ value: 'EDITED', label: 'Published, edited since review' }, ...LISTING_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))]}
          />
        }
      />
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && (
        <Table
          head={['Listing', 'Location', 'Price', 'Verification', 'Waiting', 'Status']}
          empty="Nothing in this queue"
          rows={data.items.map((l) => [
            <Link key="l" href={`/admin/listings/${l.id}`} className="font-medium underline">
              {l.reference}
              <span className="block max-w-[260px] truncate text-xs font-normal text-muted">{l.title || 'Untitled'}</span>
            </Link>,
            `${l.city}, ${l.state}`,
            inr(l.basePricePaise),
            <span key="v" className="flex flex-col gap-1">
              <StatusBadge status={l.ownerVerification} label={`Owner: ${statusLabel(l.ownerVerification).toLowerCase()}`} />
              <StatusBadge status={l.propertyVerification} label={`Property: ${statusLabel(l.propertyVerification).toLowerCase()}`} />
            </span>,
            l.waitingHours === null ? '—' : `${l.waitingHours}h`,
            <span key="s" className="flex flex-col gap-1">
              <StatusBadge status={l.status} />
              {l.editedSinceReview && <StatusBadge status="PENDING" label="Edited" />}
            </span>,
          ])}
        />
      )}
    </>
  );
}
