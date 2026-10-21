'use client';
import Link from 'next/link';
import { AI_LABEL, statusLabel } from '@propcare/shared';
import { Badge, Button, Card, ErrorAlert, Loading, PageHeader, Stat } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { ago } from '@/lib/format';
import { entityHref } from '@/lib/admin';
import { useAction } from '@/lib/use-action';

interface Dashboard {
  queues: Record<string, number>;
  attention: {
    safetyRequests: Array<{ id: string; reference: string; ageHours: number; unassigned: boolean }>;
    unclaimedRequests: Array<{ id: string; reference: string; ageHours: number; urgency: string }>;
    expiringBookingRequests: Array<{ id: string; reference: string; hoursLeft: number | null }>;
    oldestListings: Array<{ id: string; reference: string; waitingHours: number; propertyVerified: boolean }>;
    blockedWorkOrders: Array<{ id: string; reference: string; reason: string | null }>;
    openIssues: Array<{ id: string; reference: string; ageHours: number; subjectType: string }>;
  };
  alerts: Array<{ id: string; type: string; entityType: string; entityId: string; createdAt: string }>;
}

interface Briefing {
  aiEnabled: boolean;
  briefing: {
    id: string;
    status: string;
    createdAt: string;
    isToday: boolean;
    output: {
      summary: string;
      highlights: Array<{ label: string; severity: string }>;
      risks: Array<{ label: string; severity: string }>;
      suggestedActions: Array<{ label: string; entityType: string; entityId: string; rationale: string; priority: number }>;
    } | null;
  } | null;
}

function BriefingCard() {
  const { data, mutate } = useApi<Briefing>('/admin/ai/briefing', { refreshInterval: (d) => (d?.briefing?.status === 'PENDING' ? 2000 : 0) });
  const { busy, error, run } = useAction();
  if (!data?.aiEnabled) return null;
  const b = data.briefing;
  return (
    <Card
      title={
        <span className="flex items-center gap-2 font-semibold">
          ✨ Daily briefing <Badge tone="info">{AI_LABEL}</Badge>
        </span>
      }
      actions={
        <Button size="sm" variant="ai" busy={busy === 'refresh'} onClick={() => run('refresh', async () => { await post('/admin/ai/briefing/refresh'); await mutate(); })}>
          Refresh
        </Button>
      }
    >
      {!b && <p className="text-sm text-muted">No briefing yet today.</p>}
      {b?.status === 'PENDING' && <p className="text-sm text-muted" role="status">Preparing…</p>}
      {b?.output && (
        <div className="space-y-3 text-sm">
          <p>{b.output.summary}</p>
          {b.output.risks.length > 0 && (
            <ul className="space-y-1">
              {b.output.risks.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <Badge tone={r.severity === 'HIGH' ? 'danger' : r.severity === 'MEDIUM' ? 'warn' : 'neutral'}>{statusLabel(r.severity)}</Badge> {r.label}
                </li>
              ))}
            </ul>
          )}
          {b.output.suggestedActions.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Suggested next steps</p>
              <ol className="space-y-1">
                {[...b.output.suggestedActions]
                  .sort((x, y) => x.priority - y.priority)
                  .map((a, i) => (
                    <li key={i}>
                      <Link href={entityHref(a.entityType, a.entityId)} className="underline">
                        {a.label}
                      </Link>
                      <span className="text-muted"> — {a.rationale}</span>
                    </li>
                  ))}
              </ol>
            </div>
          )}
          <p className="text-xs text-muted">
            Generated {ago(b.createdAt)}. Suggestions only — nothing changes until you act.
          </p>
        </div>
      )}
      <ErrorAlert error={error} />
    </Card>
  );
}

