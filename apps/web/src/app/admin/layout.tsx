'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cx } from '@/components/ui';
import { useApi } from '@/lib/api';
import { RoleGate, type Me } from '@/lib/session';

const NAV: Array<{ group: string; items: Array<{ href: string; label: string; flag?: string; count?: string }> }> = [
  { group: 'Overview', items: [{ href: '/admin', label: 'Dashboard' }] },
  {
    group: 'Care',
    items: [
      { href: '/admin/requests', label: 'Requests', count: 'openRequests' },
      { href: '/admin/work-orders', label: 'Work orders', count: 'workOrdersAwaitingApproval' },
      { href: '/admin/providers', label: 'Providers' },
    ],
  },
  {
    group: 'Stays',
    items: [
      { href: '/admin/listings', label: 'Listings', count: 'listingsAwaitingReview' },
      { href: '/admin/verifications', label: 'Verifications', count: 'verificationsPending' },
      { href: '/admin/bookings', label: 'Bookings', count: 'bookingsRequested' },
    ],
  },
  { group: 'Support', items: [{ href: '/admin/issues', label: 'Issues', count: 'openIssues' }] },
  {
    group: 'Finance',
    items: [
      { href: '/admin/payouts', label: 'Payouts', flag: 'FINANCE', count: 'payoutsEligible' },
      { href: '/admin/payments', label: 'Payments', flag: 'FINANCE' },
      { href: '/admin/commission', label: 'Commission', flag: 'FINANCE' },
    ],
  },
  {
    group: 'Configure',
    items: [
      { href: '/admin/config', label: 'Catalogue', flag: 'CATALOG_ADMIN' },
      { href: '/admin/settings', label: 'Policy settings' },
      { href: '/admin/staff', label: 'Staff and users', flag: 'USER_ADMIN' },
      { href: '/admin/ai', label: 'AI usage', flag: 'AI_ADMIN' },
      { href: '/admin/reports', label: 'Reports' },
      { href: '/admin/audit', label: 'Audit log', flag: 'AUDIT_VIEW' },
    ],
  },
];

function Sidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const { data } = useApi<{ queues: Record<string, number> }>('/admin/dashboard', { refreshInterval: 60_000 });
  return (
    <nav aria-label="Admin" className="space-y-4 text-sm">
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.flag || me.flags.includes(i.flag));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.group}</p>
            <ul>
              {items.map((i) => {
                const active = i.href === '/admin' ? pathname === '/admin' : pathname === i.href || pathname.startsWith(`${i.href}/`);
                const count = i.count ? data?.queues[i.count] : undefined;
                return (
                  <li key={i.href}>
                    <Link href={i.href} aria-current={active ? 'page' : undefined} className={cx('flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-2', active && 'bg-surface-2 font-medium')}>
                      {i.label}
                      {!!count && <span className="rounded-full bg-brand-soft px-1.5 text-xs text-brand">{count}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Admin console shell (SPEC §15): every page needs the ADMIN role; flags are enforced by the API. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="ADMIN">
      {(me) => (
        <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-6">
          <aside className="hidden w-52 shrink-0 md:block">
            <div className="sticky top-20">
              <Sidebar me={me} />
            </div>
          </aside>
          <div className="min-w-0 flex-1">
            <details className="mb-4 rounded-lg border border-line bg-surface p-2 md:hidden">
              <summary className="cursor-pointer text-sm font-medium">Menu</summary>
              <div className="mt-2">
                <Sidebar me={me} />
              </div>
            </details>
            {children}
          </div>
        </div>
      )}
    </RoleGate>
  );
}
