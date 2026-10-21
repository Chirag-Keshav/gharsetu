'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ISSUE_STATUSES, statusLabel } from '@propcare/shared';
import { ErrorAlert, Loading, PageHeader, SelectField, StatusBadge, Table } from '@/components/ui';
import { useApi } from '@/lib/api';
import { ago } from '@/lib/format';

interface Row {
  id: string;
  reference: string;
  subjectType: string;
  category: string;
  description: string;
  status: string;
  raisedByRole: string;
  createdAt: string;
  handledByAdminId?: string | null;
}

export default function AdminIssues() {
  const [status, setStatus] = useState('OPEN');
  const { data, error, isLoading } = useApi<{ items: Row[] }>(`/admin/issues?limit=100${status ? `&status=${status}` : ''}`);
  return (
    <>
      <PageHeader title="Issues" actions={<SelectField label="Status" value={status} placeholder="All" onChange={(e) => setStatus(e.target.value)} options={ISSUE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />} />
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && (
        <Table
          head={['Issue', 'About', 'Raised by', 'Age', 'Status']}
          empty="No issues"
          rows={data.items.map((i) => [
            <Link key="i" href={`/issues/${i.id}`} className="block max-w-[340px]">
              <span className="font-medium underline">{i.reference}</span> · {statusLabel(i.category)}
              <span className="block truncate text-xs text-muted">{i.description}</span>
            </Link>,
            statusLabel(i.subjectType),
            statusLabel(i.raisedByRole),
            ago(i.createdAt),
            <span key="s" className="flex flex-col gap-1">
              <StatusBadge status={i.status} />
              {!i.handledByAdminId && i.status === 'OPEN' && <span className="text-xs text-muted">Unassigned</span>}
            </span>,
          ])}
        />
      )}
    </>
  );
}
