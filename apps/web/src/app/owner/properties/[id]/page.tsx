'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { modeIncludesCare, modeIncludesList, PROPERTY_DOCUMENT_TYPES, SERVICE_MODES, statusLabel, type ServiceMode } from '@propcare/shared';
import { FileUploader, SuccessNote } from '@/components/shared';
import { Alert, Button, Card, Checkbox, Empty, ErrorAlert, Form, KeyValue, LinkButton, Loading, PageHeader, SelectField, StatusBadge, Tabs, TextField } from '@/components/ui';
import { del, patch, post, useApi } from '@/lib/api';
import { ago, dateLabel } from '@/lib/format';
import { useAction } from '@/lib/use-action';

interface Property {
  id: string;
  nickname: string;
  propertyType: string;
  addressLine1: string;
  addressLine2: string | null;
  locality: string;
  city: string;
  district: string;
  state: string;
  pinCode: string;
  areaSqft: number | null;
  serviceMode: ServiceMode;
  status: string;
  verificationStatus: string;
  hasAccessNotes: boolean;
  listing: { id: string; status: string; reference: string } | null;
  contacts: Array<{ id: string; name: string; phone: string; relationship: string; accessRole: string | null }>;
  createdAt: string;
}

interface Verification {
  owner: { status: string; latest: VerificationRecord | null };
  property: { status: string; latest: VerificationRecord | null };
}
interface VerificationRecord {
  status: string;
  submittedAt: string | null;
  reason: string | null;
  documents: Array<{ docType: string; receivedAt: string }>;
}

type Tab = 'overview' | 'verification' | 'stays' | 'care';

