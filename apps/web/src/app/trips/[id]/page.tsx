'use client';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ReportIssueButton } from '@/components/issue-form';
import { MessageThread } from '@/components/shared';
import { Alert, Button, Card, ErrorAlert, Form, KeyValue, LinkButton, Loading, Modal, PageHeader, StatusBadge, TextArea } from '@/components/ui';
import { api, post, useApi } from '@/lib/api';
import { dateLabel, dateTimeLabel, inr, pct } from '@/lib/format';
import { RoleGate } from '@/lib/session';
import { useAction } from '@/lib/use-action';

interface CustomerBooking {
  id: string;
  reference: string;
  status: string;
  listing: { id: string; title: string; publicAreaLabel: string; coverPhoto: { lg: { url: string } } | null; checkInTime: string; checkOutTime: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  specialRequests: string | null;
  bookingMode: string;
  cancellationPolicy: { name?: string; rules?: Array<{ hoursBeforeCheckInAtLeast: number; refundBps: number }> } | null;
  holdExpiresAt: string | null;
  requestExpiresAt: string | null;
  cancelledAt: string | null;
  refundPaise: number;
  nightsBreakdown: Array<{ date: string; pricePaise: number }>;
  nightsTotalPaise: number;
  cleaningFeePaise: number;
  taxPaise: number;
  totalPaise: number;
  exactAddress: { line1: string; line2: string | null; locality: string; city: string; state: string; pinCode: string } | null;
  checkinInstructions: string | null;
  checkinInstructionsAvailableAt: string | null;
  canPay: boolean;
  canCancel: boolean;
  canReview: boolean;
  review: { rating: number; body: string; status: string } | null;
}

interface Preview {
  status: string;
  charged: boolean;
  refundPaise: number;
  refundBps: number;
  hoursBeforeCheckIn?: number;
  totalPaise?: number;
}

function CancelDialog({ booking, onDone }: { booking: CustomerBooking; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <>
      <Button
        variant="secondary"
        busy={busy === 'preview'}
        onClick={() =>
          run('preview', async () => {
            setPreview(await api<Preview>(`/bookings/${booking.id}/cancellation-preview`));
            setOpen(true);
          })
        }
      >
        Cancel booking
      </Button>
      <ErrorAlert error={!open ? error : null} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel this booking?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep booking
            </Button>
            <Button
              variant="danger"
              busy={busy === 'cancel'}
              onClick={() =>
                run('cancel', async () => {
                  await post(`/bookings/${booking.id}/cancel`, { reason: reason || null }, true);
                  setOpen(false);
                  onDone();
                })
              }
            >
              Confirm cancellation
            </Button>
          </>
        }
      >
        {preview && (
          <div className="space-y-3 text-sm">
            {preview.charged ? (
              <Alert tone={preview.refundPaise > 0 ? 'info' : 'warn'} title={`Refund: ${inr(preview.refundPaise)}`}>
                {pct(preview.refundBps)} of {inr(preview.totalPaise)} under the {booking.cancellationPolicy?.name ?? 'listing'} policy, cancelling {preview.hoursBeforeCheckIn} hours before check-in.
                Refunds go back to the original payment method.
              </Alert>
            ) : (
              <Alert tone="info">You have not been charged, so there is nothing to refund. The dates will be released.</Alert>
            )}
            <TextArea label="Reason (optional)" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            <ErrorAlert error={error} />
          </div>
        )}
      </Modal>
    </>
  );
}

function ReviewForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Card title="How was your stay?">
      <Form className="space-y-3" onSubmit={() => run('review', async () => { await post(`/bookings/${id}/review`, { rating, body }, true); onDone(); })}>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Rating</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-pressed={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)} className={`text-2xl ${n <= rating ? 'text-accent' : 'text-line'}`}>
                ★
              </button>
            ))}
          </div>
        </fieldset>
        <TextArea label="Your review" required minLength={10} maxLength={3000} rows={4} value={body} onChange={(e) => setBody(e.target.value)} invalidMessage="Write at least 10 characters." />
        <ErrorAlert error={error} />
        <Button type="submit" busy={busy === 'review'}>
          Post review
        </Button>
      </Form>
    </Card>
  );
}

