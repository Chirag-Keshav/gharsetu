'use client';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { statusLabel } from '@propcare/shared';
import { ReportIssueButton } from '@/components/issue-form';
import { QuoteTable, type Quote } from '@/components/quote-view';
import { MessageThread, Timeline } from '@/components/shared';
import { Alert, Button, Card, Checkbox, ErrorAlert, KeyValue, Loading, Modal, PageHeader, StatusBadge, TextArea } from '@/components/ui';
import { newIdempotencyKey, openAttachment, post, useApi } from '@/lib/api';
import { dateTimeLabel, inr } from '@/lib/format';
import { answerLabel, type RequestDetail } from '@/lib/request';
import { useAction } from '@/lib/use-action';

interface OwnerWorkOrder {
  id: string;
  reference: string;
  kind: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedAt: string | null;
  ownerReviewDueAt: string | null;
  approvedTotalPaise: number;
  careTeam: string | null;
  checklist: Array<{ key: string; label: string; result: unknown; completedAt: string | null }>;
  evidence: Array<{ id: string; filename: string; evidencePhase?: string | null }>;
  changeOrders: Array<{ id: string; reference: string; status: string; totalPaise: number }>;
  issues: Array<{ id: string; reference: string; status: string }>;
  canAccept: boolean;
}

function QuoteDecision({ q, onDone }: { q: Quote; onDone: () => void }) {
  const [open, setOpen] = useState<'approve' | 'reject' | null>(null);
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState('');
  const [revise, setRevise] = useState(true);
  const [key] = useState(() => newIdempotencyKey());
  const { busy, error, run } = useAction();
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen('approve')}>Approve {inr(q.totalPaise)}</Button>
        <Button variant="secondary" onClick={() => setOpen('reject')}>
          Decline
        </Button>
      </div>
      <Modal
        open={open === 'approve'}
        onClose={() => setOpen(null)}
        title={`Approve ${q.reference} v${q.version}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Not yet
            </Button>
            <Button
              disabled={!agree}
              busy={busy === 'approve'}
              onClick={() =>
                run('approve', async () => {
                  // Version and the displayed total bind the approval to exactly what was shown (SPEC §7 rule 3).
                  await post(`/quotes/${q.id}/approve`, { version: q.version, displayedTotalPaise: q.totalPaise }, key);
                  setOpen(null);
                  onDone();
                })
              }
            >
              Approve
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            You are approving version {q.version} for a total of <strong>{inr(q.totalPaise)}</strong>. Any change in scope will need a new quote that you approve separately.
          </p>
          <Checkbox label="I have read the quote and approve this work." checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <ErrorAlert error={error} />
        </div>
      </Modal>
      <Modal
        open={open === 'reject'}
        onClose={() => setOpen(null)}
        title="Decline quote"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Back
            </Button>
            <Button
              variant="danger"
              busy={busy === 'reject'}
              onClick={() =>
                run('reject', async () => {
                  await post(`/quotes/${q.id}/reject`, { reason: reason || null, requestRevision: revise }, `${key}-reject`);
                  setOpen(null);
                  onDone();
                })
              }
            >
              Decline
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <TextArea label="What would you like changed? (optional)" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Checkbox label="Ask for a revised quote" checked={revise} onChange={(e) => setRevise(e.target.checked)} />
          <ErrorAlert error={error} />
        </div>
      </Modal>
    </>
  );
}

function WorkOrderCard({ id, onChange }: { id: string; onChange: () => void }) {
  const { data: w, mutate } = useApi<OwnerWorkOrder>(`/work-orders/${id}`);
  const { busy, error, run } = useAction();
  if (!w) return <Loading />;
  return (
    <Card title={`${w.kind === 'REWORK' ? 'Rework' : 'Work order'} ${w.reference}`} actions={<StatusBadge status={w.status} />}>
      <KeyValue
        items={[
          ['Scheduled', w.scheduledStart ? `${dateTimeLabel(w.scheduledStart)} – ${dateTimeLabel(w.scheduledEnd)}` : 'Being arranged'],
          ['Care team', w.careTeam],
          ['Approved total', inr(w.approvedTotalPaise)],
          ...(w.completedAt ? ([['Completed', dateTimeLabel(w.completedAt)]] as Array<[string, string]>) : []),
        ]}
      />
      {w.checklist.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-medium">Checklist</p>
          <ul className="space-y-1 text-sm">
            {w.checklist.map((c) => (
              <li key={c.key} className="flex gap-2">
                <span aria-hidden>{c.completedAt ? '✓' : '○'}</span>
                <span>
                  {c.label}
                  {c.result !== null && c.result !== true && <span className="text-muted"> — {Array.isArray(c.result) ? `${c.result.length} photo(s)` : String(c.result)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {w.evidence.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-medium">Photos from the visit</p>
          <ul className="flex flex-wrap gap-2">
            {w.evidence.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => openAttachment(e.id)} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2">
                  📷 {e.evidencePhase ? `${statusLabel(e.evidencePhase)} · ` : ''}
                  {e.filename}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {w.canAccept && (
        <div className="mt-4">
          <Alert tone="warn" title="Please review the completed work">
            {w.ownerReviewDueAt && `If we don't hear from you by ${dateTimeLabel(w.ownerReviewDueAt)}, the work is treated as accepted. `}
            Accept it, or report a problem and we will make it right.
          </Alert>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {w.canAccept && (
          <Button busy={busy === 'accept'} onClick={() => run('accept', async () => { await post(`/work-orders/${w.id}/accept`, {}, true); await mutate(); onChange(); })}>
            Accept work
          </Button>
        )}
        {['READY_FOR_OWNER_REVIEW', 'COMPLETED'].includes(w.status) && <ReportIssueButton path={`/work-orders/${w.id}/issues`} />}
      </div>
      {w.issues.length > 0 && (
        <p className="mt-3 text-sm">
          Issues:{' '}
          {w.issues.map((i) => (
            <a key={i.id} href={`/issues/${i.id}`} className="mr-2 underline">
              {i.reference} ({statusLabel(i.status)})
            </a>
          ))}
        </p>
      )}
      <ErrorAlert error={error} />
    </Card>
  );
}

