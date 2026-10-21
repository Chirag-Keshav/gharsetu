'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { statusLabel } from '@propcare/shared';
import { Button, ErrorAlert, Loading, PageHeader, Table, TextField } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { dateTimeLabel } from '@/lib/format';

interface AuditEvent {
  id: string;
  action: string;
  actorName: string | null;
  actorRole: string;
  entityType: string;
  entityId: string | null;
  onBehalfOfType: string | null;
  onBehalfOfId: string | null;
  metadata: unknown;
  requestId: string | null;
  createdAt: string;
}

function Audit() {
  const sp = useSearchParams();
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState(sp.get('entityId') ?? '');
  const [action, setAction] = useState('');
  const qs = new URLSearchParams({ limit: '50', ...(entityType && { entityType }), ...(entityId && { entityId }), ...(action && { action }) }).toString();
  const { data, error, isLoading } = useApi<{ items: AuditEvent[]; nextCursor: string | null }>(`/admin/audit-events?${qs}`);
  const [more, setMore] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const next = cursor === undefined ? data?.nextCursor : cursor;
  const rows = [...(data?.items ?? []), ...more];
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only. Personal data and secrets are never written here." />
      <div className="mb-4 flex flex-wrap gap-3">
        <TextField label="Entity type" value={entityType} onChange={(e) => { setEntityType(e.target.value.toUpperCase()); setMore([]); setCursor(undefined); }} placeholder="BOOKING" />
        <TextField label="Entity ID" value={entityId} onChange={(e) => { setEntityId(e.target.value); setMore([]); setCursor(undefined); }} />
        <TextField label="Action contains" value={action} onChange={(e) => { setAction(e.target.value); setMore([]); setCursor(undefined); }} placeholder="quote." />
      </div>
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      <Table
        head={['When', 'Who', 'Action', 'Entity', 'Details']}
        empty="No events"
        rows={rows.map((e) => [
          dateTimeLabel(e.createdAt),
          <span key="w">
            {e.actorName ?? '—'} {e.actorRole !== 'SYSTEM' && <span className="text-xs text-muted">{statusLabel(e.actorRole)}</span>}
            {e.onBehalfOfType && <span className="block text-xs text-warn">on behalf of {statusLabel(e.onBehalfOfType).toLowerCase()} {e.onBehalfOfId?.slice(0, 8)}</span>}
          </span>,
          <code key="a" className="text-xs">{e.action}</code>,
          <span key="en" className="text-xs">
            {e.entityType} {e.entityId?.slice(0, 8)}
          </span>,
          <code key="m" className="block max-w-[360px] truncate text-xs text-muted" title={JSON.stringify(e.metadata)}>
            {e.metadata ? JSON.stringify(e.metadata) : ''}
          </code>,
        ])}
      />
      {next && (
        <Button
          className="mt-3"
          variant="secondary"
          onClick={async () => {
            const page = await api<{ items: AuditEvent[]; nextCursor: string | null }>(`/admin/audit-events?${qs}&cursor=${encodeURIComponent(next)}`);
            setMore((m) => [...m, ...page.items]);
            setCursor(page.nextCursor);
          }}
        >
          Load more
        </Button>
      )}
    </>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Audit />
    </Suspense>
  );
}
