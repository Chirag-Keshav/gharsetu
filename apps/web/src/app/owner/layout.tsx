'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Loading } from '@/components/ui';
import { RoleGate, type Me } from '@/lib/session';

function NeedsMode({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const redirect = me.onboarding.needsServiceMode && pathname !== '/owner/start';
  useEffect(() => {
    if (redirect) router.replace('/owner/start');
  }, [redirect, router]);
  return redirect ? <Loading /> : <>{children}</>;
}

/** Owner area: every page needs the OWNER role and a chosen service mode (SPEC §3.2). */
export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="OWNER">
      {(me) => (
        <NeedsMode me={me}>
          <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
        </NeedsMode>
      )}
    </RoleGate>
  );
}
