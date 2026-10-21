'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { statusLabel } from '@propcare/shared';
import { AiPanel, MessageThread } from '@/components/shared';
import { Alert, Button, Card, ErrorAlert, KeyValue, Loading, Modal, PageHeader, StatusBadge, TextArea } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { inr } from '@/lib/format';
import { useAction } from '@/lib/use-action';

interface Workspace {
  preview: {
    title: string;
    description: string;
    publicAreaLabel: string;
    maxGuests: number;
    bedrooms: number;
    beds: number;
    bathrooms: number;
    basePricePaise: number;
    weekendPricePaise: number | null;
    cleaningFeePaise: number;
    bookingMode: string;
    houseRules: Record<string, unknown>;
    amenities: Array<{ name: string }>;
    photos: Array<{ id: string; variants: { sm: { url: string } } }>;
    cancellationPolicy: { name: string } | null;
  };
  listing: { id: string; reference: string; status: string; editedSinceReview: boolean; photos: Array<{ id: string; previewUrl: string | null; isPublic: boolean }>; checkinInstructions: string | null };
  owner: { id: string; name: string | null; verificationStatus: string };
  property: { id: string; nickname: string; city: string; state: string; pinCode: string; verificationStatus: string };
  comparables: Array<{ id: string; title: string; basePricePaise: number; maxGuests: number; bedrooms: number; ratingAvg: number | null }>;
  gate: string[];
}

interface ReviewOutput {
  overall: string;
  completeness: Array<{ item: string; status: string; note: string }>;
  qualityFindings: string[];
  policyFlags?: Array<{ type: string; detail?: string; evidence?: string }>;
  suggestedChangeRequests: string[];
}

