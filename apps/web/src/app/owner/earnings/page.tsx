'use client';
import Link from 'next/link';
import { ErrorAlert, Loading, PageHeader, Stat, StatusBadge, Table } from '@/components/ui';
import { useApi } from '@/lib/api';
import { dateLabel, inr, pct } from '@/lib/format';

interface Payout {
  id: string;
  reference: string;
  bookingId: string;
  bookingReference: string | null;
  checkIn: string | null;
  checkOut: string | null;
  amountPaise: number;
  adjustmentPaise: number;
  status: string;
  eligibleAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  holdReason: string | null;
}

export default function Earnings() {
  const payouts = useApi<{ items: Payout[] }>('/owner/payouts?limit=100');
  const commission = useApi<{ effectiveBps: number; hasOverride: boolean; benchmarkBps: number | null }>('/owner/commission');
  const items = payouts.data?.items ?? [];
  const sum = (f: (p: Payout) => boolean) => items.filter(f).reduce((s, p) => s + p.amountPaise, 0);
  return (
    <>
      <PageHeader title="Earnings" subtitle="Payouts are released after each stay completes, once any issue window has passed." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Paid out" value={inr(sum((p) => p.status === 'PAID'))} tone="ok" />
        <Stat label="Upcoming" value={inr(sum((p) => ['PENDING', 'ELIGIBLE'].includes(p.status)))} />
        <Stat label="Under review" value={inr(sum((p) => p.status === 'ON_HOLD'))} tone={sum((p) => p.status === 'ON_HOLD') ? 'warn' : undefined} />
        <Stat label="Your commission rate" value={commission.data ? pct(commission.data.effectiveBps) : '—'} hint={commission.data ? (commission.data.hasOverride ? 'Your agreed rate' : commission.data.benchmarkBps ? `Typical platforms charge about ${pct(commission.data.benchmarkBps)}` : undefined) : undefined} />
      </div>
      {payouts.isLoading && <Loading />}
      <ErrorAlert error={payouts.error} />
      <Table
        head={['Payout', 'Stay', 'Amount', 'Status', 'Paid']}
        empty="No payouts yet"
        rows={items.map((p) => [
          p.reference,
          <Link key="b" href={`/owner/bookings/${p.bookingId}`} className="underline">
            {p.bookingReference} · {dateLabel(p.checkIn, { year: undefined })} → {dateLabel(p.checkOut, { year: undefined })}
          </Link>,
          <span key="a">
            {inr(p.amountPaise)}
            {p.adjustmentPaise !== 0 && <span className="block text-xs text-muted">incl. adjustment {inr(p.adjustmentPaise)}</span>}
          </span>,
          <span key="s">
            <StatusBadge status={p.status} />
            {p.holdReason && <span className="block text-xs text-muted">{p.holdReason}</span>}
            {p.status === 'PENDING' && p.eligibleAt && <span className="block text-xs text-muted">from {dateLabel(p.eligibleAt)}</span>}
          </span>,
          p.paidAt ? `${dateLabel(p.paidAt)}${p.paymentReference ? ` · ${p.paymentReference}` : ''}` : '—',
        ])}
      />
    </>
  );
}
