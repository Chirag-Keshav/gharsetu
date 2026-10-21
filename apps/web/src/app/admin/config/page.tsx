'use client';
import { useState } from 'react';
import { Button, Card, Checkbox, ErrorAlert, Form, Loading, Modal, PageHeader, StatusBadge, Table, Tabs, TextArea, TextField } from '@/components/ui';
import { patch, post, put, useApi } from '@/lib/api';
import { pct } from '@/lib/format';
import { useAction } from '@/lib/use-action';

interface Category {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
  inspectionUsuallyRequired: boolean;
  intakeSchema: { fields: unknown[]; dangerRules?: unknown[] };
  serviceAreaIds: string[];
  checklist: { version: number; items: unknown } | null;
}
interface Area {
  id: string;
  name: string;
  state: string;
  district: string;
  pinCodes: string[];
  isActive: boolean;
  offersStays: boolean;
}

function Categories() {
  const { data, mutate } = useApi<{ items: Category[] }>('/admin/service-categories');
  const [json, setJson] = useState<{ id: string; text: string; kind: 'intake' | 'checklist' } | null>(null);
  const { busy, error, run } = useAction();
  if (!data) return <Loading />;
  return (
    <>
      <ErrorAlert error={error} />
      <Table
        head={['Category', 'Intake', 'Checklist', 'Areas', 'Active', '']}
        rows={data.items.map((c) => [
          <span key="n" className="font-medium">
            {c.name}
            <span className="block text-xs font-normal text-muted">{c.slug}{c.inspectionUsuallyRequired && ' · inspection usually needed'}</span>
          </span>,
          `${c.intakeSchema.fields.length} fields · ${c.intakeSchema.dangerRules?.length ?? 0} danger rules`,
          c.checklist ? `v${c.checklist.version}` : '—',
          c.serviceAreaIds.length,
          <Checkbox key="a" label={c.isActive ? 'On' : 'Off'} checked={c.isActive} onChange={(e) => run(c.id, async () => { await patch(`/admin/service-categories/${c.id}`, { isActive: e.target.checked }); await mutate(); })} />,
          <span key="x" className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setJson({ id: c.id, kind: 'intake', text: JSON.stringify(c.intakeSchema, null, 2) })}>
              Intake
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setJson({ id: c.id, kind: 'checklist', text: JSON.stringify(c.checklist?.items ?? { items: [] }, null, 2) })}>
              Checklist
            </Button>
          </span>,
        ])}
      />
      <Modal open={!!json} onClose={() => setJson(null)} title={json?.kind === 'intake' ? 'Intake schema' : 'Checklist template (saving creates a new version)'} wide>
        {json && (
          <Form
            className="space-y-3"
            onSubmit={() =>
              run('json', async () => {
                const value = JSON.parse(json.text);
                if (json.kind === 'intake') await patch(`/admin/service-categories/${json.id}`, { intakeSchema: value });
                else await put(`/admin/service-categories/${json.id}/checklist-template`, value);
                setJson(null);
                await mutate();
              })
            }
          >
            <TextArea label="JSON" rows={18} className="font-mono" value={json.text} onChange={(e) => setJson({ ...json, text: e.target.value })} />
            <ErrorAlert error={error} />
            <Button type="submit" busy={busy === 'json'}>
              Validate and save
            </Button>
          </Form>
        )}
      </Modal>
    </>
  );
}