export default function AdminListingWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { data: w, error, isLoading, mutate } = useApi<Workspace>(`/admin/listings/${id}`);
  const [dialog, setDialog] = useState<'request-changes' | 'reject' | 'pause' | null>(null);
  const [message, setMessage] = useState('');
  const { busy, error: actError, run } = useAction();
  if (isLoading) return <Loading />;
  if (error || !w) return <ErrorAlert error={error} />;
  const l = w.listing;
  const p = w.preview;
  const act = (path: string, body: unknown = {}) => run(path, async () => { await post(`/admin/listings/${l.id}/${path}`, body); setDialog(null); setMessage(''); await mutate(); });
  return (
    <>
      <PageHeader
        title={p.title || 'Untitled listing'}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {l.reference} · {w.property.nickname}, {w.property.city} <StatusBadge status={l.status} />
            {l.editedSinceReview && <StatusBadge status="PENDING" label="Edited since review" />}
          </span>
        }
        back={{ href: '/admin/listings', label: 'Listing review' }}
        actions={
          <>
            {(l.status === 'SUBMITTED' || l.status === 'CHANGES_REQUESTED') && (
              <>
                <Button busy={busy === 'publish'} disabled={w.gate.length > 0} onClick={() => act('publish')}>
                  Publish
                </Button>
                <Button variant="secondary" onClick={() => setDialog('request-changes')}>
                  Request changes
                </Button>
                <Button variant="ghost" onClick={() => setDialog('reject')}>
                  Reject
                </Button>
              </>
            )}
            {l.status === 'PUBLISHED' && (
              <>
                {l.editedSinceReview && (
                  <Button variant="secondary" busy={busy === 'mark-reviewed'} onClick={() => act('mark-reviewed')}>
                    Mark edits reviewed
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setDialog('pause')}>
                  Pause
                </Button>
              </>
            )}
            {l.status === 'PAUSED' && (
              <Button busy={busy === 'resume'} onClick={() => act('resume')}>
                Resume
              </Button>
            )}
          </>
        }
      />
      <ErrorAlert error={actError} />
      {w.gate.length > 0 && (
        <div className="mb-4">
          <Alert tone="warn" title="Cannot publish yet">
            <ul className="list-disc pl-5">
              {w.gate.map((g) => (
                <li key={g}>{statusLabel(g)}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card title="Guest preview">
            <div className="mb-3 grid grid-cols-3 gap-2">
              {l.photos.slice(0, 6).map((ph) => (
                // eslint-disable-next-line @next/next/no-img-element -- signed private preview
                <img key={ph.id} src={ph.previewUrl ?? ''} alt="" width={240} height={160} loading="lazy" className="aspect-[3/2] w-full rounded-md bg-surface-2 object-cover" />
              ))}
            </div>
            <p className="text-sm text-muted">{p.publicAreaLabel}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{p.description}</p>
            <div className="mt-4">
              <KeyValue
                columns={3}
                items={[
                  ['Guests', p.maxGuests],
                  ['Bedrooms / beds', `${p.bedrooms} / ${p.beds}`],
                  ['Bathrooms', p.bathrooms],
                  ['Nightly', inr(p.basePricePaise)],
                  ['Weekend', inr(p.weekendPricePaise)],
                  ['Cleaning', inr(p.cleaningFeePaise)],
                  ['Booking', statusLabel(p.bookingMode)],
                  ['Cancellation', p.cancellationPolicy?.name ?? '—'],
                  ['Amenities', p.amenities.map((a) => a.name).join(', ') || '—'],
                ]}
              />
            </div>
            {l.checkinInstructions && <p className="mt-3 rounded-md bg-surface-2 p-2 text-xs">Check-in instructions (private): {l.checkinInstructions}</p>}
          </Card>
          <MessageThread path={`/listings/${l.id}/review-messages`} title="Review conversation" disabled="Messages are sent with “Request changes”." />
        </div>
        <div className="space-y-4">
          <AiPanel<ReviewOutput> feature="listing_review" subjectType="LISTING" subjectId={l.id} title="Review assistant" applyLabel="Use as change request" onApply={(o) => { setMessage(o.suggestedChangeRequests.join('\n')); setDialog('request-changes'); }}>
            {(o) => (
              <div className="space-y-2">
                <p>
                  Overall: <StatusBadge status={o.overall === 'LOOKS_GOOD' ? 'APPROVED' : o.overall === 'CONCERNS' ? 'REJECTED' : 'PENDING'} label={statusLabel(o.overall)} />
                </p>
                {o.policyFlags && o.policyFlags.length > 0 && (
                  <ul className="list-disc pl-5 text-danger">{o.policyFlags.map((f, i) => <li key={i}>{statusLabel(f.type)}{f.detail ? `: ${f.detail}` : f.evidence ? `: ${f.evidence}` : ''}</li>)}</ul>
                )}
                {o.qualityFindings.length > 0 && <ul className="list-disc pl-5">{o.qualityFindings.map((q) => <li key={q}>{q}</li>)}</ul>}
                {o.suggestedChangeRequests.length > 0 && (
                  <div>
                    <p className="font-medium">Suggested change requests</p>
                    <ul className="list-disc pl-5">{o.suggestedChangeRequests.map((q) => <li key={q}>{q}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </AiPanel>
          <Card title="Owner and property">
            <KeyValue
              columns={1}
              items={[
                ['Owner', <span key="o" className="flex items-center gap-2">{w.owner.name ?? '—'} <StatusBadge status={w.owner.verificationStatus} /></span>],
                ['Property', <span key="p" className="flex items-center gap-2">{w.property.nickname} · {w.property.pinCode} <StatusBadge status={w.property.verificationStatus} /></span>],
              ]}
            />
          </Card>
          <Card title="Comparable listings">
            {w.comparables.length === 0 && <p className="text-sm text-muted">No comparables nearby.</p>}
            <ul className="space-y-1 text-sm">
              {w.comparables.map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span className="truncate">{c.title}</span>
                  <span className="shrink-0 text-muted">
                    {inr(c.basePricePaise)} · {c.maxGuests} guests
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === 'reject' ? 'Reject listing' : dialog === 'pause' ? 'Pause listing' : 'Request changes'}
        footer={
          <Button variant={dialog === 'reject' ? 'danger' : 'primary'} busy={busy === dialog} disabled={dialog !== 'pause' && message.trim().length < 1} onClick={() => dialog && act(dialog, dialog === 'pause' && !message ? {} : { message })}>
            {dialog === 'reject' ? 'Reject' : dialog === 'pause' ? 'Pause' : 'Send to owner'}
          </Button>
        }
      >
        <TextArea label="Message to the owner" rows={5} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} required={dialog !== 'pause'} />
      </Modal>
    </>
  );
}
