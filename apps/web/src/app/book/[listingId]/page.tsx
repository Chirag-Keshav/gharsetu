'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Alert, Button, Card, ErrorAlert, Form, Loading, PageHeader, TextArea } from '@/components/ui';
import { newIdempotencyKey, post, useApi } from '@/lib/api';
import { dateLabel, inr } from '@/lib/format';
import { RoleGate } from '@/lib/session';

interface Quote {
  nights: Array<{ date: string; pricePaise: number; basis: string }>;
  cleaningFeePaise: number;
  taxPaise: number;
  totalPaise: number;
  bookingMode: string;
}

function Checkout() {
  const { listingId } = useParams<{ listingId: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const checkIn = sp.get('checkIn') ?? '';
  const checkOut = sp.get('checkOut') ?? '';
  const guests = Number(sp.get('guests') ?? 2);
  const listing = useApi<{ title: string; publicAreaLabel: string; cancellationPolicy: { name: string; rules: Array<{ hoursBeforeCheckInAtLeast: number; refundBps: number }> } | null; coverPhoto: { variants: { sm: { url: string } } } | null; checkInTime: string; checkOutTime: string }>(`/public/listings/${listingId}`);
  const quoteKey = checkIn && checkOut ? `quote:${listingId}:${checkIn}:${checkOut}:${guests}` : null;
  const quote = useSWR<Quote>(quoteKey, () => post<Quote>(`/public/listings/${listingId}/price-quote`, { checkIn, checkOut, guests }), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // One key per checkout attempt, reused on retries so a double click cannot double-book.
  const key = useMemo(() => newIdempotencyKey(), []);

  if (listing.isLoading || quote.isLoading) return <Loading />;
  if (listing.error || !listing.data) return <ErrorAlert error={listing.error ?? new Error('This stay is not available.')} />;
  const l = listing.data;
  const q = quote.data;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader title={q?.bookingMode === 'OWNER_APPROVAL' ? 'Request to book' : 'Confirm and pay'} back={{ href: `/stays/${listingId}?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`, label: 'Back to the stay' }} />
      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card title="Your trip">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Check-in</dt>
                <dd className="font-medium">
                  {dateLabel(checkIn)} from {l.checkInTime}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Check-out</dt>
                <dd className="font-medium">
                  {dateLabel(checkOut)} by {l.checkOutTime}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Guests</dt>
                <dd className="font-medium">{guests}</dd>
              </div>
            </dl>
          </Card>
          {l.cancellationPolicy && (
            <Card title={`Cancellation policy: ${l.cancellationPolicy.name}`}>
              <ul className="space-y-1 text-sm">
                {[...l.cancellationPolicy.rules]
                  .sort((a, b) => b.hoursBeforeCheckInAtLeast - a.hoursBeforeCheckInAtLeast)
                  .map((r) => (
                    <li key={r.hoursBeforeCheckInAtLeast}>
                      {r.refundBps / 100}% refund if you cancel at least {r.hoursBeforeCheckInAtLeast} hours before check-in
                    </li>
                  ))}
                <li className="text-muted">No refund after that. You will see the exact refund before you confirm any cancellation.</li>
              </ul>
            </Card>
          )}
          <Card title="Anything the host should know?">
            <Form
              onSubmit={async () => {
                setBusy(true);
                setError(null);
                try {
                  const b = await post<{ id: string; status: string }>('/bookings', { listingId, checkIn, checkOut, guests, specialRequests: notes || null }, key);
                  if (b.status === 'AWAITING_PAYMENT') {
                    const pay = await post<{ checkoutUrl: string }>(`/bookings/${b.id}/payments`, {}, `${key}-pay`);
                    router.push(pay.checkoutUrl);
                  } else router.push(`/trips/${b.id}?requested=1`);
                } catch (e) {
                  setError(e);
                  setBusy(false);
                }
              }}
              className="space-y-3"
            >
              <TextArea label="Special requests (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} hint="Arrival time, celebrations, accessibility needs…" />
              <ErrorAlert error={error} />
              {q ? (
                <Button type="submit" size="lg" busy={busy} className="w-full sm:w-auto">
                  {q.bookingMode === 'OWNER_APPROVAL' ? 'Send request' : `Confirm and pay ${inr(q.totalPaise)}`}
                </Button>
              ) : (
                <Alert tone="warn">These dates are not available. Go back and choose others.</Alert>
              )}
              {q?.bookingMode === 'INSTANT' && <p className="text-xs text-muted">We hold the dates for a few minutes while you pay.</p>}
            </Form>
          </Card>
        </div>
        <Card title={l.title}>
          {l.coverPhoto && (
            // eslint-disable-next-line @next/next/no-img-element -- public variant
            <img src={l.coverPhoto.variants.sm.url} alt="" width={480} height={320} className="mb-3 aspect-[3/2] w-full rounded-lg object-cover" />
          )}
          <p className="text-sm text-muted">{l.publicAreaLabel}</p>
          {q && (
            <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              {q.nights.map((n) => (
                <div key={n.date} className="flex justify-between">
                  <span className="text-muted">{dateLabel(n.date, { year: undefined })}</span>
                  <span>{inr(n.pricePaise)}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-muted">Cleaning fee</span>
                <span>{inr(q.cleaningFeePaise)}</span>
              </div>
              {q.taxPaise > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Taxes</span>
                  <span>{inr(q.taxPaise)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
                <span>Total (INR)</span>
                <span>{inr(q.totalPaise)}</span>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            The exact address appears on your booking page after confirmation. <Link href="/legal/terms" className="underline">Terms</Link>
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RoleGate role="CUSTOMER">{() => <Checkout />}</RoleGate>
    </Suspense>
  );
}
