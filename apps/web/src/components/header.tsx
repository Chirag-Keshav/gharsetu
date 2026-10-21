'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from 'swr';
import { post, useApi } from '@/lib/api';
import { brand } from '@/lib/brand';
import { homeFor, switchRole, useMe, type Role } from '@/lib/session';
import { cx } from './ui';

const NAV: Record<Role, Array<{ href: string; label: string }>> = {
  CUSTOMER: [
    { href: '/search', label: 'Explore stays' },
    { href: '/trips', label: 'My trips' },
  ],
  OWNER: [
    { href: '/owner', label: 'Dashboard' },
    { href: '/owner/bookings', label: 'Bookings' },
    { href: '/owner/earnings', label: 'Earnings' },
  ],
  ADMIN: [{ href: '/admin', label: 'Console' }],
};

export function Header() {
  const { me } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const { data: notes } = useApi<{ unread: number }>(me?.activeRole ? '/notifications?limit=1' : null, { refreshInterval: 30_000 });
  const role = me?.activeRole ?? null;
  const links = role ? NAV[role] : [{ href: '/search', label: 'Explore stays' }];
  const otherRole: Role | null = role === 'OWNER' ? 'CUSTOMER' : role === 'CUSTOMER' ? 'OWNER' : null;

  const signOut = async () => {
    await post('/auth/logout');
    await mutate(() => true, undefined, { revalidate: false });
    router.push('/');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Link href={role ? homeFor(role) : '/'} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-ink">
            {brand.productName.charAt(0)}
          </span>
          <span>{brand.productName}</span>
          {role === 'ADMIN' && <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-canvas">Admin</span>}
        </Link>
        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cx('rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-2', (pathname === l.href || (l.href !== '/' && pathname.startsWith(`${l.href}/`))) && 'bg-surface-2')}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {me && otherRole && me.roles.includes(otherRole) && (
            <button
              type="button"
              onClick={async () => {
                await switchRole(otherRole);
                router.push(homeFor(otherRole));
              }}
              className="hidden rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2 sm:inline-flex"
            >
              Switch to {otherRole === 'OWNER' ? 'owner' : 'guest'}
            </button>
          )}
          {me?.activeRole && (
            <Link href="/notifications" className="relative rounded-lg px-2 py-1.5 hover:bg-surface-2" aria-label={`Notifications${notes?.unread ? `, ${notes.unread} unread` : ''}`}>
              <span aria-hidden>🔔</span>
              {!!notes?.unread && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{notes.unread}</span>}
            </Link>
          )}
          {me ? (
            <div className="relative">
              <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                  {(me.user.fullName ?? '?').charAt(0).toUpperCase()}
                </span>
                <span className="hidden max-w-32 truncate sm:inline">{me.user.fullName ?? me.user.phoneMasked}</span>
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-60 rounded-xl border border-line bg-surface p-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
                  {links.map((l) => (
                    <Link key={l.href} href={l.href} onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2 md:hidden">
                      {l.label}
                    </Link>
                  ))}
                  {me.activeRole !== 'ADMIN' && (
                    <Link href="/account" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
                      Account and preferences
                    </Link>
                  )}
                  {me && otherRole && me.roles.includes(otherRole) && (
                    <button
                      type="button"
                      onClick={async () => {
                        setMenu(false);
                        await switchRole(otherRole);
                        router.push(homeFor(otherRole));
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2 sm:hidden"
                    >
                      Switch to {otherRole === 'OWNER' ? 'owner' : 'guest'}
                    </button>
                  )}
                  {me.activeRole === 'CUSTOMER' && !me.roles.includes('OWNER') && (
                    <Link href="/account#roles" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
                      Also list or maintain a property
                    </Link>
                  )}
                  {me.activeRole === 'OWNER' && !me.roles.includes('CUSTOMER') && (
                    <Link href="/account#roles" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
                      Also look for a stay
                    </Link>
                  )}
                  <button type="button" onClick={signOut} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-surface-2">
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href="/auth?intent=owner" className="hidden rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-2 sm:inline-flex">
                List or care for your property
              </Link>
              <Link href={`/auth?returnTo=${encodeURIComponent(pathname)}`} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
