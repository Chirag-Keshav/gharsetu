'use client';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BOOKING_MODES, rupeesToPaise, statusLabel } from '@propcare/shared';
import { OwnerCalendar } from '@/components/owner-calendar';
import { AiPanel, FileUploader, MessageThread, SuccessNote } from '@/components/shared';
import { Alert, Button, Card, Checkbox, ErrorAlert, Form, Loading, PageHeader, SelectField, StatusBadge, Tabs, TextArea, TextField, cx } from '@/components/ui';
import { del, patch, post, put, useApi } from '@/lib/api';
import { inr, rupeesInput } from '@/lib/format';
import { useAction } from '@/lib/use-action';

interface OwnerListing {
  id: string;
  reference: string;
  propertyId: string;
  status: string;
  title: string;
  description: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  houseRules: { quietHours?: string | null; petsAllowed: boolean; smokingAllowed: boolean; eventsAllowed: boolean; additionalRules?: string | null };
  checkInTime: string;
  checkOutTime: string;
  basePricePaise: number;
  weekendPricePaise: number | null;
  cleaningFeePaise: number;
  minNights: number;
  maxNights: number;
  advanceNoticeHours: number;
  maxAdvanceDays: number;
  bookingMode: string;
  cancellationPolicyKey: string | null;
  turnoverCleaningEnabled: boolean;
  publicAreaLabel: string;
  checkinInstructions: string | null;
  amenityIds: string[];
  photos: Array<{ id: string; position: number; caption: string | null; isCover: boolean; previewUrl: string | null; isPublic: boolean }>;
  completeness: Array<{ item: string; ok: boolean }>;
  pausedBy: string | null;
  editedSinceReview: boolean;
}

const COMPLETENESS_LABELS: Record<string, string> = {
  title: 'A title of at least 5 characters',
  description: 'A description of at least 50 characters',
  photos: 'Enough photos',
  price: 'A nightly price',
  capacity: 'Guests and beds',
  rules: 'Check-in and check-out times and house rules',
  cancellationPolicy: 'A cancellation policy',
  location: 'An area label guests will see',
};

type Tab = 'details' | 'photos' | 'calendar' | 'review';

