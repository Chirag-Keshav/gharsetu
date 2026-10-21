'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { mutate } from 'swr';
import { Alert, Button, Card, Form, Loading, TextField } from '@/components/ui';
import { describeError, patch, post } from '@/lib/api';
import { brand } from '@/lib/brand';
import { homeFor, useMe, type Me } from '@/lib/session';

type Step = 'phone' | 'code' | 'name';

function safeReturn(v: string | null) {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : null;
}

function AuthInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const returnTo = safeReturn(sp.get('returnTo'));
  const intent = sp.get('intent');
  const bookingIntent = intent === 'booking' || !!returnTo?.startsWith('/book/');
  const { me } = useMe();
  const [step, setStep] = useState<Step>(sp.get('step') === 'name' ? 'name' : 'phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [challenge, setChallenge] = useState<{ challengeId: string; resendAfterSeconds: number } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const finish = (m: Me) => {
    if (m.onboarding.needsName) return setStep('name');
    if (m.activeRole === 'ADMIN') return router.replace('/admin');
    if (m.onboarding.needsRole) return router.replace(`/onboarding/role${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : intent === 'owner' ? '?intent=owner' : ''}`);
    router.replace(returnTo ?? homeFor(m.activeRole));
  };

  // Already signed in (e.g. returning to this page): continue.
  useEffect(() => {
    if (me && step === 'phone') finish(me);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ challengeId: string; resendAfterSeconds: number }>('/auth/otp/request', { phone });
      setChallenge(r);
      setCooldown(r.resendAfterSeconds);
      setStep('code');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-1 text-2xl font-semibold">{step === 'name' ? 'One last thing' : `Sign in to ${brand.productName}`}</h1>
      <p className="mb-6 text-sm text-muted">
        {step === 'phone' && 'We will text a one-time code to your Indian mobile number. New here? This also creates your account.'}
        {step === 'code' && `Enter the 6-digit code sent to ${phone}.`}
        {step === 'name' && 'Tell us your name so owners, guests and our team know who they are talking to.'}
      </p>
      <Card>
        {error ? (
          <div className="mb-4">
            <Alert tone="danger">{describeError(error)}</Alert>
          </div>
        ) : null}
        {step === 'phone' && (
          <Form onSubmit={requestCode} className="space-y-4">
            <TextField label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" pattern="^(\+?91[\s\-]?)?0?[6-9]\d{4}[\s\-]?\d{5}$" invalidMessage="Enter a 10-digit Indian mobile number." hint="India (+91) numbers only." />
            <Button type="submit" className="w-full" busy={busy}>
              Send code
            </Button>
          </Form>
        )}
        {step === 'code' && challenge && (
          <Form
            className="space-y-4"
            onSubmit={async () => {
              setBusy(true);
              setError(null);
              try {
                const m = await post<Me>('/auth/otp/verify', { challengeId: challenge.challengeId, code, ...(bookingIntent ? { intent: 'BOOKING' } : {}) });
                await mutate('/me', m, { revalidate: false });
                finish(m);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <TextField label="One-time code" inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} invalidMessage="Enter the 6 digits." />
            {process.env.NODE_ENV !== 'production' && <p className="text-xs text-muted">Development: with OTP test mode on, the code is 123456.</p>}
            <Button type="submit" className="w-full" busy={busy}>
              Verify and continue
            </Button>
            <div className="flex justify-between text-sm">
              <button type="button" className="text-muted hover:text-ink" onClick={() => setStep('phone')}>
                Change number
              </button>
              <button type="button" disabled={cooldown > 0} className="font-medium text-brand disabled:text-muted" onClick={requestCode}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </Form>
        )}
        {step === 'name' && (
          <Form
            className="space-y-4"
            onSubmit={async () => {
              setBusy(true);
              try {
                const m = await patch<Me>('/me', { fullName: name });
                await mutate('/me', m, { revalidate: false });
                finish(m);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <TextField label="Full name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" className="w-full" busy={busy}>
              Continue
            </Button>
          </Form>
        )}
      </Card>
      <p className="mt-4 text-center text-xs text-muted">By continuing you agree to the terms and privacy notice (placeholder documents pending legal review).</p>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AuthInner />
    </Suspense>
  );
}
