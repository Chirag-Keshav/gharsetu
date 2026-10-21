'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { statusLabel } from '@propcare/shared';
import { ReportIssueButton } from '@/components/issue-form';
import { MessageThread } from '@/components/shared';
import { Alert, Button, Card, ErrorAlert, KeyValue, Loading, Modal, PageHeader, StatusBadge, TextArea } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { dateLabel, dateTimeLabel, inr, pct } from '@/lib/format';
import { useAction } from '@/lib/use-action';
import type { OwnerBooking } from '../page';

type Detail = OwnerBooking & {
  specialRequests: string | null;
  nightsTotalPaise: number;
  cleaningFeePaise: number;
  taxPaise: number;
  canApprove: boolean;
  canCancel: boolean;
  cancelledAt: string | null;
  refundPaise: number;
  listing: { id: string; title: string; checkInTime: string; checkOutTime: string };
};

export default function OwnerBookingPage() {
  const { id } = useParams<{ id: string }>();
  const { data: b, error, isLoading, mutate } = useApi<Detail>(`/bookings/${id}`);
  const [dialog, setDialog] = useState<'decline' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const { busy, error: actError, run } = useAction();
  if (isLoading) return <Loading />;
  if (error || !b) return <ErrorAlert error={error ?? new Error('Booking not found.')} />;
  return (
    <>
      <PageHeader
        title={`${b.guest.firstName} · ${dateLabel(b.checkIn, { year: undefined })} → ${dateLabel(b.checkOut)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {b.reference} · {b.listing.title} <StatusBadge status={b.status} />
          </span>
        }
        back={{ href: '/owner/bookings', label: 'Bookings' }}
        actions={
          <>
            {b.canApprove && (
              <>
                <Button busy={busy === 'approve'} onClick={() => run('approve', async () => { await post(`/bookings/${b.id}/approve`, {}, true); await mutate(); })}>
                  Accept request
                </Button>
                <Button variant="secondary" onClick={() => setDialog('decline')}>
                  Decline
                </Button>
              </>
            )}
            {b.canCancel && (
              <Button variant="ghost" onClick={() => setDialog('cancel')}>
                Cancel booking
              </Button>
            )}
          </>
        }
      />
      <ErrorAlert error={actError} />
      {b.status === 'REQUESTED' && b.requestExpiresAt && (
        <div className="mb-4">
          <Alert tone="warn">Respond by {dateTimeLabel(b.requestExpiresAt)}, or the request expires and the dates are released. The guest pays only after you accept.</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Stay">
            <KeyValue
              items={[
                ['Check-in', `${dateLabel(b.checkIn)} from ${b.listing.checkInTime}`],
                ['Check-out', `${dateLabel(b.checkOut)} by ${b.listing.checkOutTime}`],
                ['Guests', b.guests],
                ['Guest phone', b.guest.phoneRevealed ? b.guest.phone : `${b.guest.phone ?? 'Hidden'} (shown closer to check-in)`],
                ...(b.specialRequests ? ([['Special requests', b.specialRequests]] as Array<[string, string]>) : []),
              ]}
            />
          </Card>
          <MessageThread path={`/bookings/${b.id}/messages`} title="Messages with the guest" maskingNotice={b.status !== 'CONFIRMED' && b.status !== 'COMPLETED'} />
        </div>
        <div className="space-y-4">
          <Card title="Your earnings">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Room revenue</span>
                <span>{inr(b.roomRevenuePaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Commission ({pct(b.commissionBpsApplied)})</span>
                <span>−{inr(b.commissionPaise)}</span>
              </div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold">
                <span>Your payout</span>
                <span>{inr(b.ownerPayoutPaise)}</span>
              </div>
              {b.taxPaise > 0 && <p className="pt-1 text-xs text-muted">Guest also paid {inr(b.taxPaise)} in taxes, collected and remitted by us.</p>}
            </div>
            {b.payout && (
              <p className="mt-3 flex items-center gap-2 text-sm">
                Payout <StatusBadge status={b.payout.status} />
                {b.payout.eligibleAt && b.payout.status === 'PENDING' && <span className="text-muted">eligible {dateLabel(b.payout.eligibleAt)}</span>}
              </p>
            )}
          </Card>
          {b.status === 'CANCELLED' && <Alert tone="info">Cancelled {dateTimeLabel(b.cancelledAt)}. Guest refund: {inr(b.refundPaise)}.</Alert>}
          {(b.status === 'CONFIRMED' || b.status === 'COMPLETED') && <ReportIssueButton path={`/bookings/${b.id}/issues`} label="Report a problem with this stay" />}
        </div>
      </div>
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === 'decline' ? 'Decline this request?' : 'Cancel this booking?'}
        footer={
          <Button
            variant="danger"
            busy={busy === 'confirm'}
            onClick={() =>
              run('confirm', async () => {
                await post(`/bookings/${b.id}/${dialog === 'decline' ? 'decline' : 'cancel'}`, { reason: reason || null }, true);
                setDialog(null);
                await mutate();
              })
            }
          >
            {dialog === 'decline' ? 'Decline' : 'Cancel booking'}
          </Button>
        }
      >
        <div className="space-y-3 text-sm">
          {dialog === 'cancel' && <Alert tone="warn">The guest receives a full refund when a host cancels, and frequent cancellations can affect your listing.</Alert>}
          <TextArea label="Message to the guest (optional)" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          <ErrorAlert error={actError} />
          <p className="text-xs text-muted">Status after this: {statusLabel(dialog === 'decline' ? 'DECLINED' : 'CANCELLED')}</p>
        </div>
      </Modal>
    </>
  );
}
