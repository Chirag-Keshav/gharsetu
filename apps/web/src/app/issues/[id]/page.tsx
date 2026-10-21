'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { RESOLUTION_CODES, rupeesToPaise, statusLabel } from '@propcare/shared';
import { AiPanel, MessageThread, Timeline } from '@/components/shared';
import { Alert, Button, Card, ErrorAlert, Form, KeyValue, Loading, Modal, PageHeader, SelectField, StatusBadge, TextArea, TextField } from '@/components/ui';
import { openAttachment, post, useApi } from '@/lib/api';
import { dateTimeLabel, inr } from '@/lib/format';
import { hasFlag, SignedIn, type Me } from '@/lib/session';
import { useAction } from '@/lib/use-action';

interface IssueDetail {
  id: string;
  reference: string;
  subjectType: 'BOOKING' | 'WORK_ORDER';
  subjectId: string;
  category: string;
  description: string;
  status: string;
  raisedByRole: string;
  resolutionCode: string | null;
  visibleSummary: string | null;
  resolvedAt: string | null;
  createdAt: string;
  mine: boolean;
  internalNote?: string | null;
  handledByAdminId?: string | null;
  subject: { reference: string; status: string; totalPaise?: number; refundPaise?: number; requestId?: string; payout?: { id: string; status: string; amountPaise: number } | null } | null;
  timeline: Array<{ from: string | null; to: string; actorRole: string; at: string }>;
  attachments: Array<{ id: string; filename: string }>;
  reworkOrders: Array<{ id: string; reference: string; status: string }>;
  canReopen: boolean;
}

function subjectHref(i: IssueDetail, me: Me) {
  if (me.activeRole === 'ADMIN') return i.subjectType === 'BOOKING' ? `/admin/bookings/${i.subjectId}` : `/admin/work-orders/${i.subjectId}`;
  if (i.subjectType === 'BOOKING') return me.activeRole === 'OWNER' ? `/owner/bookings/${i.subjectId}` : `/trips/${i.subjectId}`;
  return i.subject?.requestId ? `/owner/requests/${i.subject.requestId}` : '/owner';
}

