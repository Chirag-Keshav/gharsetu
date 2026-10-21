'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AiPanel, MessageThread } from '@/components/shared';
import { Alert, Button, Card, ErrorAlert, KeyValue, Loading, Modal, PageHeader, StatusBadge, TextArea, TextField } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { dateLabel, dateTimeLabel, inr, pct } from '@/lib/format';
import { hasFlag, useMe } from '@/lib/session';
import { useAction } from '@/lib/use-action';

interface AdminBooking {
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
  taxPaise: number;
  commissionBpsApplied: number;
  commissionBenchmarkSnapshot: { benchmarkBps?: number | null; source?: string } | null;
  commissionPaise: number;
  ownerPayoutPaise: number;
  refundPaise: number;
  cancelReason: string | null;
  cancelledByRole: string | null;
  requestExpiresAt: string | null;
  holdExpiresAt: string | null;
  payout: { id: string; reference: string; status: string; amountPaise: number } | null;
  customer: { id: string; name: string | null; phone: string | null };
  owner: { id: string; name: string | null };
  propertyId: string;
}

export default function AdminBooking() {
  const { id } = useParams<{ id: string }>();
  const { me } = useMe();
  const { data: b, error, isLoading, mutate } = useApi<AdminBooking>(`/admin/bookings/${id}`);
  const [dialog, setDialog] = useState<'cancel' | 'approve' | null>(null);
  const [reason, setReason] = useState('');
  const [refundPct, setRefundPct] = useState('100');
  const { busy, error: actError, run } = useAction();
  if (isLoading) return <Loading />;
  if (error || !b) return <ErrorAlert error={error} />;
  const finance = hasFlag(me, 'FINANCE');
  return (
    <>
      <PageHeader
        title={`${b.reference} · ${b.listing.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {dateLabel(b.checkIn)} → {dateLabel(b.checkOut)} · {b.guests} guests <StatusBadge status={b.status} />
          </span>
        }
        back={{ href: '/admin/bookings', label: 'Bookings' }}
        actions={
          <>
            {b.status === 'REQUESTED' && (
              <Button variant="secondary" onClick={() => setDialog('approve')}>
                Approve for host
              </Button>
            )}
            {['REQUESTED', 'AWAITING_PAYMENT', 'CONFIRMED'].includes(b.status) && (
              <Button variant="danger" onClick={() => setDialog('cancel')}>
                Cancel booking
              </Button>
            )}
          </>
        }
      />
      <ErrorAlert error={actError} />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card title="Money">
            <KeyValue
              columns={3}
              items={[
                ['Guest paid', inr(b.totalPaise)],
                ['Room revenue', inr(b.roomRevenuePaise)],
                ['Tax', inr(b.taxPaise)],
                ['Commission', `${inr(b.commissionPaise)} (${pct(b.commissionBpsApplied)})`],
                ['Benchmark', b.commissionBenchmarkSnapshot?.benchmarkBps ? pct(b.commissionBenchmarkSnapshot.benchmarkBps) : '—'],
                ['Owner payout', inr(b.ownerPayoutPaise)],
                ['Refunded', inr(b.refundPaise)],
                ['Payout', b.payout ? <span key="p" className="flex items-center gap-2">{b.payout.reference} <StatusBadge status={b.payout.status} /></span> : '—'],
              ]}
            />
            {b.cancelReason && <p className="mt-3 text-sm">Cancelled by {b.cancelledByRole?.toLowerCase()}: {b.cancelReason}</p>}
          </Card>
          <MessageThread path={`/bookings/${b.id}/messages`} title="Guest and host messages" disabled="Admins read this thread; reply through an issue if needed." />
        </div>
        <div className="space-y-4">
          <Card title="People">
            <KeyValue
              columns={1}
              items={[
                ['Guest', `${b.customer.name ?? '—'} · ${b.customer.phone ?? ''}`],
                ['Host', b.owner.name],
                ['Listing', <Link key="l" href={`/admin/listings/${b.listing.id}`} className="underline">{b.listing.title}</Link>],
                ...(b.requestExpiresAt ? ([['Request expires', dateTimeLabel(b.requestExpiresAt)]] as Array<[string, string]>) : []),
                ...(b.holdExpiresAt ? ([['Hold expires', dateTimeLabel(b.holdExpiresAt)]] as Array<[string, string]>) : []),
              ]}
            />
          </Card>
          <AiPanel<{ flagged: boolean; reason: string | null }> feature="leakage_flag" subjectType="BOOKING" subjectId={b.id} title="Off-platform check" autoload={false}>
            {(o) => (o.flagged ? <Alert tone="warn" title="Possible off-platform contact">{o.reason}</Alert> : <p>No signs of off-platform arrangements in the messages.</p>)}
          </AiPanel>
        </div>
      </div>
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === 'cancel' ? 'Cancel booking' : 'Approve on behalf of the host'}
        footer={
          <Button
            variant={dialog === 'cancel' ? 'danger' : 'primary'}
            busy={busy === 'go'}
            disabled={dialog === 'approve' && reason.trim().length < 3}
            onClick={() =>
              run('go', async () => {
                if (dialog === 'cancel') await post(`/admin/bookings/${b.id}/cancel`, { reason: reason || null, ...(finance ? { refundBps: Math.round(Number(refundPct) * 100) } : {}) }, true);
                else await post(`/admin/bookings/${b.id}/approve`, { reason });
                setDialog(null);
                await mutate();
              })
            }
          >
            Confirm
          </Button>
        }
      >
        <div className="space-y-3">
          {dialog === 'cancel' && (
            <>
              {finance ? (
                <TextField label="Refund to guest (%)" type="number" min={0} max={100} step="0.01" value={refundPct} onChange={(e) => setRefundPct(e.target.value)} hint={`Of ${inr(b.totalPaise)}. Admin cancellations default to a full refund.`} />
              ) : (
                <Alert tone="info">The guest receives a full refund. A different refund needs a finance admin.</Alert>
              )}
            </>
          )}
          <TextArea label="Reason (audited)" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required={dialog === 'approve'} />
        </div>
      </Modal>
    </>
  );
}
