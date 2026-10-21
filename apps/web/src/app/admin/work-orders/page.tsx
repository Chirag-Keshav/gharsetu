'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { statusLabel, WORK_ORDER_STATUSES } from '@propcare/shared';
import { ErrorAlert, Loading, PageHeader, SelectField, StatusBadge, Tabs, cx } from '@/components/ui';
import { useApi } from '@/lib/api';
import { dateTimeLabel, inr } from '@/lib/format';

interface Row {
  id: string;
  reference: string;
  kind: string;
  status: string;
  title: string;
  requestReference: string;
  urgency: string;
  safetyFlag: boolean;
  scheduledStart: string | null;
  approvedTotalPaise: number;
}

const BOARD = ['DRAFT', 'SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED_FOR_REVIEW', 'REWORK_REQUIRED', 'READY_FOR_OWNER_REVIEW'];

function Card({ w }: { w: Row }) {
  return (
    <Link href={`/admin/work-orders/${w.id}`} className={cx('block rounded-lg border bg-surface p-3 text-sm hover:border-brand', w.safetyFlag ? 'border-danger/50' : 'border-line')}>
      <p className="font-medium">
        {w.reference} {w.kind === 'REWORK' && <span className="text-xs text-warn">rework</span>}
      </p>
      <p className="truncate text-muted">{w.title}</p>
      <p className="mt-1 text-xs text-muted">
        {w.scheduledStart ? dateTimeLabel(w.scheduledStart) : 'Not scheduled'} · {inr(w.approvedTotalPaise)}
      </p>
    </Link>
  );
}

function Board() {
  const sp = useSearchParams();
  const [view, setView] = useState<'board' | 'list'>(sp.get('status') ? 'list' : 'board');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const { data, error, isLoading } = useApi<{ items: Row[] }>(`/work-orders?limit=100${view === 'list' && status ? `&status=${status}` : ''}`, { refreshInterval: 30_000 });
  return (
    <>
      <PageHeader title="Work orders" actions={view === 'list' && <SelectField label="Status" value={status} placeholder="All" onChange={(e) => setStatus(e.target.value)} options={WORK_ORDER_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />} />
      <Tabs value={view} onChange={setView} tabs={[{ id: 'board', label: 'Board' }, { id: 'list', label: 'List' }]} />
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && view === 'board' && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {BOARD.map((s) => {
            const items = data.items.filter((w) => w.status === s);
            return (
              <section key={s} className="w-64 shrink-0" aria-label={statusLabel(s)}>
                <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                  {statusLabel(s)} <span>{items.length}</span>
                </h2>
                <div className="space-y-2">
                  {items.map((w) => (
                    <Card key={w.id} w={w} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {data && view === 'list' && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {data.items.map((w) => (
            <li key={w.id}>
              <Link href={`/admin/work-orders/${w.id}`} className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
                <span>
                  <span className="font-medium">{w.reference}</span> · {w.title}
                </span>
                <StatusBadge status={w.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function WorkOrdersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Board />
    </Suspense>
  );
}
