'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { allowedTargets, BLOCKED_REASONS, REPORT_SOURCES, statusLabel, workOrderMachine, type WorkOrderStatus } from '@propcare/shared';
import { AiPanel, FileUploader, Timeline } from '@/components/shared';
import { Alert, Button, Card, Checkbox, ErrorAlert, Form, KeyValue, Loading, Modal, PageHeader, SelectField, StatusBadge, TextArea, TextField } from '@/components/ui';
import { api, del, openAttachment, post, useApi } from '@/lib/api';
import { dateTimeLabel, fromLocalInput, inr, toLocalInput } from '@/lib/format';
import { hasFlag, useMe } from '@/lib/session';
import { useAction } from '@/lib/use-action';

interface AdminWorkOrder {
  id: string;
  reference: string;
  kind: string;
  status: string;
  requestId: string;
  request: { reference: string; title: string };
  issueId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  approvedTotalPaise: number;
  blockedReason: string | null;
  visits: Array<{ id: string; checkedInAt: string; checkedOutAt: string | null; providerId: string; note: string | null; source: string }>;
  checklist: Array<{ key: string; label: string; type: string; required: boolean; minCount: number | null; result: unknown; notes: string | null; completedAt: string | null }>;
  evidence: Array<{ id: string; filename: string; evidencePhase: string | null; capturedAt: string | null; source?: string }>;
  issues: Array<{ id: string; reference: string; status: string }>;
  paymentRequirements: Array<{ id: string; purpose: string; amountPaise: number; status: string }>;
  timeline: Array<{ from: string | null; to: string; actorRole: string; reason?: string | null; at: string }>;
  assignments: Array<{ id: string; providerId: string; providerName: string; role: string; status: string; overrideReason: string | null }>;
  completeness: { missingItems: string[]; missingMedia: Array<{ phase: string; present: number; required: number }> } | null;
  completionOverride: string | null;
}

interface Eligible {
  id: string;
  name: string;
  providerType: string;
  internalRating: number | null;
  jobs: number;
  availabilityNotes: string | null;
}

