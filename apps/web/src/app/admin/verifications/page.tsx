'use client';
import { useState } from 'react';
import { statusLabel } from '@propcare/shared';
import { Button, Card, Empty, ErrorAlert, Loading, PageHeader, SelectField, StatusBadge, TextField } from '@/components/ui';
import { openAttachment, post, useApi } from '@/lib/api';
import { ago } from '@/lib/format';
import { useAction } from '@/lib/use-action';

interface Row {
  id: string;
  subjectType: 'OWNER' | 'PROPERTY';
  subjectLabel: string;
  ownerName: string | null;
  status: string;
  submittedAt: string | null;
  reason: string | null;
  documents: Array<{ id: string; docType: string; attachmentId: string; expiresAt: string | null }>;
}

export default function Verifications() {
  const [status, setStatus] = useState('PENDING');
  const { data, error, isLoading, mutate } = useApi<{ items: Row[] }>(`/admin/verifications?status=${status}&limit=100`);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const { busy, error: actError, run } = useAction();
  return (
    <>
      <PageHeader
        title="Verifications"
        subtitle="Documents open in a new tab through short-lived signed links; every view is logged."
        actions={<SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={['PENDING', 'APPROVED', 'REJECTED'].map((s) => ({ value: s, label: statusLabel(s) }))} />}
      />
      {isLoading && <Loading />}
      <ErrorAlert error={error ?? actError} />
      {data?.items.length === 0 && <Empty title="No verifications in this state" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.items.map((v) => (
          <Card key={v.id} title={`${v.subjectType === 'OWNER' ? 'Owner identity' : 'Property'} · ${v.subjectLabel}`} actions={<StatusBadge status={v.status} />}>
            <p className="text-sm text-muted">
              {v.ownerName && `Owner ${v.ownerName} · `}submitted {ago(v.submittedAt)}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {v.documents.map((d) => (
                <li key={d.id}>
                  <button type="button" className="rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2" onClick={() => openAttachment(d.attachmentId)}>
                    📄 {statusLabel(d.docType)}
                  </button>
                </li>
              ))}
            </ul>
            {v.reason && <p className="mt-2 text-sm">Reason: {v.reason}</p>}
            {v.status === 'PENDING' && (
              <div className="mt-4 space-y-2">
                <TextField label="Note to the owner (required to reject)" value={reasons[v.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [v.id]: e.target.value })} maxLength={1000} />
                <div className="flex gap-2">
                  <Button size="sm" busy={busy === `a-${v.id}`} onClick={() => run(`a-${v.id}`, async () => { await post(`/admin/verifications/${v.id}/approve`, { reason: reasons[v.id] || null }); await mutate(); })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" disabled={!reasons[v.id]} busy={busy === `r-${v.id}`} onClick={() => run(`r-${v.id}`, async () => { await post(`/admin/verifications/${v.id}/reject`, { reason: reasons[v.id] }); await mutate(); })}>
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