function Areas() {
  const { data, mutate } = useApi<{ items: Area[] }>('/admin/service-areas');
  const [f, setF] = useState({ name: '', state: '', district: '', pins: '', offersStays: false });
  const { busy, error, run } = useAction();
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <Table
        head={['Area', 'PIN codes', 'Stays', 'Active']}
        rows={data.items.map((a) => [
          <span key="n" className="font-medium">
            {a.name}
            <span className="block text-xs font-normal text-muted">
              {a.district}, {a.state}
            </span>
          </span>,
          <span key="p" className="block max-w-[320px] truncate text-xs">{a.pinCodes.join(', ')}</span>,
          <Checkbox key="s" label={a.offersStays ? 'Yes' : 'No'} checked={a.offersStays} onChange={(e) => run(a.id, async () => { await patch(`/admin/service-areas/${a.id}`, { offersStays: e.target.checked }); await mutate(); })} />,
          <Checkbox key="a" label={a.isActive ? 'On' : 'Off'} checked={a.isActive} onChange={(e) => run(a.id, async () => { await patch(`/admin/service-areas/${a.id}`, { isActive: e.target.checked }); await mutate(); })} />,
        ])}
      />
      <Card title="Add area">
        <Form className="grid gap-3 sm:grid-cols-3" onSubmit={() => run('add', async () => { await post('/admin/service-areas', { name: f.name, state: f.state, district: f.district, pinCodes: f.pins.split(/[\s,]+/).filter(Boolean), isActive: true, offersStays: f.offersStays }); setF({ name: '', state: '', district: '', pins: '', offersStays: false }); await mutate(); })}>
          <TextField label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="District" required value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} />
          <TextField label="State" required value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
          <TextArea className="sm:col-span-3" label="PIN codes (comma or space separated)" required rows={2} value={f.pins} onChange={(e) => setF({ ...f, pins: e.target.value })} />
          <Checkbox label="Stays offered here" checked={f.offersStays} onChange={(e) => setF({ ...f, offersStays: e.target.checked })} />
          <div className="sm:col-span-3">
            <ErrorAlert error={error} />
            <Button type="submit" variant="secondary" busy={busy === 'add'}>
              Add area
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}

function Amenities() {
  const { data, mutate } = useApi<{ items: Array<{ id: string; slug: string; name: string; group: string; isActive?: boolean }> }>('/admin/amenities');
  const [f, setF] = useState({ slug: '', name: '', group: '' });
  const { busy, error, run } = useAction();
  return (
    <div className="space-y-4">
      <Table head={['Amenity', 'Group', 'Slug']} rows={(data?.items ?? []).map((a) => [a.name, a.group, a.slug])} />
      <Card title="Add amenity">
        <Form className="grid gap-3 sm:grid-cols-3" onSubmit={() => run('add', async () => { await post('/admin/amenities', { ...f, isActive: true }); setF({ slug: '', name: '', group: '' }); await mutate(); })}>
          <TextField label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} />
          <TextField label="Group" required value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} placeholder="Essentials" />
          <TextField label="Slug" required pattern="[a-z0-9\-]{2,60}" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
          <div className="sm:col-span-3">
            <ErrorAlert error={error} />
            <Button type="submit" variant="secondary" busy={busy === 'add'}>
              Add
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}

function Policies() {
  const { data } = useApi<{ items: Array<{ key: string; name: string; description: string | null; rules: Array<{ hoursBeforeCheckInAtLeast: number; refundBps: number }>; isActive?: boolean }> }>('/admin/cancellation-policies');
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {data?.items.map((p) => (
        <Card key={p.key} title={p.name} actions={<StatusBadge status="PENDING" label="Unconfirmed" />}>
          <p className="text-sm text-muted">{p.description}</p>
          <ul className="mt-2 text-sm">
            {[...p.rules].sort((a, b) => b.hoursBeforeCheckInAtLeast - a.hoursBeforeCheckInAtLeast).map((r) => (
              <li key={r.hoursBeforeCheckInAtLeast}>
                ≥ {r.hoursBeforeCheckInAtLeast}h before check-in: {pct(r.refundBps)} refund
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export default function Config() {
  const [tab, setTab] = useState<'categories' | 'areas' | 'amenities' | 'policies'>('categories');
  return (
    <>
      <PageHeader title="Catalogue" subtitle="Changes are audited. Category intake and checklists are validated on save." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'categories', label: 'Service categories' }, { id: 'areas', label: 'Service areas' }, { id: 'amenities', label: 'Amenities' }, { id: 'policies', label: 'Cancellation policies' }]} />
      {tab === 'categories' && <Categories />}
      {tab === 'areas' && <Areas />}
      {tab === 'amenities' && <Amenities />}
      {tab === 'policies' && <Policies />}
    </>
  );
}