function Contacts({ p, onChange }: { p: Property; onChange: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', relationship: '', consent: false });
  const { busy, error, run } = useAction();
  return (
    <Card title="Local contacts">
      <p className="mb-3 text-sm text-muted">People our team can call to arrange access, such as a caretaker or neighbour.</p>
      {p.contacts.length > 0 && (
        <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
          {p.contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{c.name}</span> · {c.relationship} · {c.phone}
              </span>
              <Button size="sm" variant="ghost" onClick={() => run(`del-${c.id}`, async () => { await del(`/properties/${p.id}/contacts/${c.id}`); onChange(); })} busy={busy === `del-${c.id}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={() =>
          run('add', async () => {
            await post(`/properties/${p.id}/contacts`, { name: f.name, phone: f.phone, relationship: f.relationship, consentConfirmed: f.consent });
            setF({ name: '', phone: '', relationship: '', consent: false });
            onChange();
          })
        }
      >
        <TextField label="Name" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <TextField label="Mobile" required type="tel" autoComplete="off" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} pattern="(\+91)?[\s\-]?[6-9][0-9\s\-]{9,12}" invalidMessage="Enter an Indian mobile number." />
        <TextField label="Relationship" required maxLength={60} value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} placeholder="Caretaker" />
        <div className="sm:col-span-3">
          <Checkbox required label="This person has agreed to be contacted about the property." checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
        </div>
        <div className="sm:col-span-3">
          <ErrorAlert error={error} />
          <Button type="submit" variant="secondary" busy={busy === 'add'}>
            Add contact
          </Button>
        </div>
      </Form>
    </Card>
  );
}

function Overview({ p, onChange }: { p: Property; onChange: () => void }) {
  const [mode, setMode] = useState<string>(p.serviceMode);
  const { busy, error, run } = useAction();
  return (
    <div className="space-y-6">
      <Card title="Details">
        <KeyValue
          items={[
            ['Type', statusLabel(p.propertyType)],
            ['Area', p.areaSqft ? `${p.areaSqft} sq ft` : null],
            ['Address', `${p.addressLine1}${p.addressLine2 ? `, ${p.addressLine2}` : ''}, ${p.locality}`],
            ['City', `${p.city}, ${p.district}, ${p.state} ${p.pinCode}`],
            ['Access notes', p.hasAccessNotes ? 'Saved (encrypted)' : 'None'],
          ]}
        />
        <Form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={() => run('mode', async () => { await patch(`/properties/${p.id}`, { serviceMode: mode }); onChange(); })}>
          <SelectField label="Service" value={mode} onChange={(e) => setMode(e.target.value)} options={SERVICE_MODES.map((m) => ({ value: m, label: m === 'CARE' ? 'Care only' : m === 'LIST' ? 'List for stays' : 'List and care' }))} />
          <Button type="submit" variant="secondary" busy={busy === 'mode'} disabled={mode === p.serviceMode}>
            Change
          </Button>
        </Form>
        <ErrorAlert error={error} />
      </Card>
      <Contacts p={p} onChange={onChange} />
    </div>
  );
}

function VerificationTab({ p }: { p: Property }) {
  const { data, mutate } = useApi<Verification>(`/properties/${p.id}/verification`);
  const [idDoc, setIdDoc] = useState<Array<{ id: string }>>([]);
  const [propDoc, setPropDoc] = useState<Array<{ id: string }>>([]);
  const [docType, setDocType] = useState<string>('PROPERTY_TAX_RECEIPT');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  if (!data) return <Loading />;
  const needsOwner = data.owner.status !== 'APPROVED' && data.owner.status !== 'PENDING';
  const canSubmit = data.property.status !== 'APPROVED' && data.property.status !== 'PENDING';
  return (
    <div className="space-y-4">
      <Card title="Status">
        <KeyValue
          items={[
            ['Your identity', <StatusBadge key="o" status={data.owner.status} />],
            ['This property', <StatusBadge key="p" status={data.property.status} />],
          ]}
        />
        {data.property.latest?.reason && (
          <div className="mt-3">
            <Alert tone="warn" title="Our team asked for changes">
              {data.property.latest.reason}
            </Alert>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">Documents are stored privately, seen only by our verification team, and never shown to guests.</p>
      </Card>
      {canSubmit && (
        <Card title="Submit documents">
          <Form
            className="space-y-4"
            onSubmit={() =>
              run('submit', async () => {
                await post(`/properties/${p.id}/verification`, {
                  ownerDocuments: idDoc.map((d) => ({ docType: 'GOVERNMENT_ID', attachmentId: d.id })),
                  propertyDocuments: propDoc.map((d) => ({ docType, attachmentId: d.id })),
                });
                setSent(true);
                await mutate();
              })
            }
          >
            {needsOwner && (
              <div>
                <p className="mb-1 text-sm font-medium">Government ID</p>
                <FileUploader ownerType="VERIFICATION" max={1} accept="image/jpeg,image/png,application/pdf" onChange={setIdDoc} label="Upload ID" compact />
              </div>
            )}
            <SelectField label="Proof of ownership or authority" value={docType} onChange={(e) => setDocType(e.target.value)} options={PROPERTY_DOCUMENT_TYPES.map((t) => ({ value: t, label: statusLabel(t) }))} />
            <FileUploader ownerType="VERIFICATION" max={3} accept="image/jpeg,image/png,application/pdf" onChange={setPropDoc} label="Upload document" compact />
            <SuccessNote show={sent}>Submitted. We usually review within two working days.</SuccessNote>
            <ErrorAlert error={error} />
            <Button type="submit" busy={busy === 'submit'} disabled={!propDoc.length || (needsOwner && !idDoc.length)}>
              Submit for verification
            </Button>
          </Form>
        </Card>
      )}
    </div>
  );
}

function StaysTab({ p }: { p: Property }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  if (!modeIncludesList(p.serviceMode)) return <Empty title="This property is set to care only">Change the service on the Overview tab to list it for stays.</Empty>;
  if (!p.listing)
    return (
      <Empty
        title="Create your listing"
        action={
          <>
            <Button busy={busy === 'create'} onClick={() => run('create', async () => { const l = await post<{ id: string }>(`/properties/${p.id}/listing`, {}, true); router.push(`/owner/properties/${p.id}/listing?listing=${l.id}`); })}>
              Start listing
            </Button>
            <ErrorAlert error={error} />
          </>
        }
      >
        Photos, description, price and house rules. Our team reviews every listing before it goes live.
      </Empty>
    );
  return (
    <Card title={`Listing ${p.listing.reference}`} actions={<StatusBadge status={p.listing.status} />}>
      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/owner/properties/${p.id}/listing`}>Edit listing and calendar</LinkButton>
        {p.listing.status === 'PUBLISHED' && (
          <LinkButton variant="secondary" href={`/stays/${p.listing.id}`}>
            View public page
          </LinkButton>
        )}
        <LinkButton variant="ghost" href={`/owner/earnings?listing=${p.listing.id}`}>
          Earnings
        </LinkButton>
      </div>
    </Card>
  );
}

function CareTab({ p }: { p: Property }) {
  const { data } = useApi<{ items: Array<{ id: string; reference: string; title: string; status: string; urgency: string; submittedAt: string }> }>(`/service-requests?propertyId=${p.id}&limit=50`);
  if (!modeIncludesCare(p.serviceMode)) return <Empty title="Care is off for this property">Change the service on the Overview tab to request maintenance.</Empty>;
  return (
    <Card title="Service requests" actions={<LinkButton size="sm" href={`/owner/requests/new?propertyId=${p.id}`}>New request</LinkButton>} padded={false}>
      {data?.items.length === 0 && <p className="p-4 text-sm text-muted">No requests for this property yet.</p>}
      <ul className="divide-y divide-line">
        {data?.items.map((r) => (
          <li key={r.id}>
            <Link href={`/owner/requests/${r.id}`} className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
              <div>
                <p className="font-medium">{r.title}</p>
                <p className="text-sm text-muted">
                  {r.reference} · {ago(r.submittedAt)}
                  {r.urgency !== 'STANDARD' && ` · ${statusLabel(r.urgency)}`}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PropertyView() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const { data: p, error, isLoading, mutate } = useApi<Property>(`/properties/${id}`);
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) ?? 'overview');
  if (isLoading) return <Loading />;
  if (error || !p) return <ErrorAlert error={error ?? new Error('Property not found.')} />;
  return (
    <>
      <PageHeader
        title={p.nickname}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {p.locality}, {p.city} · added {dateLabel(p.createdAt)} <StatusBadge status={p.verificationStatus} label={`Verification: ${statusLabel(p.verificationStatus).toLowerCase()}`} />
          </span>
        }
        back={{ href: '/owner', label: 'Dashboard' }}
      />
      {sp.get('created') && (
        <div className="mb-4">
          <Alert tone="ok" title="Property added">
            {modeIncludesList(p.serviceMode) ? 'Next: verify ownership and create your listing.' : 'You can now raise service requests for this property.'}
          </Alert>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'verification', label: 'Verification' },
          { id: 'stays', label: 'Stays' },
          { id: 'care', label: 'Care' },
        ]}
      />
      {tab === 'overview' && <Overview p={p} onChange={() => mutate()} />}
      {tab === 'verification' && <VerificationTab p={p} />}
      {tab === 'stays' && <StaysTab p={p} />}
      {tab === 'care' && <CareTab p={p} />}
    </>
  );
}

export default function PropertyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PropertyView />
    </Suspense>
  );
}