function Details({ l, onSaved }: { l: OwnerListing; onSaved: () => void }) {
  const policies = useApi<{ items: Array<{ key: string; name: string; description: string | null }> }>('/cancellation-policies');
  const amenities = useApi<{ items: Array<{ id: string; name: string; group: string }> }>('/amenities');
  const [f, setF] = useState(() => ({
    title: l.title,
    description: l.description,
    publicAreaLabel: l.publicAreaLabel,
    maxGuests: String(l.maxGuests),
    bedrooms: String(l.bedrooms),
    beds: String(l.beds),
    bathrooms: String(l.bathrooms),
    checkInTime: l.checkInTime,
    checkOutTime: l.checkOutTime,
    base: rupeesInput(l.basePricePaise),
    weekend: rupeesInput(l.weekendPricePaise),
    cleaning: rupeesInput(l.cleaningFeePaise),
    minNights: String(l.minNights),
    maxNights: String(l.maxNights),
    advanceNoticeHours: String(l.advanceNoticeHours),
    bookingMode: l.bookingMode,
    cancellationPolicyKey: l.cancellationPolicyKey ?? '',
    turnoverCleaningEnabled: l.turnoverCleaningEnabled,
    checkinInstructions: l.checkinInstructions ?? '',
    ...l.houseRules,
    quietHours: l.houseRules.quietHours ?? '',
    additionalRules: l.houseRules.additionalRules ?? '',
  }));
  const [amenityIds, setAmenityIds] = useState<string[]>(l.amenityIds);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const groups = [...new Set(amenities.data?.items.map((a) => a.group) ?? [])];

  return (
    <Form
      className="space-y-6"
      onSubmit={() =>
        run('save', async () => {
          await patch(`/listings/${l.id}`, {
            title: f.title,
            description: f.description,
            publicAreaLabel: f.publicAreaLabel,
            maxGuests: Number(f.maxGuests),
            bedrooms: Number(f.bedrooms),
            beds: Number(f.beds),
            bathrooms: Number(f.bathrooms),
            checkInTime: f.checkInTime,
            checkOutTime: f.checkOutTime,
            basePricePaise: rupeesToPaise(f.base) ?? 0,
            weekendPricePaise: f.weekend ? rupeesToPaise(f.weekend) : null,
            cleaningFeePaise: rupeesToPaise(f.cleaning || '0') ?? 0,
            minNights: Number(f.minNights),
            maxNights: Number(f.maxNights),
            advanceNoticeHours: Number(f.advanceNoticeHours),
            bookingMode: f.bookingMode,
            ...(f.cancellationPolicyKey ? { cancellationPolicyKey: f.cancellationPolicyKey } : {}),
            turnoverCleaningEnabled: f.turnoverCleaningEnabled,
            checkinInstructions: f.checkinInstructions || null,
            houseRules: { quietHours: f.quietHours || null, petsAllowed: f.petsAllowed, smokingAllowed: f.smokingAllowed, eventsAllowed: f.eventsAllowed, additionalRules: f.additionalRules || null },
          });
          await put(`/listings/${l.id}/amenities`, { amenityIds });
          setSaved(true);
          onSaved();
        })
      }
    >
      <Card title="Title and description">
        <div className="space-y-3">
          <TextField label="Title" maxLength={120} value={f.title} onChange={set('title')} />
          <TextArea label="Description" maxLength={8000} rows={6} value={f.description} onChange={set('description')} hint={`${f.description.length} characters · do not include phone numbers, emails or the exact address.`} />
          <TextField label="Area shown to guests" maxLength={120} value={f.publicAreaLabel} onChange={set('publicAreaLabel')} hint="For example “Assagao, North Goa”. The exact address is shared only after booking." />
          <AiPanel<{ title: string; description: string; highlights: string[] }>
            feature="listing_writer"
            subjectType="LISTING"
            subjectId={l.id}
            title="Writing help"
            autoload={false}
            applyLabel="Use this text"
            onApply={(o) => setF((s) => ({ ...s, title: o.title, description: o.description }))}
          >
            {(o) => (
              <div className="space-y-2">
                <p className="font-medium">{o.title}</p>
                <p className="whitespace-pre-wrap">{o.description}</p>
                {o.highlights.length > 0 && <ul className="list-disc pl-5">{o.highlights.map((h) => <li key={h}>{h}</li>)}</ul>}
              </div>
            )}
          </AiPanel>
        </div>
      </Card>
      <Card title="Space">
        <div className="grid gap-3 sm:grid-cols-4">
          <TextField label="Max guests" type="number" min={1} max={50} required value={f.maxGuests} onChange={set('maxGuests')} />
          <TextField label="Bedrooms" type="number" min={0} max={50} required value={f.bedrooms} onChange={set('bedrooms')} />
          <TextField label="Beds" type="number" min={0} max={100} required value={f.beds} onChange={set('beds')} />
          <TextField label="Bathrooms" type="number" min={0} max={50} required value={f.bathrooms} onChange={set('bathrooms')} />
        </div>
      </Card>
      <Card title="Price">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Nightly price (₹)" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={f.base} onChange={set('base')} />
          <TextField label="Weekend price (₹, optional)" inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={f.weekend} onChange={set('weekend')} hint="Friday and Saturday nights" />
          <TextField label="Cleaning fee (₹)" inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={f.cleaning} onChange={set('cleaning')} />
        </div>
        <div className="mt-3">
          <AiPanel<{ minNightlyPaise: number; maxNightlyPaise: number; suggestedNightlyPaise: number; rationale: string }>
            feature="price_suggestion"
            subjectType="LISTING"
            subjectId={l.id}
            title="Price suggestion"
            autoload={false}
            applyLabel="Use suggested price"
            onApply={(o) => setF((s) => ({ ...s, base: rupeesInput(o.suggestedNightlyPaise) }))}
          >
            {(o) => (
              <div className="space-y-1">
                <p>
                  Suggested <strong>{inr(o.suggestedNightlyPaise)}</strong> a night (range {inr(o.minNightlyPaise)}–{inr(o.maxNightlyPaise)}).
                </p>
                <p className="text-muted">{o.rationale}</p>
              </div>
            )}
          </AiPanel>
        </div>
      </Card>
      <Card title="Booking rules">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="How guests book" value={f.bookingMode} onChange={set('bookingMode')} options={BOOKING_MODES.map((m) => ({ value: m, label: m === 'INSTANT' ? 'Instant booking' : 'I approve each request' }))} />
          <SelectField label="Cancellation policy" value={f.cancellationPolicyKey} onChange={set('cancellationPolicyKey')} placeholder="Choose…" options={(policies.data?.items ?? []).map((p) => ({ value: p.key, label: p.name }))} />
          <TextField label="Advance notice (hours)" type="number" min={0} max={720} value={f.advanceNoticeHours} onChange={set('advanceNoticeHours')} />
          <TextField label="Minimum nights" type="number" min={1} max={365} value={f.minNights} onChange={set('minNights')} />
          <TextField label="Maximum nights" type="number" min={1} max={365} value={f.maxNights} onChange={set('maxNights')} />
          <div />
          <TextField label="Check-in from" type="time" required value={f.checkInTime} onChange={set('checkInTime')} />
          <TextField label="Check-out by" type="time" required value={f.checkOutTime} onChange={set('checkOutTime')} />
          <TextField label="Quiet hours" maxLength={40} value={f.quietHours} onChange={set('quietHours')} placeholder="22:00–07:00" />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Checkbox label="Pets allowed" checked={f.petsAllowed} onChange={(e) => setF({ ...f, petsAllowed: e.target.checked })} />
          <Checkbox label="Smoking allowed" checked={f.smokingAllowed} onChange={(e) => setF({ ...f, smokingAllowed: e.target.checked })} />
          <Checkbox label="Events allowed" checked={f.eventsAllowed} onChange={(e) => setF({ ...f, eventsAllowed: e.target.checked })} />
          <Checkbox label="Book turnover cleaning after each stay" checked={f.turnoverCleaningEnabled} onChange={(e) => setF({ ...f, turnoverCleaningEnabled: e.target.checked })} />
        </div>
        <div className="mt-3">
          <TextArea label="Other house rules" rows={3} maxLength={3000} value={f.additionalRules} onChange={set('additionalRules')} />
        </div>
      </Card>
      <Card title="Amenities">
        {groups.map((g) => (
          <fieldset key={g} className="mb-3">
            <legend className="mb-1 text-sm font-medium">{g}</legend>
            <div className="grid gap-1 sm:grid-cols-3">
              {amenities.data?.items
                .filter((a) => a.group === g)
                .map((a) => (
                  <Checkbox key={a.id} label={a.name} checked={amenityIds.includes(a.id)} onChange={(e) => setAmenityIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))} />
                ))}
            </div>
          </fieldset>
        ))}
      </Card>
      <Card title="Check-in instructions">
        <TextArea label="How guests get in" rows={4} maxLength={3000} value={f.checkinInstructions} onChange={set('checkinInstructions')} hint="Shown to confirmed guests only, shortly before check-in." />
      </Card>
      <SuccessNote show={saved}>Saved.{l.status === 'PUBLISHED' ? ' Changes are live; our team may review them.' : ''}</SuccessNote>
      <ErrorAlert error={error} />
      <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <Button type="submit" busy={busy === 'save'}>
          Save changes
        </Button>
      </div>
    </Form>
  );
}

