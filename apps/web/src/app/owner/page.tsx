'use client';
import Link from 'next/link';
import { modeIncludesCare, modeIncludesList, statusLabel, type ServiceMode } from '@propcare/shared';
import { Card, Empty, ErrorAlert, LinkButton, Loading, PageHeader, Stat, StatusBadge } from '@/components/ui';
import { useApi } from '@/lib/api';
import { ago, dateLabel, inr } from '@/lib/format';
import { useMe } from '@/lib/session';
import type { OwnerBooking } from './bookings/page';

export interface PropertySummary {
  id: string;
  nickname: string;
  propertyType: string;
  locality: string;
  city: string;
  serviceMode: ServiceMode;
  status: string;
  verificationStatus: string;
  listing: { id: string; status: string; reference: string } | null;
  openRequests: number;
}

interface RequestSummary {
  id: string;
  reference: string;
  title: string;
  status: string;
  urgency: string;
  property: { nickname: string } | null;
  category: string | null;
  submittedAt: string;
}

export default function OwnerDashboard() {
  const { me } = useMe();
  const props = useApi<{ items: PropertySummary[] }>('/properties');
  const requests = useApi<{ items: RequestSummary[] }>('/service-requests?limit=5');
  const bookings = useApi<{ items: OwnerBooking[] }>('/bookings?scope=upcoming&limit=5');
  const payouts = useApi<{ items: Array<{ amountPaise: number; status: string }> }>('/owner/payouts?limit=100');
  const pendingPayout = payouts.data?.items.filter((p) => ['PENDING', 'ELIGIBLE', 'ON_HOLD'].includes(p.status)).reduce((s, p) => s + p.amountPaise, 0) ?? 0;
  const anyCare = props.data?.items.some((p) => modeIncludesCare(p.serviceMode));
  const anyList = props.data?.items.some((p) => modeIncludesList(p.serviceMode));
  const requestsWaiting = bookings.data?.items.filter((b) => b.status === 'REQUESTED') ?? [];

  return (
    <>
      <PageHeader
        title={`Welcome${me?.user.fullName ? `, ${me.user.fullName.split(' ')[0]}` : ''}`}
        actions={
          <>
            {anyCare && <LinkButton href="/owner/requests/new">New service request</LinkButton>}
            <LinkButton href="/owner/properties/new" variant="secondary">
              Add property
            </LinkButton>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Properties" value={props.data?.items.length ?? '—'} />
        <Stat label="Open requests" value={props.data?.items.reduce((s, p) => s + p.openRequests, 0) ?? '—'} />
        <Stat label="Booking requests" value={requestsWaiting.length} tone={requestsWaiting.length ? 'warn' : undefined} href="/owner/bookings" hint={requestsWaiting.length ? 'Respond before they expire' : undefined} />
        <Stat label="Upcoming payouts" value={inr(pendingPayout)} href="/owner/earnings" />
      </div>
      {props.isLoading && <Loading />}
      <ErrorAlert error={props.error} />
      {props.data?.items.length === 0 && (
        <Empty title="Add your first property" action={<LinkButton href="/owner/properties/new">Add property</LinkButton>}>
          Tell us about the home you want cared for or listed.
        </Empty>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {!!props.data?.items.length && (
            <Card title="Your properties" padded={false}>
              <ul className="divide-y divide-line">
                {props.data.items.map((p) => (
                  <li key={p.id}>
                    <Link href={`/owner/properties/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
                      <div className="min-w-0">
                        <p className="font-medium">{p.nickname}</p>
                        <p className="text-sm text-muted">
                          {p.locality}, {p.city} · {statusLabel(p.serviceMode)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {p.verificationStatus !== 'APPROVED' && <StatusBadge status={p.verificationStatus} label={`Verification: ${statusLabel(p.verificationStatus).toLowerCase()}`} />}
                        {p.listing && <StatusBadge status={p.listing.status} label={`Listing: ${statusLabel(p.listing.status).toLowerCase()}`} />}
                        {p.openRequests > 0 && <StatusBadge status="IN_PROGRESS" label={`${p.openRequests} open request${p.openRequests > 1 ? 's' : ''}`} />}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {anyCare && (
            <Card title="Recent service requests" actions={<LinkButton href="/owner/requests/new" size="sm" variant="secondary">New request</LinkButton>} padded={false}>
              {requests.data?.items.length === 0 && <p className="p-4 text-sm text-muted">No requests yet.</p>}
              <ul className="divide-y divide-line">
                {requests.data?.items.map((r) => (
                  <li key={r.id}>
                    <Link href={`/owner/requests/${r.id}`} className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.title}</p>
                        <p className="text-sm text-muted">
                          {r.reference} · {r.property?.nickname} · {ago(r.submittedAt)}
                        </p>
                      </div>
                      <StatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        {anyList && (
          <Card title="Upcoming stays" actions={<Link href="/owner/bookings" className="text-sm underline">All bookings</Link>} padded={false}>
            {bookings.data?.items.length === 0 && <p className="p-4 text-sm text-muted">No upcoming bookings.</p>}
            <ul className="divide-y divide-line">
              {bookings.data?.items.map((b) => (
                <li key={b.id}>
                  <Link href={`/owner/bookings/${b.id}`} className="block px-4 py-3 hover:bg-surface-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{b.guest.firstName}</p>
                      <StatusBadge status={b.status} />
                    </div>
                    <p className="text-sm text-muted">
                      {dateLabel(b.checkIn, { year: undefined })} → {dateLabel(b.checkOut, { year: undefined })} · {b.listing.title}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
