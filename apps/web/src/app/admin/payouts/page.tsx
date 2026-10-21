'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PAYOUT_STATUSES, statusLabel } from '@propcare/shared';
import { Button, ErrorAlert, Loading, Modal, PageHeader, SelectField, StatusBadge, Table, TextField } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { dateLabel, inr } from '@/lib/format';
import { useAction } from '@/lib/use-action';

interface Payout {
  id: string;
  reference: string;
  bookingId: string;
  bookingReference: string | null;
  checkOut: string | null;
  amountPaise: number;
  adjustmentPaise: number;
  status: string;
  eligibleAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  holdReason: string | null;
  requiresDualApproval: boolean;
  approvedBy: string | null;
  heldBySystem: boolean;
}

function Payouts() {
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const { data, error, isLoading, mutate } = useApi<{ items: Payout[] }>(`/admin/payouts?limit=100${status ? `&status=${status}` : ''}`);
  const [dialog, setDialog] = useState<{ kind: 'hold' | 'paid'; p: Payout } | null>(null);
  const [text, setText] = useState('');
  const { busy, error: actError, run } = useAction();
  const go = (p: Payout, action: string, body: unknown = {}) => run(`${action}-${p.id}`, async () => { await post(`/admin/payouts/${p.id}/${action}`, body, true); setDialog(null); setText(''); await mutate(); });
  return (
    <>
      <PageHeader
        title="Payouts"
        subtitle="Large payouts need a second finance approver. Marking paid records a transfer made outside the platform."
        actions={<SelectField label="Status" value={status} placeholder="All" onChange={(e) => setStatus(e.target.value)} options={PAYOUT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />}
      />
      {isLoading && <Loading />}
      <ErrorAlert error={error ?? actError} />
      {data && (
        <Table
          head={['Payout', 'Booking', 'Amount', 'Status', 'Actions']}
          empty="No payouts"
          rows={data.items.map((p) => [
            <span key="r" className="font-medium">
              {p.reference}
              {p.requiresDualApproval && <span className="block text-xs text-warn">Dual approval</span>}
            </span>,
            <Link key="b" href={`/admin/bookings/${p.bookingId}`} className="underline">
              {p.bookingReference} · out {dateLabel(p.checkOut, { year: undefined })}
            </Link>,
            <span key="a">
              {inr(p.amountPaise)}
              {p.adjustmentPaise !== 0 && <span className="block text-xs text-muted">adj. {inr(p.adjustmentPaise)}</span>}
            </span>,
            <span key="s" className="flex flex-col gap-1">
              <StatusBadge status={p.status} />
              {p.holdReason && <span className="text-xs text-muted">{p.heldBySystem ? 'System: ' : ''}{p.holdReason}</span>}
              {p.paidAt && <span className="text-xs text-muted">Paid {dateLabel(p.paidAt)} · {p.paymentReference}</span>}
            </span>,
            <span key="x" className="flex flex-wrap gap-1">
              {p.status === 'ELIGIBLE' && p.requiresDualApproval && !p.approvedBy && (
                <Button size="sm" busy={busy === `approve-${p.id}`} onClick={() => go(p, 'approve')}>
                  Approve (1 of 2)
                </Button>
              )}
              {p.status === 'ELIGIBLE' && (!p.requiresDualApproval || p.approvedBy) && (
                <Button size="sm" onClick={() => setDialog({ kind: 'paid', p })}>
                  {p.requiresDualApproval ? 'Mark paid (2 of 2)' : 'Mark paid'}
                </Button>
              )}
              {['PENDING', 'ELIGIBLE'].includes(p.status) && (
                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'hold', p })}>
                  Hold
                </Button>
              )}
              {p.status === 'ON_HOLD' && (
                <Button size="sm" variant="secondary" busy={busy === `release-${p.id}`} onClick={() => go(p, 'release')}>
                  Release
                </Button>
              )}
            </span>,
          ])}
        />
      )}
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.kind === 'hold' ? 'Hold payout' : 'Mark payout paid'}
        footer={
          <Button disabled={!text.trim()} busy={!!busy} onClick={() => dialog && go(dialog.p, dialog.kind === 'hold' ? 'hold' : 'mark-paid', dialog.kind === 'hold' ? { reason: text } : { paymentReference: text })}>
            Confirm
          </Button>
        }
      >
        <TextField label={dialog?.kind === 'hold' ? 'Reason' : 'Bank transfer reference'} required maxLength={dialog?.kind === 'hold' ? 500 : 100} value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
    </>
  );
}

export default function PayoutsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Payouts />
    </Suspense>
  );
}