function AttentionList({ title, items }: { title: string; items: Array<{ href: string; label: string; meta: string }> }) {
  return (
    <Card title={title} padded={false}>
      {items.length === 0 ? (
        <p className="p-4 text-sm text-muted">Nothing waiting.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="flex justify-between gap-2 px-4 py-2 hover:bg-surface-2">
                <span className="font-medium">{i.label}</span>
                <span className="text-muted">{i.meta}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AdminDashboard() {
  const { data, error, isLoading, mutate } = useApi<Dashboard>('/admin/dashboard', { refreshInterval: 60_000 });
  const { run } = useAction();
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorAlert error={error} />;
  const q = data.queues;
  const a = data.attention;
  return (
    <>
      <PageHeader title="Operations" />
      <div className="mb-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Safety requests" value={q.safetyRequests} tone={q.safetyRequests ? 'danger' : undefined} href="/admin/requests?safety=true" />
        <Stat label="Open requests" value={q.openRequests} href="/admin/requests" />
        <Stat label="Listings to review" value={q.listingsAwaitingReview} hint={q.editedListings ? `${q.editedListings} edited` : undefined} href="/admin/listings" />
        <Stat label="Verifications" value={q.verificationsPending} href="/admin/verifications" />
        <Stat label="Booking requests" value={q.bookingsRequested} hint={q.bookingRequestsNearExpiry ? `${q.bookingRequestsNearExpiry} expiring soon` : undefined} tone={q.bookingRequestsNearExpiry ? 'warn' : undefined} href="/admin/bookings?status=REQUESTED" />
        <Stat label="Open issues" value={q.openIssues} href="/admin/issues" />
        <Stat label="Blocked work" value={q.blockedWorkOrders} tone={q.blockedWorkOrders ? 'warn' : undefined} href="/admin/work-orders?status=BLOCKED" />
        <Stat label="Awaiting approval" value={q.workOrdersAwaitingApproval} href="/admin/work-orders?status=SUBMITTED_FOR_REVIEW" />
        <Stat label="Payouts eligible" value={q.payoutsEligible} href="/admin/payouts?status=ELIGIBLE" />
        <Stat label="Payouts on hold" value={q.payoutsOnHold} href="/admin/payouts?status=ON_HOLD" />
        <Stat label="Awaiting payment" value={q.bookingsAwaitingPayment} />
        <Stat label="Alerts" value={q.unresolvedAlerts} tone={q.unresolvedAlerts ? 'warn' : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="grid gap-4 md:grid-cols-2">
          <AttentionList title="Safety first" items={a.safetyRequests.map((r) => ({ href: `/admin/requests/${r.id}`, label: r.reference, meta: `${r.ageHours}h${r.unassigned ? ' · unassigned' : ''}` }))} />
          <AttentionList title="Oldest new requests" items={a.unclaimedRequests.map((r) => ({ href: `/admin/requests/${r.id}`, label: r.reference, meta: `${r.ageHours}h · ${statusLabel(r.urgency)}` }))} />
          <AttentionList title="Booking requests expiring" items={a.expiringBookingRequests.map((b) => ({ href: `/admin/bookings/${b.id}`, label: b.reference, meta: b.hoursLeft === null ? '' : `${b.hoursLeft}h left` }))} />
          <AttentionList title="Listings waiting" items={a.oldestListings.map((l) => ({ href: `/admin/listings/${l.id}`, label: l.reference, meta: `${l.waitingHours}h${l.propertyVerified ? '' : ' · unverified'}` }))} />
          <AttentionList title="Blocked work orders" items={a.blockedWorkOrders.map((w) => ({ href: `/admin/work-orders/${w.id}`, label: w.reference, meta: statusLabel(w.reason) }))} />
          <AttentionList title="Open issues" items={a.openIssues.map((i) => ({ href: `/issues/${i.id}`, label: i.reference, meta: `${i.ageHours}h · ${statusLabel(i.subjectType)}` }))} />
        </div>
        <div className="space-y-4">
          <BriefingCard />
          <Card title="Alerts" padded={false}>
            {data.alerts.length === 0 && <p className="p-4 text-sm text-muted">No open alerts.</p>}
            <ul className="divide-y divide-line text-sm">
              {data.alerts.map((al) => (
                <li key={al.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <Link href={entityHref(al.entityType, al.entityId)} className="underline">
                    {statusLabel(al.type)}
                  </Link>
                  <span className="flex items-center gap-2 text-muted">
                    {ago(al.createdAt)}
                    <Button size="sm" variant="ghost" onClick={() => run(al.id, async () => { await post(`/admin/alerts/${al.id}/resolve`); await mutate(); })}>
                      Resolve
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
