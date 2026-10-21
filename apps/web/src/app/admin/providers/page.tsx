'use client';
import { useState } from 'react';
import { PROVIDER_STATUSES, PROVIDER_TYPES, PROVIDER_VERIFICATION_STATUSES, statusLabel } from '@propcare/shared';
import { Button, Card, Checkbox, ErrorAlert, Form, Loading, Modal, PageHeader, SelectField, StatusBadge, Table, TextArea, TextField } from '@/components/ui';
import { patch, post, useApi } from '@/lib/api';
import { useAction } from '@/lib/use-action';

interface Provider {
  id: string;
  name: string;
  providerType: string;
  contactName: string | null;
  phone: string;
  phoneMasked: string;
  status: string;
  verificationStatus: string;
  availabilityNotes: string | null;
  internalNotes: string | null;
  internalRating: number | null;
  skillCategoryIds: string[];
  serviceAreaIds: string[];
}

const empty = { name: '', providerType: 'INDIVIDUAL', contactName: '', phone: '', status: 'ACTIVE', verificationStatus: 'PENDING', availabilityNotes: '', internalNotes: '', internalRating: '', skillCategoryIds: [] as string[], serviceAreaIds: [] as string[] };

export default function Providers() {
  const [q, setQ] = useState('');
  const { data, error, isLoading, mutate } = useApi<{ items: Provider[] }>(`/admin/providers?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const cats = useApi<{ items: Array<{ id: string; name: string }> }>('/admin/service-categories');
  const areas = useApi<{ items: Array<{ id: string; name: string }> }>('/admin/service-areas');
  const [editing, setEditing] = useState<string | null>(null);
  const [f, setF] = useState(empty);
  const [csv, setCsv] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const { busy, error: actError, run } = useAction();
  const open = (p?: Provider) => {
    setEditing(p?.id ?? 'new');
    setF(p ? { ...empty, ...p, contactName: p.contactName ?? '', availabilityNotes: p.availabilityNotes ?? '', internalNotes: p.internalNotes ?? '', internalRating: p.internalRating ? String(p.internalRating) : '' } : empty);
  };
  const toggle = (k: 'skillCategoryIds' | 'serviceAreaIds', id: string, on: boolean) => setF((s) => ({ ...s, [k]: on ? [...s[k], id] : s[k].filter((x) => x !== id) }));
  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="Never shown to owners or guests. Phone numbers are visible to admins only."
        actions={
          <>
            <Button onClick={() => open()}>Add provider</Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
          </>
        }
      />
      <div className="mb-4 max-w-sm">
        <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data && (
        <Table
          head={['Name', 'Type', 'Phone', 'Skills', 'Rating', 'Status', '']}
          empty="No providers yet"
          rows={data.items.map((p) => [
            <span key="n" className="font-medium">
              {p.name}
              {p.contactName && <span className="block text-xs font-normal text-muted">{p.contactName}</span>}
            </span>,
            statusLabel(p.providerType),
            p.phone,
            p.skillCategoryIds.map((id) => cats.data?.items.find((c) => c.id === id)?.name).filter(Boolean).join(', ') || '—',
            p.internalRating ? `★${p.internalRating}` : '—',
            <span key="s" className="flex flex-col gap-1">
              <StatusBadge status={p.status} />
              <StatusBadge status={p.verificationStatus} label={`Verification: ${statusLabel(p.verificationStatus).toLowerCase()}`} />
            </span>,
            <Button key="e" size="sm" variant="ghost" onClick={() => open(p)}>
              Edit
            </Button>,
          ])}
        />
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add provider' : 'Edit provider'} wide>
        <Form
          className="space-y-4"
          onSubmit={() =>
            run('save', async () => {
              const body = { ...f, contactName: f.contactName || null, availabilityNotes: f.availabilityNotes || null, internalNotes: f.internalNotes || null, internalRating: f.internalRating ? Number(f.internalRating) : null };
              if (editing === 'new') await post('/admin/providers', body);
              else await patch(`/admin/providers/${editing}`, body);
              setEditing(null);
              await mutate();
            })
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Name" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <SelectField label="Type" value={f.providerType} onChange={(e) => setF({ ...f, providerType: e.target.value })} options={PROVIDER_TYPES.map((t) => ({ value: t, label: statusLabel(t) }))} />
            <TextField label="Contact person" maxLength={120} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
            <TextField label="Mobile" required type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <SelectField label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={PROVIDER_STATUSES.map((t) => ({ value: t, label: statusLabel(t) }))} />
            <SelectField label="Verification" value={f.verificationStatus} onChange={(e) => setF({ ...f, verificationStatus: e.target.value })} options={PROVIDER_VERIFICATION_STATUSES.map((t) => ({ value: t, label: statusLabel(t) }))} />
            <SelectField label="Internal rating" value={f.internalRating} placeholder="Unrated" onChange={(e) => setF({ ...f, internalRating: e.target.value })} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `★${n}` }))} />
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Skills</legend>
            <div className="grid gap-1 sm:grid-cols-3">
              {cats.data?.items.map((c) => <Checkbox key={c.id} label={c.name} checked={f.skillCategoryIds.includes(c.id)} onChange={(e) => toggle('skillCategoryIds', c.id, e.target.checked)} />)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Service areas</legend>
            <div className="grid gap-1 sm:grid-cols-3">
              {areas.data?.items.map((a) => <Checkbox key={a.id} label={a.name} checked={f.serviceAreaIds.includes(a.id)} onChange={(e) => toggle('serviceAreaIds', a.id, e.target.checked)} />)}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextArea label="Availability" rows={2} value={f.availabilityNotes} onChange={(e) => setF({ ...f, availabilityNotes: e.target.value })} />
            <TextArea label="Internal notes" rows={2} value={f.internalNotes} onChange={(e) => setF({ ...f, internalNotes: e.target.value })} />
          </div>
          <ErrorAlert error={actError} />
          <Button type="submit" busy={busy === 'save'}>
            Save
          </Button>
        </Form>
      </Modal>
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import providers" wide>
        <Card>
          <p className="mb-2 text-sm text-muted">Columns: name, providerType, contactName, phone, skills (category slugs separated by |), areas (area names separated by |).</p>
          <TextArea label="CSV" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <ErrorAlert error={actError} />
          <Button className="mt-2" busy={busy === 'import'} onClick={() => run('import', async () => { await post('/admin/providers/import', { csv }); setImportOpen(false); await mutate(); })}>
            Import
          </Button>
        </Card>
      </Modal>
    </>
  );
}
