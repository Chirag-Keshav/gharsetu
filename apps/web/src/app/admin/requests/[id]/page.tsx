'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { allowedTargets, rupeesToPaise, serviceRequestMachine, statusLabel, type RequestStatus } from '@propcare/shared';
import { QuoteBuilder } from '@/components/quote-builder';
import { QuoteTable, type Quote } from '@/components/quote-view';
import { AiPanel, MessageThread, Timeline } from '@/components/shared';
import { Alert, Button, Card, ErrorAlert, Form, KeyValue, Loading, Modal, PageHeader, SelectField, StatusBadge, TextArea, TextField } from '@/components/ui';
import { openAttachment, patch, post, useApi } from '@/lib/api';
import { dateTimeLabel, fromLocalInput, inr } from '@/lib/format';
import { answerLabel, type RequestDetail } from '@/lib/request';
import { hasFlag, useMe } from '@/lib/session';
import { useAction } from '@/lib/use-action';

const NEEDS_OWNER_MESSAGE: string[] = ['NEEDS_INFORMATION', 'NOT_SERVICEABLE'];

function TransitionDialog({ r, onDone }: { r: RequestDetail; onDone: () => void }) {
  const targets = allowedTargets(serviceRequestMachine, r.status as RequestStatus, 'ADMIN').filter((t) => !['QUOTATION_SENT', 'QUOTATION_DRAFT', 'INSPECTION_SCHEDULED', 'WORK_ORDER_CREATED'].includes(t));
  const [to, setTo] = useState<string>('');
  const [reason, setReason] = useState('');
  const [ownerMessage, setOwnerMessage] = useState('');
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  if (!targets.length) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => { setTo(targets[0]); setOpen(true); }}>
        Change status
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Change status"
        footer={
          <Button busy={busy === 't'} onClick={() => run('t', async () => { await post(`/service-requests/${r.id}/status-transitions`, { to, reason: reason || null, ownerMessage: ownerMessage || null }); setOpen(false); onDone(); })}>
            Update
          </Button>
        }
      >
        <div className="space-y-3">
          <SelectField label="New status" value={to} onChange={(e) => setTo(e.target.value)} options={targets.map((t) => ({ value: t, label: statusLabel(t) }))} />
          <TextArea label="Internal reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          <TextArea label={`Message to the owner${NEEDS_OWNER_MESSAGE.includes(to) ? '' : ' (optional)'}`} required={NEEDS_OWNER_MESSAGE.includes(to)} rows={3} maxLength={5000} value={ownerMessage} onChange={(e) => setOwnerMessage(e.target.value)} />
          <ErrorAlert error={error} />
        </div>
      </Modal>
    </>
  );
}