/** On-behalf recording: every entry names the provider and how the report reached us (SPEC §8.7). */
function OnBehalf({ w, onDone }: { w: AdminWorkOrder; onDone: () => void }) {
  const active = w.assignments.filter((a) => a.status === 'ACTIVE');
  const [chosen, setProviderId] = useState('');
  // Default to the first active assignee; assignments can appear after this panel mounts.
  const providerId = active.some((a) => a.providerId === chosen) ? chosen : (active[0]?.providerId ?? '');
  const [source, setSource] = useState<string>('PHONE');
  const [checkIn, setCheckIn] = useState(toLocalInput(new Date().toISOString()));
  const [checkOut, setCheckOut] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState('AFTER');
  const [files, setFiles] = useState<Array<{ id: string }>>([]);
  const [uploaderKey, setUploaderKey] = useState(0);
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [blocked, setBlocked] = useState<string>('ACCESS_DENIED');
  const { busy, error, run } = useAction();
  if (!active.length) return <Alert tone="info">Assign a provider before recording work.</Alert>;
  const base = { providerId, source };
  return (
    <Card title="Record on behalf of the provider">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <SelectField label="Provider" value={providerId} onChange={(e) => setProviderId(e.target.value)} options={active.map((a) => ({ value: a.providerId, label: a.providerName }))} />
        <SelectField label="Reported via" value={source} onChange={(e) => setSource(e.target.value)} options={REPORT_SOURCES.map((s) => ({ value: s, label: statusLabel(s) }))} />
      </div>
      <div className="space-y-6">
        <Form className="grid gap-3 sm:grid-cols-3" onSubmit={() => run('visit', async () => { await post(`/work-orders/${w.id}/visits`, { ...base, checkedInAt: fromLocalInput(checkIn), checkedOutAt: checkOut ? fromLocalInput(checkOut) : null, note: note || null }); onDone(); })}>
          <TextField label="Checked in" type="datetime-local" required value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          <TextField label="Checked out" type="datetime-local" min={checkIn} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          <TextField label="Note" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="sm:col-span-3">
            <Button type="submit" size="sm" variant="secondary" busy={busy === 'visit'}>
              Record visit
            </Button>
          </div>
        </Form>

        {w.checklist.length > 0 && (
          <Form
            className="space-y-2"
            onSubmit={() =>
              run('checklist', async () => {
                const entries = Object.entries(results).filter(([, v]) => v !== undefined && v !== '');
                await post(`/work-orders/${w.id}/checklist-results`, { ...base, results: entries.map(([itemKey, result]) => ({ itemKey, result })) });
                setResults({});
                onDone();
              })
            }
          >
            <p className="text-sm font-medium">Checklist</p>
            {w.checklist.map((c) => (
              <div key={c.key} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-5" aria-hidden>{c.completedAt ? '✓' : '○'}</span>
                <span className="min-w-[200px] flex-1">
                  {c.label}
                  {c.required && <span className="text-danger"> *</span>}
                  {c.result !== null && <span className="text-muted"> — {Array.isArray(c.result) ? `${c.result.length} photo(s)` : c.result === true ? 'done' : String(c.result)}</span>}
                </span>
                {c.type === 'BOOLEAN' && <Checkbox label="Done" checked={results[c.key] === true} onChange={(e) => setResults({ ...results, [c.key]: e.target.checked || undefined })} />}
                {c.type === 'TEXT' && <input aria-label={c.label} className="rounded-md border border-line bg-surface px-2 py-1" value={(results[c.key] as string) ?? ''} onChange={(e) => setResults({ ...results, [c.key]: e.target.value })} />}
                {c.type === 'NUMBER' && <input aria-label={c.label} type="number" className="w-24 rounded-md border border-line bg-surface px-2 py-1" value={(results[c.key] as number) ?? ''} onChange={(e) => setResults({ ...results, [c.key]: e.target.value === '' ? undefined : Number(e.target.value) })} />}
                {c.type === 'PHOTO' &&
                  (w.evidence.length === 0 ? (
                    <span className="text-xs text-muted">Attach photos below first{c.minCount ? ` (min ${c.minCount})` : ''}</span>
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      {w.evidence.map((e) => {
                        const list = Array.isArray(results[c.key]) ? (results[c.key] as string[]) : [];
                        return (
                          <Checkbox
                            key={e.id}
                            label={e.filename}
                            checked={list.includes(e.id)}
                            onChange={(ev) => setResults({ ...results, [c.key]: ev.target.checked ? [...list, e.id] : list.filter((x) => x !== e.id) })}
                          />
                        );
                      })}
                    </span>
                  ))}
              </div>
            ))}
            <Button type="submit" size="sm" variant="secondary" busy={busy === 'checklist'} disabled={!Object.keys(results).length}>
              Save checklist
            </Button>
          </Form>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Photos and videos</p>
          <SelectField label="Phase" value={phase} onChange={(e) => setPhase(e.target.value)} options={['BEFORE', 'DURING', 'AFTER'].map((p) => ({ value: p, label: statusLabel(p) }))} />
          <FileUploader key={uploaderKey} ownerType="WORK_ORDER" ownerId={w.id} evidencePhase={phase} onChange={setFiles} compact />
          <Button size="sm" variant="secondary" disabled={!files.length} busy={busy === 'evidence'} onClick={() => run('evidence', async () => { await post(`/work-orders/${w.id}/evidence`, { ...base, attachmentIds: files.map((f) => f.id), phase, capturedAt: new Date().toISOString() }); setFiles([]); setUploaderKey((k) => k + 1); onDone(); })}>
            Attach {files.length || ''} file{files.length === 1 ? '' : 's'}
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <SelectField label="Blocked because" value={blocked} onChange={(e) => setBlocked(e.target.value)} options={BLOCKED_REASONS.map((b) => ({ value: b, label: statusLabel(b) }))} />
          <Button size="sm" variant="secondary" busy={busy === 'blocked'} disabled={!note.trim()} onClick={() => run('blocked', async () => { await post(`/work-orders/${w.id}/report-blocked`, { ...base, reason: blocked, note }); onDone(); })}>
            Report blocked (uses note)
          </Button>
          <Button size="sm" busy={busy === 'submit'} onClick={() => run('submit', async () => { await post(`/work-orders/${w.id}/submit-for-review`, { ...base, note: note || null }); onDone(); })}>
            Submit for review
          </Button>
        </div>
        <ErrorAlert error={error} />
      </div>
    </Card>
  );
}

function Assign({ w, onDone }: { w: AdminWorkOrder; onDone: () => void }) {
  const { me } = useMe();
  const eligible = useApi<{ items: Eligible[] }>(`/work-orders/${w.id}/eligible-providers`);
  const all = useApi<{ items: Eligible[] }>(hasFlag(me, 'ASSIGNMENT_OVERRIDE') ? '/admin/providers?status=ACTIVE&limit=100' : null);
  const [providerId, setProviderId] = useState('');
  const [role, setRole] = useState('PRIMARY');
  const [override, setOverride] = useState('');
  const { busy, error, run } = useAction();
  const isEligible = eligible.data?.items.some((p) => p.id === providerId);
  const options = [...(eligible.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.name}${p.internalRating ? ` · ★${p.internalRating}` : ''} · ${p.jobs} jobs` })), ...((all.data?.items ?? []).filter((p) => !eligible.data?.items.some((e) => e.id === p.id)).map((p) => ({ value: p.id, label: `${p.name} (not eligible — override)` })))];
  return (
    <Card title="Assignment">
      <ul className="mb-3 space-y-1 text-sm">
        {w.assignments.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2">
            <span>
              {a.providerName} · {statusLabel(a.role)} <StatusBadge status={a.status} />
              {a.overrideReason && <span className="block text-xs text-warn">Override: {a.overrideReason}</span>}
            </span>
            {a.status === 'ACTIVE' && (
              <Button size="sm" variant="ghost" busy={busy === a.id} onClick={() => run(a.id, async () => { await del(`/work-orders/${w.id}/assignments/${a.id}`); onDone(); })}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <AiPanel<{ ranked: Array<{ providerId: string; rank: number; reason: string }> }> feature="provider_shortlist" subjectType="WORK_ORDER" subjectId={w.id} title="Shortlist" autoload={false}>
        {(o) => (
          <ol className="list-decimal pl-5">
            {o.ranked.map((r) => (
              <li key={r.providerId}>
                <button type="button" className="underline" onClick={() => setProviderId(r.providerId)}>
                  {eligible.data?.items.find((p) => p.id === r.providerId)?.name ?? r.providerId}
                </button>{' '}
                <span className="text-muted">— {r.reason}</span>
              </li>
            ))}
          </ol>
        )}
      </AiPanel>
      <Form className="mt-3 space-y-3" onSubmit={() => run('assign', async () => { await post(`/work-orders/${w.id}/assignments`, { providerId, assignmentRole: role, overrideReason: isEligible ? null : override }); setProviderId(''); onDone(); })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Provider" required value={providerId} placeholder="Choose…" onChange={(e) => setProviderId(e.target.value)} options={options} />
          <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: 'PRIMARY', label: 'Primary' }, { value: 'SUPPORT', label: 'Support' }]} />
        </div>
        {providerId && !isEligible && <TextField label="Override reason (audited)" required maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} />}
        <ErrorAlert error={error} />
        <Button type="submit" variant="secondary" busy={busy === 'assign'}>
          Assign
        </Button>
      </Form>
    </Card>
  );
}

export default function AdminWorkOrder() {
  const { id } = useParams<{ id: string }>();
  const { me } = useMe();
  const { data: w, error, isLoading, mutate } = useApi<AdminWorkOrder>(`/work-orders/${id}`);
  const [sched, setSched] = useState<{ start: string; end: string } | null>(null);
  const [dialog, setDialog] = useState<'rework' | 'override' | 'transition' | 'safety' | null>(null);
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  const [sheet, setSheet] = useState<Record<string, unknown> | null>(null);
  const act = useAction();
  if (isLoading) return <Loading />;
  if (error || !w) return <ErrorAlert error={error} />;
  const refresh = () => void mutate();
  const targets = allowedTargets(workOrderMachine, w.status as WorkOrderStatus, 'ADMIN');
  const s = sched ?? { start: toLocalInput(w.scheduledStart), end: toLocalInput(w.scheduledEnd) };
  const closed = ['COMPLETED', 'CANCELLED'].includes(w.status);
  const missing = [
    ...(w.completeness?.missingItems ?? []).map((k) => `Checklist: ${w.checklist.find((c) => c.key === k)?.label ?? k}`),
    ...(w.completeness?.missingMedia ?? []).map((m) => `${statusLabel(m.phase)} photos ${m.present}/${m.required}`),
  ];
  return (
    <>
      <PageHeader
        title={`${w.reference} · ${w.request.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link className="underline" href={`/admin/requests/${w.requestId}`}>
              {w.request.reference}
            </Link>
            · {inr(w.approvedTotalPaise)} <StatusBadge status={w.status} />
            {w.kind === 'REWORK' && <StatusBadge status="PENDING" label="Rework" />}
          </span>
        }
        back={{ href: '/admin/work-orders', label: 'Work orders' }}
        actions={
          <>
            {w.status === 'SUBMITTED_FOR_REVIEW' && hasFlag(me, 'COMPLETION_APPROVE') && (
              <>
                <Button busy={act.busy === 'approve'} disabled={missing.length > 0} onClick={() => act.run('approve', async () => { await post(`/work-orders/${w.id}/approve-completion`, {}); refresh(); })}>
                  Approve completion
                </Button>
                {missing.length > 0 && <Button variant="secondary" onClick={() => setDialog('override')}>Approve with override</Button>}
                <Button variant="secondary" onClick={() => setDialog('rework')}>
                  Request rework
                </Button>
              </>
            )}
            {targets.length > 0 && !closed && (
              <Button variant="ghost" onClick={() => { setTo(targets[0]); setDialog('transition'); }}>
                Change status
              </Button>
            )}
            <Button variant="ghost" busy={act.busy === 'sheet'} onClick={() => act.run('sheet', async () => setSheet(await api(`/work-orders/${w.id}/job-sheet`)))}>
              Job sheet
            </Button>
          </>
        }
      />
      <ErrorAlert error={act.error} />
      {w.blockedReason && w.status === 'BLOCKED' && (
        <div className="mb-4">
          <Alert tone="warn" title={`Blocked: ${statusLabel(w.blockedReason)}`}>
            <Button size="sm" variant="secondary" onClick={() => setDialog('safety')}>
              Record safety mitigation
            </Button>
          </Alert>
        </div>
      )}
      {missing.length > 0 && !closed && (
        <div className="mb-4">
          <Alert tone="warn" title="Still needed before completion">
            {missing.join(' · ')}
          </Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {!closed && (
            <Card title="Schedule">
              <Form className="grid gap-3 sm:grid-cols-3" onSubmit={() => act.run('schedule', async () => { await post(`/work-orders/${w.id}/schedule`, { scheduledStart: fromLocalInput(s.start), scheduledEnd: fromLocalInput(s.end) }); setSched(null); refresh(); })}>
                <TextField label="Start" type="datetime-local" required value={s.start} onChange={(e) => setSched({ ...s, start: e.target.value })} />
                <TextField label="End" type="datetime-local" required min={s.start} value={s.end} onChange={(e) => setSched({ ...s, end: e.target.value })} />
                <div className="flex items-end">
                  <Button type="submit" variant="secondary" busy={act.busy === 'schedule'}>
                    {w.scheduledStart ? 'Reschedule' : 'Schedule'}
                  </Button>
                </div>
              </Form>
              <p className="mt-2 text-xs text-muted">If the property is listed, nights overlapping the window are blocked automatically; conflicts with confirmed bookings are refused.</p>
            </Card>
          )}
          {!closed && <OnBehalf w={w} onDone={refresh} />}
          <Card title="Evidence">
            {w.evidence.length === 0 && <p className="text-sm text-muted">No photos yet.</p>}
            <ul className="flex flex-wrap gap-2">
              {w.evidence.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => openAttachment(e.id)} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2">
                    📷 {statusLabel(e.evidencePhase)} · {e.filename}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <AiPanel<{ completeness: string; summary: string; concerns: string[] }> feature="evidence_review" subjectType="WORK_ORDER" subjectId={w.id} title="Evidence check" autoload={w.status === 'SUBMITTED_FOR_REVIEW'}>
                {(o) => (
                  <div className="space-y-1">
                    <p>
                      <StatusBadge status={o.completeness === 'COMPLETE' ? 'COMPLETED' : 'PENDING'} label={statusLabel(o.completeness)} /> {o.summary}
                    </p>
                    {o.concerns.length > 0 && <ul className="list-disc pl-5">{o.concerns.map((c) => <li key={c}>{c}</li>)}</ul>}
                  </div>
                )}
              </AiPanel>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          {!closed && <Assign w={w} onDone={refresh} />}
          <Card title="Visits">
            {w.visits.length === 0 && <p className="text-sm text-muted">None recorded.</p>}
            <ul className="space-y-1 text-sm">
              {w.visits.map((v) => (
                <li key={v.id}>
                  {dateTimeLabel(v.checkedInAt)} → {v.checkedOutAt ? dateTimeLabel(v.checkedOutAt) : '…'} <span className="text-muted">({statusLabel(v.source)})</span>
                  {v.note && <span className="block text-muted">{v.note}</span>}
                </li>
              ))}
            </ul>
          </Card>
          {w.issues.length > 0 && (
            <Card title="Issues">
              {w.issues.map((i) => (
                <Link key={i.id} href={`/issues/${i.id}`} className="mr-2 text-sm underline">
                  {i.reference} ({statusLabel(i.status)})
                </Link>
              ))}
            </Card>
          )}
          <Card title="Timeline">
            <Timeline items={w.timeline} />
          </Card>
          <KeyValue columns={1} items={[['Completion override', w.completionOverride ?? '—']]} />
        </div>
      </div>
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog === 'rework' ? 'Request rework' : dialog === 'override' ? 'Approve with override' : dialog === 'safety' ? 'Safety mitigation' : 'Change status'}
        footer={
          <Button
            busy={act.busy === 'dialog'}
            disabled={dialog !== 'transition' && !text.trim()}
            onClick={() =>
              act.run('dialog', async () => {
                if (dialog === 'rework') await post(`/work-orders/${w.id}/request-rework`, { reason: text });
                if (dialog === 'override') await post(`/work-orders/${w.id}/approve-completion`, { overrideReason: text });
                if (dialog === 'safety') await post(`/work-orders/${w.id}/safety-mitigation`, { note: text });
                if (dialog === 'transition') await post(`/work-orders/${w.id}/status-transitions`, { to, reason: text || null });
                setDialog(null);
                setText('');
                refresh();
              })
            }
          >
            Confirm
          </Button>
        }
      >
        <div className="space-y-3">
          {dialog === 'transition' && <SelectField label="New status" value={to} onChange={(e) => setTo(e.target.value)} options={targets.map((t) => ({ value: t, label: statusLabel(t) }))} />}
          <TextArea label={dialog === 'transition' ? 'Reason (optional)' : 'Details (audited)'} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </Modal>
      <Modal open={!!sheet} onClose={() => setSheet(null)} title="Job sheet" wide>
        {sheet && (
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted">{String(sheet.watermark)}</p>
            <p className="font-medium">{String(sheet.title)}</p>
            <p>{String(sheet.address)}</p>
            {sheet.accessNotes ? <p className="rounded bg-surface-2 p-2">Access: {String(sheet.accessNotes)}</p> : null}
            <p className="whitespace-pre-wrap">{String(sheet.scope)}</p>
            <ul className="list-disc pl-5">{(sheet.tasks as string[]).map((t) => <li key={t}>{t}</li>)}</ul>
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
