'use client';
import Link from 'next/link';
import { useState } from 'react';
import { rupeesToPaise } from '@propcare/shared';
import { Button, ErrorAlert, Form, Loading, Modal, PageHeader, StatusBadge, Table, TextField } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { dateTimeLabel, inr } from '@/lib/format';
import { useAction } from '@/lib/use-action';

interface Payment {
  id: string;
  status: string;
  amountPaise: number;
  refundedPaise: number;
  provider: string;
  paidAt: string | null;
  bookingId: string | null;
  requirementId: string | null;
  createdAt: string;
  refunds: Array<{ id: string; status: string; amountPaise: number; reason: string; attempts: number }>;
}

export default function Payments() {
  const { data, error, isLoading, mutate } = useApi<{ items: Payment[] }>('/admin/payments?limit=100');
  const [refund, setRefund] = useState<Payment | null>(null);
  const [offline, setOffline] = useState(false);
  const [f, setF] = useState({ amount: '', reason: '', bookingId: '', requirementId: '', reference: '' });
  const { busy, error: actError, run } = useAction();
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Payment state changes only through signed provider webhooks or audited finance actions."
        actions={
          <Button variant="secondary" onClick={() => setOffline(true)}>
            Record offline payment
          </Button>
        }
      />
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && (
        <Table
          head={['Created', 'For', 'Amount', 'Refunded', 'Status', '']}
          empty="No payments"
          rows={data.items.map((p) => [
            dateTimeLabel(p.createdAt),
            p.bookingId ? (
              <Link key="b" href={`/admin/bookings/${p.bookingId}`} className="underline">
                Booking
              </Link>
            ) : (
              'Maintenance'
            ),
            `${inr(p.amountPaise)} · ${p.provider}`,
            <span key="r">
              {inr(p.refundedPaise)}
              {p.refunds.map((r) => (
                <span key={r.id} className="block text-xs text-muted">
                  {inr(r.amountPaise)} {r.status.toLowerCase()} {r.attempts > 1 ? `(${r.attempts} attempts)` : ''}
                </span>
              ))}
            </span>,
            <StatusBadge key="s" status={p.status} />,
            p.status === 'SUCCEEDED' && p.refundedPaise < p.amountPaise ? (
              <Button key="x" size="sm" variant="ghost" onClick={() => setRefund(p)}>
                Refund
              </Button>
            ) : null,
          ])}
        />
      )}
      <Modal open={!!refund} onClose={() => setRefund(null)} title="Manual refund">
        <Form className="space-y-3" onSubmit={() => refund && run('refund', async () => { await post(`/payments/${refund.id}/refund`, { amountPaise: rupeesToPaise(f.amount) ?? 0, reason: f.reason }, true); setRefund(null); await mutate(); })}>
          <TextField label="Amount (₹)" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} hint={refund ? `Up to ${inr(refund.amountPaise - refund.refundedPaise)}` : undefined} />
          <TextField label="Reason (audited)" required maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <ErrorAlert error={actError} />
          <Button type="submit" variant="danger" busy={busy === 'refund'}>
            Refund
          </Button>
        </Form>
      </Modal>
      <Modal open={offline} onClose={() => setOffline(false)} title="Record offline payment">
        <Form
          className="space-y-3"
          onSubmit={() =>
            run('offline', async () => {
              await post('/payments/offline', { amountPaise: rupeesToPaise(f.amount) ?? 0, reference: f.reference, reason: f.reason, ...(f.bookingId ? { bookingId: f.bookingId } : { requirementId: f.requirementId }) }, true);
              setOffline(false);
              await mutate();
            })
          }
        >
          <TextField label="Booking ID" value={f.bookingId} onChange={(e) => setF({ ...f, bookingId: e.target.value, requirementId: '' })} hint="Or a payment requirement ID below — exactly one." />
          <TextField label="Payment requirement ID" value={f.requirementId} onChange={(e) => setF({ ...f, requirementId: e.target.value, bookingId: '' })} />
          <TextField label="Amount (₹)" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <TextField label="Reference (UTR or receipt)" required maxLength={100} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          <TextField label="Reason (audited)" required maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <ErrorAlert error={actError} />
          <Button type="submit" busy={busy === 'offline'}>
            Record
          </Button>
        </Form>
      </Modal>
    </>
  );
}
