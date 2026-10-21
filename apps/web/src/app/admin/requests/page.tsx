'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { REQUEST_STATUSES, statusLabel, URGENCIES } from '@propcare/shared';
import { Checkbox, ErrorAlert, Loading, PageHeader, SelectField, StatusBadge, Table } from '@/components/ui';
import { useApi } from '@/lib/api';

interface Row {
  id: string;
  reference: string;
  title: string;
  status: string;
  urgency: string;
  safetyFlag: boolean;
  property: { nickname: string; city: string } | null;
  category: string | null;
  ageHours: number;
  handledBy: string | null;
  aiSummary: string | null;
}

function Queue() {
  const sp = useSearchParams();
  const [status, setStatus] = useState('');
  const [urgency, setUrgency] = useState('');
  const [handler, setHandler] = useState('');
  const [safety, setSafety] = useState(sp.get('safety') === 'true');
  const qs = new URLSearchParams({ limit: '100', ...(status && { status }), ...(urgency && { urgency }), ...(handler && { handler }), ...(safety && { safety: 'true' }) });
  const { data, error, isLoading } = useApi<{ items: Row[] }>(`/admin/requests?${qs}`, { refreshInterval: 30_000 });
  return (
    <>
      <PageHeader title="Service requests" subtitle="Safety-flagged requests always sort first." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label="Status" value={status} placeholder="All open" onChange={(e) => setStatus(e.target.value)} options={REQUEST_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
        <SelectField label="Urgency" value={urgency} placeholder="Any" onChange={(e) => setUrgency(e.target.value)} options={URGENCIES.map((s) => ({ value: s, label: statusLabel(s) }))} />
        <SelectField label="Handler" value={handler} placeholder="Anyone" onChange={(e) => setHandler(e.target.value)} options={[{ value: 'me', label: 'Me' }, { value: 'unassigned', label: 'Unassigned' }]} />
        <div className="pb-2">
          <Checkbox label="Safety only" checked={safety} onChange={(e) => setSafety(e.target.checked)} />
        </div>
      </div>
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && (
        <Table
          head={['Request', 'Property', 'Category', 'Age', 'Handler', 'Status']}
          empty="No requests match"
          rows={data.items.map((r) => [
            <Link key="r" href={`/admin/requests/${r.id}`} className="block max-w-[320px]">
              <span className="font-medium underline">{r.reference}</span> {r.safetyFlag && <StatusBadge status="SAFETY_RISK" label="Safety" />}
              <span className="block truncate text-xs text-muted">{r.title}</span>
              {r.aiSummary && <span className="block truncate text-xs text-ai">✨ {r.aiSummary}</span>}
            </Link>,
            r.property ? `${r.property.nickname} · ${r.property.city}` : '—',
            r.category ?? '—',
            `${r.ageHours}h`,
            r.handledBy ?? <span className="text-muted">Unassigned</span>,
            <span key="s" className="flex flex-col gap-1">
              <StatusBadge status={r.status} />
              {r.urgency !== 'STANDARD' && <StatusBadge status={r.urgency} />}
            </span>,
          ])}
        />
      )}
    </>
  );
}

export default function AdminRequests() {
  return (
    <Suspense fallback={<Loading />}>
      <Queue />
    </Suspense>
  );
}