function Trip() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const { data: b, error, isLoading, mutate } = useApi<CustomerBooking>(`/bookings/${id}`, { refreshInterval: (d) => (d?.status === 'AWAITING_PAYMENT' || sp.get('payment') ? 4000 : 0) });
  const pay = useAction();
  if (isLoading) return <Loading />;
  if (error || !b) return <div className="mx-auto max-w-4xl px-4 py-8"><ErrorAlert error={error ?? new Error('Booking not found.')} /></div>;
  const payment = sp.get('payment');
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title={b.listing.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {b.reference} · {b.listing.publicAreaLabel} <StatusBadge status={b.status} />
          </span>
        }
        back={{ href: '/trips', label: 'My trips' }}
      />
      <div className="space-y-3">
        {sp.get('requested') && b.status === 'REQUESTED' && (
          <Alert tone="ok" title="Request sent">
            The host has until {dateTimeLabel(b.requestExpiresAt)} to respond. You will only be asked to pay if they accept.
          </Alert>
        )}
        {payment === 'succeeded' && b.status === 'AWAITING_PAYMENT' && <Alert tone="info">Payment received — confirming your booking…</Alert>}
        {payment === 'succeeded' && b.status === 'CONFIRMED' && <Alert tone="ok" title="You're booked!">We've sent the confirmation to your phone.</Alert>}
        {payment === 'failed' && b.status === 'AWAITING_PAYMENT' && <Alert tone="danger">The payment did not go through. You can try again while your dates are held.</Alert>}
        {b.status === 'AWAITING_PAYMENT' && b.holdExpiresAt && <Alert tone="warn">Dates held until {dateTimeLabel(b.holdExpiresAt)}. Pay before then to confirm.</Alert>}
        {b.status === 'CANCELLED' && (
          <Alert tone="info">
            Cancelled {dateTimeLabel(b.cancelledAt)}. {b.refundPaise > 0 ? `Refund of ${inr(b.refundPaise)} is on its way to your original payment method.` : 'No refund was due.'}
          </Alert>
        )}
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Your stay">
            <KeyValue
              items={[
                ['Check-in', `${dateLabel(b.checkIn)} from ${b.listing.checkInTime}`],
                ['Check-out', `${dateLabel(b.checkOut)} by ${b.listing.checkOutTime}`],
                ['Guests', b.guests],
                ['Nights', b.nights],
                ...(b.specialRequests ? ([['Your requests', b.specialRequests]] as Array<[string, string]>) : []),
              ]}
            />
          </Card>
          <Card title="Address and arrival">
            {b.exactAddress ? (
              <div className="space-y-3 text-sm">
                <address className="not-italic">
                  {b.exactAddress.line1}
                  {b.exactAddress.line2 && <>, {b.exactAddress.line2}</>}
                  <br />
                  {b.exactAddress.locality}, {b.exactAddress.city}, {b.exactAddress.state} {b.exactAddress.pinCode}
                </address>
                {b.checkinInstructions ? (
                  <div className="rounded-lg bg-surface-2 p-3">
                    <p className="font-medium">Check-in instructions</p>
                    <p className="mt-1 whitespace-pre-wrap">{b.checkinInstructions}</p>
                  </div>
                ) : b.checkinInstructionsAvailableAt ? (
                  <p className="text-muted">Check-in instructions appear here from {dateTimeLabel(b.checkinInstructionsAvailableAt)}.</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted">The exact address appears here once your booking is confirmed.</p>
            )}
          </Card>
          <MessageThread path={`/bookings/${b.id}/messages`} title="Messages with your host" maskingNotice={b.status !== 'CONFIRMED' && b.status !== 'COMPLETED'} />

          {b.canReview && <ReviewForm id={b.id} onDone={() => mutate()} />}
          {b.review && (
            <Card title="Your review">
              <p className="text-accent" aria-label={`${b.review.rating} of 5 stars`}>
                {'★'.repeat(b.review.rating)}
                <span className="text-line">{'★'.repeat(5 - b.review.rating)}</span>
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{b.review.body}</p>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Price details">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">
                  {b.nights} night{b.nights > 1 ? 's' : ''}
                </span>
                <span>{inr(b.nightsTotalPaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Cleaning fee</span>
                <span>{inr(b.cleaningFeePaise)}</span>
              </div>
              {b.taxPaise > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Taxes</span>
                  <span>{inr(b.taxPaise)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2 font-semibold">
                <span>Total</span>
                <span>{inr(b.totalPaise)}</span>
              </div>
            </div>
          </Card>
          <div className="flex flex-col gap-2">
            {b.canPay && (
              <Button
                size="lg"
                busy={pay.busy === 'pay'}
                onClick={() =>
                  pay.run('pay', async () => {
                    const p = await post<{ checkoutUrl: string }>(`/bookings/${b.id}/payments`, {}, true);
                    router.push(p.checkoutUrl);
                  })
                }
              >
                Pay {inr(b.totalPaise)}
              </Button>
            )}
            <ErrorAlert error={pay.error} />
            {b.canCancel && <CancelDialog booking={b} onDone={() => mutate()} />}
            {(b.status === 'CONFIRMED' || b.status === 'COMPLETED') && <ReportIssueButton path={`/bookings/${b.id}/issues`} />}
            <LinkButton href={`/stays/${b.listing.id}`} variant="ghost">
              View listing
            </LinkButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TripPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RoleGate role="CUSTOMER">{() => <Trip />}</RoleGate>
    </Suspense>
  );
}
