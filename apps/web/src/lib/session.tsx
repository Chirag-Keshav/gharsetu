'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { mutate as globalMutate } from 'swr';
import { Button, Card, Loading } from '@/components/ui';
import { post, useApi } from './api';

export type Role = 'OWNER' | 'CUSTOMER' | 'ADMIN';

export interface Me {
  user: { id: string; fullName: string | null; phone: string; phoneMasked: string; email: string | null; communicationPrefs: Record<string, boolean> };
  roles: Role[];
  activeRole: Role | null;
  lastActiveRole: Role | null;
  flags: string[];
  onboarding: { needsName: boolean; needsRole: boolean; needsServiceMode: boolean };
}

export function useMe() {
  const res = useApi<Me>('/me');
  return { ...res, me: res.error?.status === 401 ? null : res.data, signedOut: res.error?.status === 401 };
}

export const homeFor = (role: Role | null) => (role === 'ADMIN' ? '/admin' : role === 'OWNER' ? '/owner' : role === 'CUSTOMER' ? '/trips' : '/onboarding/role');

export async function switchRole(role: Role) {
  await post('/me/active-role', { role });
  // Every role-scoped cache is stale after a switch.
  await globalMutate(() => true, undefined, { revalidate: true });
}

export function hasFlag(me: Me | null | undefined, flag: string) {
  return !!me && me.activeRole === 'ADMIN' && me.flags.includes(flag);
}

/**
 * Client-side gate for role areas. Authorisation is enforced by the API; this only routes people
 * to sign-in, role selection or the right area.
 */
export function RoleGate({ role, children }: { role: Role; children: (me: Me) => ReactNode }) {
  const { me, signedOut, isLoading, mutate } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (signedOut) router.replace(`/auth?returnTo=${encodeURIComponent(pathname)}`);
    else if (me && me.onboarding.needsRole) router.replace(`/onboarding/role?returnTo=${encodeURIComponent(pathname)}`);
    else if (me && me.onboarding.needsName) router.replace(`/auth?step=name&returnTo=${encodeURIComponent(pathname)}`);
  }, [me, signedOut, router, pathname]);
  if (isLoading || !me || me.onboarding.needsRole) return <Loading />;
  if (me.activeRole !== role) {
    const holds = me.roles.includes(role);
    const names: Record<Role, string> = { OWNER: 'property owner', CUSTOMER: 'guest', ADMIN: 'admin' };
    return (
      <div className="mx-auto max-w-lg py-12">
        <Card title={`This page is for the ${names[role]} area`}>
          <p className="text-sm text-muted">
            You are signed in as a {names[me.activeRole ?? 'CUSTOMER']}.{' '}
            {holds ? 'Switch roles to continue.' : role === 'ADMIN' ? 'Admin accounts are separate.' : 'You can add this role to your account.'}
          </p>
          <div className="mt-4 flex gap-2">
            {holds ? (
              <Button
                onClick={async () => {
                  await switchRole(role);
                  await mutate();
                }}
              >
                Switch to {names[role]}
              </Button>
            ) : role !== 'ADMIN' && me.activeRole !== 'ADMIN' ? (
              <Button
                onClick={async () => {
                  await post('/me/roles', { role });
                  await globalMutate(() => true, undefined, { revalidate: true });
                }}
              >
                Add the {names[role]} role
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => router.push(homeFor(me.activeRole))}>
              Go to my home
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  return <>{children(me)}</>;
}

/** Gate for pages any signed-in role can use (issues, notifications, account). */
export function SignedIn({ children }: { children: (me: Me) => ReactNode }) {
  const { me, signedOut, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (signedOut) router.replace(`/auth?returnTo=${encodeURIComponent(pathname)}`);
    else if (me && me.onboarding.needsRole) router.replace(`/onboarding/role?returnTo=${encodeURIComponent(pathname)}`);
  }, [me, signedOut, router, pathname]);
  if (isLoading || !me || me.onboarding.needsRole) return <Loading />;
  return <>{children(me)}</>;
}