function InspectionCard({ r, onDone }: { r: RequestDetail; onDone: () => void }) {
  const [f, setF] = useState({ start: '', end: '', fee: '' });
  const [findings, setFindings] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();
  return (
    <Card title="Inspection">
      {r.inspections.map((i) => (
        <div key={i.id} className="mb-3 rounded-lg border border-line p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            {dateTimeLabel(i.scheduledStart)} – {dateTimeLabel(i.scheduledEnd)} <StatusBadge status={i.status} />
          </p>
          <p className="text-muted">
            {i.providerName ?? 'No provider'} · fee {inr(i.feePaise)}
          </p>
          {i.findings && <p className="mt-1">{i.findings}</p>}
          {i.status === 'SCHEDULED' && (
            <div className="mt-2 space-y-2">
              <TextArea label="Findings" rows={2} value={findings[i.id] ?? ''} onChange={(e) => setFindings({ ...findings, [i.id]: e.target.value })} />
              <div className="flex gap-2">
                <Button size="sm" busy={busy === `c-${i.id}`} onClick={() => run(`c-${i.id}`, async () => { await patch(`/inspections/${i.id}`, { status: 'COMPLETED', findings: findings[i.id] || null }); onDone(); })}>
                  Mark completed
                </Button>
                <Button size="sm" variant="ghost" busy={busy === `n-${i.id}`} onClick={() => run(`n-${i.id}`, async () => { await patch(`/inspections/${i.id}`, { status: 'NO_ACCESS', findings: findings[i.id] || null }); onDone(); })}>
                  No access
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      {r.status === 'UNDER_REVIEW' && (
        <Form className="grid gap-3 sm:grid-cols-3" onSubmit={() => run('schedule', async () => { await post(`/service-requests/${r.id}/inspections`, { scheduledStart: fromLocalInput(f.start), scheduledEnd: fromLocalInput(f.end), feePaise: rupeesToPaise(f.fee || '0') ?? 0 }); onDone(); })}>
          <TextField label="Start" type="datetime-local" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          <TextField label="End" type="datetime-local" required min={f.start} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
          <TextField label="Fee (₹)" inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} />
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary" busy={busy === 'schedule'}>
              Schedule inspection
            </Button>
          </div>
        </Form>
      )}
      <ErrorAlert error={error} />
    </Card>
  );
}

export default function AdminRequestWorkspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me } = useMe();
  const { data: r, error, isLoading, mutate } = useApi<RequestDetail>(`/service-requests/${id}`);
  const quotes = useApi<{ items: Quote[] }>(`/service-requests/${id}/quotes`);
  const act = useAction();
  if (isLoading) return <Loading />;
  if (error || !r) return <ErrorAlert error={error} />;
  const refresh = () => {
    void mutate();
    void quotes.mutate();
  };
  const finance = hasFlag(me, 'FINANCE');
  const draft = quotes.data?.items.find((q) => q.status === 'DRAFT' && q.quoteType !== 'CHANGE_ORDER') ?? null;
  const sent = quotes.data?.items.find((q) => q.status === 'SENT');
  const approved = quotes.data?.items.find((q) => q.status === 'APPROVED' && q.quoteType !== 'CHANGE_ORDER');
  const canQuote = ['UNDER_REVIEW', 'QUOTATION_DRAFT'].includes(r.status);
  const mine = r.handledByAdminId === me?.user.id;
  return (
    <>
      <PageHeader
        title={r.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {r.reference} · {r.category} · submitted {dateTimeLabel(r.submittedAt)} <StatusBadge status={r.status} />
            {r.urgency !== 'STANDARD' && <StatusBadge status={r.urgency} />}
          </span>
        }
        back={{ href: '/admin/requests', label: 'Requests' }}
        actions={
          <>
            {!mine && (
              <Button variant="secondary" busy={act.busy === 'claim'} onClick={() => act.run('claim', async () => { await post(`/service-requests/${r.id}/claim`); refresh(); })}>
                {r.handledByAdminId ? 'Take over' : 'Claim'}
              </Button>
            )}
            <TransitionDialog r={r} onDone={refresh} />
            {approved && r.status === 'APPROVED' && (
              <Button busy={act.busy === 'wo'} onClick={() => act.run('wo', async () => { const w = await post<{ id: string }>('/work-orders', { quoteId: approved.id }, true); router.push(`/admin/work-orders/${w.id}`); })}>
                Create work order
              </Button>
            )}
          </>
        }
      />
      <ErrorAlert error={act.error} />
      {r.safetyFlag && (
        <div className="mb-4">
          <Alert tone="danger" title="Safety risk">
            {r.safetyGuidance.map((g) => g.text ?? g.key).join(' ')}
          </Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card title="Request">
            <p className="whitespace-pre-wrap text-sm">{r.description}</p>
            <div className="mt-3">
              <KeyValue items={Object.entries(r.intakeAnswers).map(([k, v]) => [r.intakeSchema.fields.find((f) => f.key === k)?.label ?? k, answerLabel(r, k, v)])} />
            </div>
            {r.preferredWindows.length > 0 && (
              <p className="mt-3 text-sm">
                Preferred: {r.preferredWindows.map((w) => `${dateTimeLabel(w.start)} – ${dateTimeLabel(w.end)}`).join('; ')}
              </p>
            )}
            {r.attachments.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {r.attachments.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => openAttachment(a.id)} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2">
                      📎 {a.filename}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {sent && (
            <Card title={`Sent ${sent.reference} v${sent.version}`} actions={<Button size="sm" variant="ghost" onClick={() => act.run('withdraw', async () => { await post(`/quotes/${sent.id}/withdraw`, { reason: null }); refresh(); })}>Withdraw</Button>}>
              <QuoteTable q={sent} />
              {finance && sent.marginPaise !== undefined && <p className="mt-2 text-xs text-muted">Internal cost {inr(sent.internalCostPaise)} · margin {inr(sent.marginPaise)}</p>}
            </Card>
          )}
          {approved && (
            <Card title={`Approved ${approved.reference} v${approved.version}`} actions={<StatusBadge status="APPROVED" />}>
              <QuoteTable q={approved} />
            </Card>
          )}
          {canQuote && quotes.data && <QuoteBuilder key={draft?.id ?? 'new'} requestId={r.id} draft={draft} finance={finance} onSaved={refresh} />}
          {(r.status === 'UNDER_REVIEW' || r.inspections.length > 0) && <InspectionCard r={r} onDone={refresh} />}
          <MessageThread path={`/service-requests/${r.id}/messages`} title="Messages" allowInternal attachOwnerType="MESSAGE" />
        </div>
        <div className="space-y-4">
          <AiPanel<{ summary: string; suggestedCategorySlug: string | null; suggestedUrgency: string; inspectionNeeded: boolean; missingInformation: string[] }> feature="request_triage" subjectType="SERVICE_REQUEST" subjectId={r.id} title="Triage">
            {(o) => (
              <div className="space-y-1">
                <p>{o.summary}</p>
                <p className="text-muted">
                  Urgency {statusLabel(o.suggestedUrgency)} · {o.inspectionNeeded ? 'inspection recommended' : 'no inspection needed'}
                  {o.suggestedCategorySlug && o.suggestedCategorySlug !== r.categorySlug && ` · category may be ${o.suggestedCategorySlug}`}
                </p>
                {o.missingInformation.length > 0 && (
                  <div>
                    <p className="font-medium">Ask the owner</p>
                    <ul className="list-disc pl-5">{o.missingInformation.map((m) => <li key={m}>{m}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </AiPanel>
          <Card title="Property">
            <KeyValue
              columns={1}
              items={[
                ['Property', `${r.property.nickname} · ${r.property.locality}, ${r.property.city} ${r.property.pinCode}`],
                ['Access contact', r.accessContact ? `${r.accessContact.name} (${r.accessContact.relationship}) ${r.accessContact.phone ?? ''}` : 'Owner arranges'],
                ['Created on behalf', r.createdOnBehalfBy ? 'Yes (by admin)' : 'No'],
              ]}
            />
          </Card>
          {r.workOrders.length > 0 && (
            <Card title="Work orders">
              <ul className="space-y-1 text-sm">
                {r.workOrders.map((w) => (
                  <li key={w.id} className="flex justify-between">
                    <Link href={`/admin/work-orders/${w.id}`} className="underline">
                      {w.reference}
                    </Link>
                    <StatusBadge status={w.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {r.paymentRequirements.length > 0 && (
            <Card title="Payment requirements">
              <ul className="space-y-2 text-sm">
                {r.paymentRequirements.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {statusLabel(p.purpose)} · {inr(p.amountPaise)}
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={p.status} />
                      {finance && p.status !== 'PAID' && p.status !== 'WAIVED' && (
                        <Button size="sm" variant="ghost" onClick={() => act.run(`w-${p.id}`, async () => { await post(`/admin/payment-requirements/${p.id}/waive`, { reason: 'Waived by finance' }); refresh(); })}>
                          Waive
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Timeline">
            <Timeline items={r.timeline} />
          </Card>
        </div>
      </div>
    </>
  );
}