function RequestView() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const returnedFromPayment = !!sp.get('payment');
  // After the payment page, poll briefly until the signed webhook settles the requirement.
  const { data: r, error, isLoading, mutate } = useApi<RequestDetail>(`/service-requests/${id}`, {
    refreshInterval: (d) => (returnedFromPayment && d?.paymentRequirements.some((p) => p.isDue && p.status !== 'PAID' && p.status !== 'WAIVED') ? 2000 : 0),
  });
  const quotes = useApi<{ items: Quote[] }>(`/service-requests/${id}/quotes`);
  const pay = useAction();
  const cancel = useAction();
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  if (isLoading) return <Loading />;
  if (error || !r) return <ErrorAlert error={error ?? new Error('Request not found.')} />;
  const refresh = () => {
    void mutate();
    void quotes.mutate();
  };
  const current = quotes.data?.items.find((q) => q.status === 'SENT');
  const history = quotes.data?.items.filter((q) => q !== current) ?? [];
  const due = r.paymentRequirements.filter((p) => p.isDue && p.status !== 'PAID' && p.status !== 'WAIVED');
  const cancellable = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFORMATION', 'INSPECTION_SCHEDULED', 'QUOTATION_DRAFT', 'QUOTATION_SENT'].includes(r.status);
  return (
    <>
      <PageHeader
        title={r.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {r.reference} · {r.property.nickname} · {r.category} <StatusBadge status={r.status} />
            {r.urgency !== 'STANDARD' && <StatusBadge status={r.urgency} />}
          </span>
        }
        back={{ href: `/owner/properties/${r.property.id}?tab=care`, label: r.property.nickname }}
        actions={
          cancellable && (
            <Button variant="ghost" onClick={() => setCancelOpen(true)}>
              Cancel request
            </Button>
          )
        }
      />
      <div className="mb-4 space-y-3">
        {sp.get('created') && <Alert tone="ok" title="Request received">Our team will review it and reply here. We aim to respond within one working day{r.safetyFlag ? ' — sooner for safety issues' : ''}.</Alert>}
        {sp.get('payment') === 'succeeded' && <Alert tone="ok">Payment received. Thank you.</Alert>}
        {sp.get('payment') === 'failed' && <Alert tone="danger">The payment did not go through. You can try again.</Alert>}
        {r.safetyGuidance.length > 0 && (
          <Alert tone="danger" title="Safety guidance">
            <ul className="space-y-1">
              {r.safetyGuidance.map((g) => (
                <li key={g.key}>{g.text ?? g.key}</li>
              ))}
            </ul>
          </Alert>
        )}
        {r.status === 'NEEDS_INFORMATION' && <Alert tone="warn">Our team needs more information — please reply in the messages below.</Alert>}
        {due.map((p) => (
          <Alert key={p.id} tone="warn" title={`${statusLabel(p.purpose)} due: ${inr(p.amountPaise - p.paidPaise)}`}>
            <Button
              size="sm"
              className="mt-2"
              busy={pay.busy === p.id}
              onClick={() =>
                pay.run(p.id, async () => {
                  const res = await post<{ checkoutUrl: string }>(`/payment-requirements/${p.id}/payments`, {}, true);
                  router.push(res.checkoutUrl);
                })
              }
            >
              Pay now
            </Button>
          </Alert>
        ))}
        <ErrorAlert error={pay.error} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {current && (
            <Card title={`Quote ${current.reference} · version ${current.version}`} actions={<StatusBadge status="SENT" label="Awaiting your decision" />}>
              <QuoteTable q={current} />
              <div className="mt-4">
                <QuoteDecision q={current} onDone={refresh} />
              </div>
            </Card>
          )}
          {r.workOrders.map((w) => (
            <WorkOrderCard key={w.id} id={w.id} onChange={refresh} />
          ))}
          <MessageThread path={`/service-requests/${r.id}/messages`} title="Messages with our care team" attachOwnerType="MESSAGE" />
          <Card title="Your request">
            <p className="whitespace-pre-wrap text-sm">{r.description}</p>
            {Object.keys(r.intakeAnswers).length > 0 && (
              <div className="mt-3">
                <KeyValue items={Object.entries(r.intakeAnswers).map(([k, v]) => [r.intakeSchema.fields.find((f) => f.key === k)?.label ?? k, answerLabel(r, k, v)])} />
              </div>
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
          {history.length > 0 && (
            <Card title="Earlier quotes">
              <ul className="space-y-1 text-sm">
                {history.map((q) => (
                  <li key={q.id} className="flex justify-between gap-2">
                    <span>
                      {q.reference} v{q.version} {q.quoteType === 'CHANGE_ORDER' && '(change order)'}
                    </span>
                    <span className="flex items-center gap-2">
                      {inr(q.totalPaise)} <StatusBadge status={q.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {r.inspections.length > 0 && (
            <Card title="Inspection">
              {r.inspections.map((i) => (
                <div key={i.id} className="text-sm">
                  <p className="flex items-center gap-2">
                    {dateTimeLabel(i.scheduledStart)} <StatusBadge status={i.status} />
                  </p>
                  {i.feePaise > 0 && <p className="text-muted">Inspection fee {inr(i.feePaise)}</p>}
                  {i.findings && <p className="mt-1">{i.findings}</p>}
                </div>
              ))}
            </Card>
          )}
          <Card title="Progress">
            <Timeline items={r.timeline} />
          </Card>
          {r.paymentRequirements.length > 0 && (
            <Card title="Payments">
              <ul className="space-y-1 text-sm">
                {r.paymentRequirements.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>{statusLabel(p.purpose)}</span>
                    <span className="flex items-center gap-2">
                      {inr(p.amountPaise)} <StatusBadge status={p.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this request?"
        footer={
          <Button variant="danger" disabled={cancelReason.trim().length < 1} busy={cancel.busy === 'cancel'} onClick={() => cancel.run('cancel', async () => { await post(`/service-requests/${r.id}/cancel`, { reason: cancelReason }); setCancelOpen(false); refresh(); })}>
            Cancel request
          </Button>
        }
      >
        <TextArea label="Reason" required rows={2} maxLength={1000} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        <ErrorAlert error={cancel.error} />
      </Modal>
    </>
  );
}

export default function RequestPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RequestView />
    </Suspense>
  );
}