function Photos({ l, onChange }: { l: OwnerListing; onChange: () => void }) {
  const { busy, error, run } = useAction();
  const added = useRef(new Set<string>());
  return (
    <Card title="Photos">
      <p className="mb-3 text-sm text-muted">Location data is removed from every photo before it is published. The first photo, or the one you mark as cover, leads the listing.</p>
      <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {l.photos.map((p) => (
          <li key={p.id} className={cx('overflow-hidden rounded-lg border', p.isCover ? 'border-brand' : 'border-line')}>
            {p.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed private preview
              <img src={p.previewUrl} alt={p.caption ?? ''} width={240} height={160} loading="lazy" className="aspect-[3/2] w-full object-cover" />
            ) : (
              <div className="aspect-[3/2] bg-surface-2" />
            )}
            <div className="flex flex-wrap items-center gap-1 p-2 text-xs">
              {p.isCover ? <StatusBadge status="ACTIVE" label="Cover" /> : (
                <Button size="sm" variant="ghost" busy={busy === `cover-${p.id}`} onClick={() => run(`cover-${p.id}`, async () => { await patch(`/listings/${l.id}/photos/${p.id}`, { isCover: true }); onChange(); })}>
                  Make cover
                </Button>
              )}
              {!p.isPublic && <span className="text-muted">Processing…</span>}
              <Button size="sm" variant="ghost" busy={busy === `del-${p.id}`} onClick={() => run(`del-${p.id}`, async () => { await del(`/listings/${l.id}/photos/${p.id}`); onChange(); })}>
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <FileUploader
        ownerType="LISTING"
        ownerId={l.id}
        accept="image/jpeg,image/png,image/webp"
        max={20}
        label="Add photos"
        onChange={(files) => {
          // The uploader reports every finished file each time; attach each one once.
          const fresh = files.filter((f) => !added.current.has(f.id));
          if (!fresh.length) return;
          fresh.forEach((f) => added.current.add(f.id));
          void run('add', async () => {
            for (const file of fresh) await post(`/listings/${l.id}/photos`, { attachmentId: file.id });
            onChange();
          });
        }}
      />
      <ErrorAlert error={error} />
    </Card>
  );
}

export default function ListingEditor() {
  const { id: propertyId } = useParams<{ id: string }>();
  const property = useApi<{ nickname: string; listing: { id: string } | null; verificationStatus: string }>(`/properties/${propertyId}`);
  const listingId = property.data?.listing?.id;
  const { data: l, error, isLoading, mutate } = useApi<OwnerListing>(listingId ? `/listings/${listingId}` : null, { refreshInterval: (d) => (d?.photos.some((p) => !p.isPublic) ? 3000 : 0) });
  const [tab, setTab] = useState<Tab>('details');
  const act = useAction();
  useEffect(() => {
    if (l?.status === 'CHANGES_REQUESTED' || l?.status === 'REJECTED') setTab('review');
  }, [l?.status]);
  if (property.isLoading || isLoading) return <Loading />;
  if (property.error || error) return <ErrorAlert error={property.error ?? error} />;
  if (!l) return <Alert tone="info">This property has no listing yet. Start one from the property page.</Alert>;
  const missing = l.completeness.filter((c) => !c.ok);
  const canSubmit = ['DRAFT', 'CHANGES_REQUESTED'].includes(l.status);
  return (
    <>
      <PageHeader
        title={l.title || 'Untitled listing'}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {l.reference} · {property.data?.nickname} <StatusBadge status={l.status} />
          </span>
        }
        back={{ href: `/owner/properties/${propertyId}?tab=stays`, label: 'Property' }}
        actions={
          <>
            {canSubmit && (
              <Button busy={act.busy === 'submit'} disabled={missing.length > 0} onClick={() => act.run('submit', async () => { await post(`/listings/${l.id}/submit`); await mutate(); })}>
                Submit for review
              </Button>
            )}
            {l.status === 'PUBLISHED' && (
              <Button variant="secondary" busy={act.busy === 'pause'} onClick={() => act.run('pause', async () => { await post(`/listings/${l.id}/pause`); await mutate(); })}>
                Pause
              </Button>
            )}
            {l.status === 'PAUSED' && l.pausedBy !== 'ADMIN' && (
              <Button busy={act.busy === 'resume'} onClick={() => act.run('resume', async () => { await post(`/listings/${l.id}/resume`); await mutate(); })}>
                Resume
              </Button>
            )}
          </>
        }
      />
      <ErrorAlert error={act.error} />
      {canSubmit && missing.length > 0 && (
        <div className="mb-4">
          <Alert tone="warn" title="Before you can submit">
            <ul className="list-disc pl-5">
              {missing.map((m) => (
                <li key={m.item}>{COMPLETENESS_LABELS[m.item] ?? statusLabel(m.item)}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      {l.status === 'SUBMITTED' && (
        <div className="mb-4">
          <Alert tone="info">Our team is reviewing your listing. We will message you here if anything needs to change.</Alert>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'photos', label: `Photos (${l.photos.length})` },
          { id: 'calendar', label: 'Calendar and prices' },
          { id: 'review', label: 'Review messages' },
        ]}
      />
      {tab === 'details' && <Details key={l.id} l={l} onSaved={() => mutate()} />}
      {tab === 'photos' && <Photos l={l} onChange={() => mutate()} />}
      {tab === 'calendar' && <OwnerCalendar listingId={l.id} basePricePaise={l.basePricePaise} />}
      {tab === 'review' && <MessageThread path={`/listings/${l.id}/review-messages`} title="Messages from the review team" disabled="Update the listing and resubmit to reply." />}
    </>
  );
}
