'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { mutate } from 'swr';
import { ErrorAlert, Loading } from '@/components/ui';
import { post } from '@/lib/api';
import { brand } from '@/lib/brand';
import { homeFor, useMe, type Me } from '@/lib/session';

/** Role selection after first sign-in (SPEC §3.1, ROLE-01). Admins never see this page. */
function RoleInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const returnTo = sp.get('returnTo');
  const { me, isLoading } = useMe();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!me) return;
    if (me.activeRole === 'ADMIN') router.replace('/admin');
    else if (!me.onboarding.needsRole) router.replace(returnTo && returnTo.startsWith('/') ? returnTo : homeFor(me.activeRole));
  }, [me, router, returnTo]);

  const choose = async (role: 'OWNER' | 'CUSTOMER') => {
    setBusy(role);
    setError(null);
    try {
      const m = await post<Me>('/me/roles', { role });
      await mutate('/me', m, { revalidate: false });
      router.replace(role === 'OWNER' ? '/owner/start' : returnTo && returnTo.startsWith('/') ? returnTo : '/search');
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  if (isLoading || !me || !me.onboarding.needsRole) return <Loading />;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Welcome{me.user.fullName ? `, ${me.user.fullName.split(' ')[0]}` : ''}! How will you use {brand.productName}?</h1>
      <p className="mt-1 text-sm text-muted">You can add the other option later from your account menu.</p>
      <div className="mt-4">
        <ErrorAlert error={error} />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {[
          { role: 'OWNER' as const, icon: '🏡', title: 'I own a property', text: 'Maintain it remotely, list it for short stays, or both.' },
          { role: 'CUSTOMER' as const, icon: '🧳', title: "I'm looking for a property", text: 'Find and book a verified home for your next stay.' },
        ].map((c) => (
          <button
            key={c.role}
            type="button"
            onClick={() => choose(c.role)}
            disabled={!!busy}
            className="rounded-2xl border-2 border-line bg-surface p-6 text-left transition hover:border-brand focus-visible:border-brand disabled:opacity-60"
          >
            <span className="text-3xl" aria-hidden>
              {c.icon}
            </span>
            <span className="mt-3 block text-lg font-semibold">{c.title}</span>
            <span className="mt-1 block text-sm text-muted">{c.text}</span>
            {busy === c.role && <span className="mt-3 block text-sm text-brand">Setting up…</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function RolePage() {
  return (
    <Suspense fallback={<Loading />}>
      <RoleInner />
    </Suspense>
  );
}
