'use client';
import { useState } from 'react';
import { PERMISSION_FLAGS, statusLabel } from '@propcare/shared';
import { Button, Card, Checkbox, ErrorAlert, Form, Loading, PageHeader, SelectField, StatusBadge, Table, Tabs, TextField } from '@/components/ui';
import { patch, post, put, useApi } from '@/lib/api';
import { pct } from '@/lib/format';
import { useAction } from '@/lib/use-action';

interface Staff {
  id: string;
  fullName: string | null;
  phone: string;
  status: string;
  flags: string[];
  phoneVerified: boolean;
}
interface UserRow {
  id: string;
  fullName: string | null;
  phone: string;
  roles: string[];
  status: string;
  ownerVerification: string | null;
  commissionOverrideBps: number | null;
}

function StaffTab() {
  const { data, mutate } = useApi<{ items: Staff[] }>('/admin/staff');
  const [f, setF] = useState({ fullName: '', phone: '', flags: [] as string[] });
  const { busy, error, run } = useAction();
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <ErrorAlert error={error} />
      <Table
        head={['Name', 'Phone', 'Flags', 'Status']}
        rows={data.items.map((s) => [
          <span key="n" className="font-medium">
            {s.fullName}
            {!s.phoneVerified && <span className="block text-xs text-muted">Has not signed in yet</span>}
          </span>,
          s.phone,
          <div key="f" className="flex max-w-[480px] flex-wrap gap-x-3 gap-y-1">
            {PERMISSION_FLAGS.map((flag) => (
              <Checkbox key={flag} label={statusLabel(flag)} checked={s.flags.includes(flag)} onChange={(e) => run(`${s.id}-${flag}`, async () => { await patch(`/admin/staff/${s.id}`, { flags: e.target.checked ? [...s.flags, flag] : s.flags.filter((x) => x !== flag) }); await mutate(); })} />
            ))}
          </div>,
          <span key="s" className="flex flex-col gap-1">
            <StatusBadge status={s.status} />
            <Button size="sm" variant="ghost" onClick={() => run(`st-${s.id}`, async () => { await patch(`/admin/staff/${s.id}`, { status: s.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }); await mutate(); })}>
              {s.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
            </Button>
          </span>,
        ])}
      />
      <Card title="Add staff member">
        <Form className="space-y-3" onSubmit={() => run('add', async () => { await post('/admin/staff', f); setF({ fullName: '', phone: '', flags: [] }); await mutate(); })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Full name" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
            <TextField label="Mobile" required type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} hint="Admin accounts are separate: this number cannot also be an owner or guest." />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {PERMISSION_FLAGS.map((flag) => (
              <Checkbox key={flag} label={statusLabel(flag)} checked={f.flags.includes(flag)} onChange={(e) => setF({ ...f, flags: e.target.checked ? [...f.flags, flag] : f.flags.filter((x) => x !== flag) })} />
            ))}
          </div>
          <Button type="submit" variant="secondary" busy={busy === 'add'}>
            Add
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function UsersTab() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const { data, mutate } = useApi<{ items: UserRow[] }>(`/admin/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}${role ? `&role=${role}` : ''}`);
  const [override, setOverride] = useState<{ id: string; pct: string; reason: string } | null>(null);
  const { busy, error, run } = useAction();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Search name or phone" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="Role" value={role} placeholder="Any" onChange={(e) => setRole(e.target.value)} options={[{ value: 'OWNER', label: 'Owner' }, { value: 'CUSTOMER', label: 'Guest' }]} />
      </div>
      <ErrorAlert error={error} />
      <Table
        head={['Name', 'Phone', 'Roles', 'Verification', 'Commission', 'Status']}
        rows={(data?.items ?? []).map((u) => [
          u.fullName ?? '—',
          u.phone,
          u.roles.map(statusLabel).join(', '),
          u.ownerVerification ? <StatusBadge key="v" status={u.ownerVerification} /> : '—',
          u.roles.includes('OWNER') ? (
            override?.id === u.id ? (
              <Form key="o" className="flex flex-wrap items-end gap-1" onSubmit={() => run('ov', async () => { await put(`/admin/owners/${u.id}/commission-override`, { bps: override.pct === '' ? null : Math.round(Number(override.pct) * 100), reason: override.reason }); setOverride(null); await mutate(); })}>
                <input aria-label="Override percent (blank to clear)" className="w-16 rounded border border-line bg-surface px-1" value={override.pct} onChange={(e) => setOverride({ ...override, pct: e.target.value })} placeholder="%" />
                <input aria-label="Reason" required className="w-28 rounded border border-line bg-surface px-1" value={override.reason} onChange={(e) => setOverride({ ...override, reason: e.target.value })} placeholder="Reason" />
                <Button size="sm" type="submit" busy={busy === 'ov'}>
                  Save
                </Button>
              </Form>
            ) : (
              <button key="o" type="button" className="underline" onClick={() => setOverride({ id: u.id, pct: u.commissionOverrideBps === null ? '' : String(u.commissionOverrideBps / 100), reason: '' })}>
                {u.commissionOverrideBps === null ? 'Standard' : `Override ${pct(u.commissionOverrideBps)}`}
              </button>
            )
          ) : (
            '—'
          ),
          <span key="s" className="flex flex-col gap-1">
            <StatusBadge status={u.status} />
            <Button size="sm" variant="ghost" onClick={() => run(`s-${u.id}`, async () => { await post(`/admin/users/${u.id}/${u.status === 'ACTIVE' ? 'suspend' : 'reactivate'}`); await mutate(); })}>
              {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
            </Button>
          </span>,
        ])}
      />
    </div>
  );
}

export default function StaffPage() {
  const [tab, setTab] = useState<'staff' | 'users'>('staff');
  return (
    <>
      <PageHeader title="Staff and users" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'staff', label: 'Admin staff' }, { id: 'users', label: 'Owners and guests' }]} />
      {tab === 'staff' ? <StaffTab /> : <UsersTab />}
    </>
  );
}