function ResolveDialog({ issue, me, onDone }: { issue: IssueDetail; me: Me; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string>('NO_ACTION_REQUIRED');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState('');
  const [refund, setRefund] = useState('');
  const [adjust, setAdjust] = useState('');
  const { busy, error, run } = useAction();
  const finance = hasFlag(me, 'FINANCE') && issue.subjectType === 'BOOKING';
  return (
    <>
      <Button onClick={() => setOpen(true)}>Resolve</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Resolve ${issue.reference}`}>
        <Form
          className="space-y-3"
          onSubmit={() =>
            run('resolve', async () => {
              await post(
                `/issues/${issue.id}/resolve`,
                {
                  resolutionCode: code,
                  internalNote: note,
                  visibleSummary: summary || null,
                  ...(finance && refund ? { refundPaise: rupeesToPaise(refund) ?? undefined } : {}),
                  ...(finance && adjust ? { payoutAdjustmentPaise: rupeesToPaise(adjust) ?? undefined } : {}),
                },
                true,
              );
              setOpen(false);
              onDone();
            })
          }
        >
          <SelectField label="Outcome" value={code} onChange={(e) => setCode(e.target.value)} options={RESOLUTION_CODES.map((c) => ({ value: c, label: statusLabel(c) }))} />
          <TextArea label="Internal note" required maxLength={2000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} hint="Visible to admins only." />
          <TextArea label="Summary for the person who raised it" maxLength={2000} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          {finance && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Refund to guest (₹)" inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={refund} onChange={(e) => setRefund(e.target.value)} hint={`Paid ${inr(issue.subject?.totalPaise)}`} />
              <TextField label="Reduce owner payout by (₹)" inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={adjust} onChange={(e) => setAdjust(e.target.value)} hint={issue.subject?.payout ? `Payout ${inr(issue.subject.payout.amountPaise)} (${statusLabel(issue.subject.payout.status)})` : undefined} />
            </div>
          )}
          <ErrorAlert error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" busy={busy === 'resolve'}>
              Resolve issue
            </Button>
          </div>
        </Form>
      </Modal>
    </>
  );
}

function IssueView({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const { data: i, error, isLoading, mutate } = useApi<IssueDetail>(`/issues/${id}`);
  const act = useAction();
  const [reopenReason, setReopenReason] = useState('');
  const admin = me.activeRole === 'ADMIN';
  if (isLoading) return <Loading />;
  if (error || !i) return <div className="mx-auto max-w-4xl px-4 py-8"><ErrorAlert error={error ?? new Error('Issue not found.')} /></div>;
  const open = i.status === 'OPEN' || i.status === 'IN_PROGRESS';
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title={`${statusLabel(i.category)} issue`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {i.reference} · raised {dateTimeLabel(i.createdAt)} <StatusBadge status={i.status} />
          </span>
        }
        back={admin ? { href: '/admin/issues', label: 'Issues' } : { href: me.activeRole === 'OWNER' ? '/owner' : '/trips', label: 'Back' }}
        actions={
          admin && (
            <>
              {i.status === 'OPEN' && (
                <Button variant="secondary" busy={act.busy === 'take'} onClick={() => act.run('take', async () => { await post(`/issues/${i.id}/take`); await mutate(); })}>
                  Take it
                </Button>
              )}
              {open && <ResolveDialog issue={i} me={me} onDone={() => mutate()} />}
              {open && i.subjectType === 'WORK_ORDER' && (
                <Button variant="secondary" busy={act.busy === 'rework'} onClick={() => act.run('rework', async () => { await post(`/issues/${i.id}/rework-work-order`, {}, true); await mutate(); })}>
                  Create rework order
                </Button>
              )}
              {i.status === 'RESOLVED' && (
                <Button variant="ghost" busy={act.busy === 'close'} onClick={() => act.run('close', async () => { await post(`/issues/${i.id}/close`); await mutate(); })}>
                  Close
                </Button>
              )}
            </>
          )
        }
      />
      <ErrorAlert error={act.error} />
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card title="What was reported">
            <p className="whitespace-pre-wrap text-sm">{i.description}</p>
            {i.attachments.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {i.attachments.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2" onClick={() => openAttachment(a.id)}>
                      📎 {a.filename}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {i.resolutionCode && (
            <Alert tone="ok" title={`Resolved: ${statusLabel(i.resolutionCode)}`}>
              {i.visibleSummary ?? 'Our team has resolved this issue.'}
              {admin && i.internalNote && <p className="mt-2 text-xs text-muted">Internal: {i.internalNote}</p>}
            </Alert>
          )}
          {admin && <AiPanel feature="issue_summary" subjectType="ISSUE" subjectId={i.id} title="Issue summary">{(o: { summary: string; urgency: string; resolutionOptions: Array<{ option: string; policyReference: string | null }> }) => (
            <div className="space-y-2">
              <p>{o.summary}</p>
              <p className="text-xs text-muted">Urgency: {statusLabel(o.urgency)}</p>
              <ul className="list-disc pl-5">
                {o.resolutionOptions.map((r, n) => (
                  <li key={n}>
                    {r.option}
                    {r.policyReference && <span className="text-muted"> ({r.policyReference})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}</AiPanel>}
          <MessageThread path={`/issues/${i.id}/messages`} title="Conversation with our team" allowInternal={admin} attachOwnerType="MESSAGE" disabled={i.status === 'CLOSED' ? 'This issue is closed.' : undefined} />
          {i.canReopen && (
            <Card title="Not fixed?">
              <Form className="space-y-2" onSubmit={() => act.run('reopen', async () => { await post(`/issues/${i.id}/reopen`, { reason: reopenReason }); await mutate(); })}>
                <TextArea label="Tell us what is still wrong" required maxLength={1000} rows={2} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
                <Button type="submit" variant="secondary" busy={act.busy === 'reopen'}>
                  Reopen issue
                </Button>
              </Form>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Related">
            <KeyValue
              columns={1}
              items={[
                [i.subjectType === 'BOOKING' ? 'Booking' : 'Work order', <Link key="s" className="underline" href={subjectHref(i, me)}>{i.subject?.reference ?? '—'}</Link>],
                ['Status', <StatusBadge key="st" status={i.subject?.status} />],
                ...(i.reworkOrders.length
                  ? ([['Rework', i.reworkOrders.map((w) => `${w.reference} (${statusLabel(w.status)})`).join(', ')]] as Array<[string, string]>)
                  : []),
                ...(admin && i.subject?.payout ? ([['Payout', `${inr(i.subject.payout.amountPaise)} · ${statusLabel(i.subject.payout.status)}`]] as Array<[string, string]>) : []),
              ]}
            />
          </Card>
          <Card title="History">
            <Timeline items={i.timeline} />
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function IssuePage() {
  return <SignedIn>{(me) => <IssueView me={me} />}</SignedIn>;
}
