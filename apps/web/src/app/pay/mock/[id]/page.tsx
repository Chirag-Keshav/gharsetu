'use client';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Card, ErrorAlert, Loading } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { inr } from '@/lib/format';

/**
 * Stand-in for a hosted payment page (MockPaymentProvider, development and staging only). The
 * buttons make the mock gateway send a signed webhook; this page itself changes nothing.
 */
function MockPayInner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const ret = sp.get('return');
  const { data, error, isLoading } = useApi<{ amountPaise: number; status: string }>(`/mock-gateway/payments/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const complete = async (outcome: 'SUCCEEDED' | 'FAILED') => {
    setBusy(outcome);
    try {
      await post(`/mock-gateway/payments/${id}/complete`, { outcome });
      router.replace(ret && ret.startsWith('/') ? `${ret}?payment=${outcome.toLowerCase()}` : '/');
    } catch (e) {
      setFailure(e);
      setBusy(null);
    }
  };

  if (isLoading) return <Loading />;
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card title="Test payment gateway">
        <Alert tone="warn" title="Development payment page">
          No real money moves. A real payment provider will replace this page before launch.
        </Alert>
        {error ? (
          <div className="mt-4">
            <ErrorAlert error={error} />
          </div>
        ) : data ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted">Reference {sp.get('ref')}</p>
            <p className="text-3xl font-semibold">{inr(data.amountPaise, true)}</p>
            {data.status !== 'PENDING' ? (
              <Alert tone="info">This payment is already {data.status.toLowerCase()}.</Alert>
            ) : (
              <div className="flex gap-2">
                <Button onClick={() => complete('SUCCEEDED')} busy={busy === 'SUCCEEDED'} disabled={!!busy} className="flex-1">
                  Pay {inr(data.amountPaise)}
                </Button>
                <Button variant="secondary" onClick={() => complete('FAILED')} busy={busy === 'FAILED'} disabled={!!busy}>
                  Simulate failure
                </Button>
              </div>
            )}
            <ErrorAlert error={failure} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export default function MockPayPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MockPayInner />
    </Suspense>
  );
}
