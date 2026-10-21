'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { evaluateDangerRules, guidanceMessages, modeIncludesCare, statusLabel, URGENCIES, type IntakeAnswers, type IntakeSchema } from '@propcare/shared';
import { IntakeFields } from '@/components/intake-fields';
import { AiPanel, FileUploader } from '@/components/shared';
import { Alert, Button, Card, Checkbox, ErrorAlert, Form, Loading, PageHeader, SelectField, TextArea, TextField, cx } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { fromLocalInput } from '@/lib/format';
import { useAction } from '@/lib/use-action';
import type { PropertySummary } from '../../page';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  inspectionUsuallyRequired: boolean;
  safetyNotes: string | null;
  intakeSchema: IntakeSchema;
  available?: boolean;
}

interface AssistantOutput {
  categorySlug: string | null;
  title: string;
  intakeAnswers: IntakeAnswers;
  suggestedUrgency: string;
  notes: string | null;
}

function NewRequest() {
  const router = useRouter();
  const sp = useSearchParams();
  const props = useApi<{ items: PropertySummary[] }>('/properties');
  const careProps = props.data?.items.filter((p) => modeIncludesCare(p.serviceMode)) ?? [];
  const [propertyId, setPropertyId] = useState(sp.get('propertyId') ?? '');
  const pid = propertyId || careProps[0]?.id || '';
  const cats = useApi<{ items: Category[] }>(pid ? `/service-categories?propertyId=${pid}` : null);
  const contacts = useApi<{ contacts: Array<{ id: string; name: string; relationship: string }> }>(pid ? `/properties/${pid}` : null);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [answers, setAnswers] = useState<IntakeAnswers>({});
  const [urgency, setUrgency] = useState<string>('STANDARD');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [contactId, setContactId] = useState('');
  const [ack, setAck] = useState(false);
  const [files, setFiles] = useState<Array<{ id: string }>>([]);
  const [assistText, setAssistText] = useState('');
  const [assistKey, setAssistKey] = useState(0);
  const { busy, error, run } = useAction();

  const category = cats.data?.items.find((c) => c.id === categoryId);
  const danger = useMemo(() => (category ? evaluateDangerRules(category.intakeSchema, answers) : null), [category, answers]);

  const applyAssistant = (o: AssistantOutput) => {
    const match = cats.data?.items.find((c) => c.slug === o.categorySlug && c.available !== false);
    if (match) setCategoryId(match.id);
    setTitle(o.title);
    setAnswers(o.intakeAnswers);
    if (!description) setDescription(assistText);
    if ((URGENCIES as readonly string[]).indexOf(o.suggestedUrgency) > (URGENCIES as readonly string[]).indexOf(urgency)) setUrgency(o.suggestedUrgency);
  };

  if (props.isLoading) return <Loading />;
  if (!careProps.length) return <Alert tone="info">None of your properties have care turned on. Change a property’s service to request maintenance.</Alert>;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New service request" back={{ href: '/owner', label: 'Dashboard' }} subtitle="You approve a written quote before any paid work starts." />
      <Form
        className="space-y-6"
        onSubmit={() =>
          run('submit', async () => {
            const r = await post<{ id: string }>(
              '/service-requests',
              {
                propertyId: pid,
                categoryId,
                title,
                description,
                intakeAnswers: answers,
                urgency,
                preferredWindows: windowStart && windowEnd ? [{ start: fromLocalInput(windowStart), end: fromLocalInput(windowEnd) }] : [],
                attachmentIds: files.map((f) => f.id),
                accessContactId: contactId || null,
                ...(category?.inspectionUsuallyRequired ? { inspectionFeeAcknowledged: ack } : {}),
              },
              true,
            );
            router.push(`/owner/requests/${r.id}?created=1`);
          })
        }
      >
        <Card title="Where and what">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Property" required value={pid} onChange={(e) => { setPropertyId(e.target.value); setCategoryId(''); }} options={careProps.map((p) => ({ value: p.id, label: `${p.nickname} · ${p.city}` }))} />
            <SelectField
              label="Type of work"
              required
              value={categoryId}
              placeholder="Choose…"
              onChange={(e) => { setCategoryId(e.target.value); setAnswers({}); }}
              options={(cats.data?.items ?? []).filter((c) => c.available !== false).map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
          {cats.data && cats.data.items.some((c) => c.available === false) && <p className="mt-2 text-xs text-muted">Some services are not yet offered in this area.</p>}
          <div className="mt-4 space-y-2 rounded-lg border border-ai/30 bg-ai-soft/40 p-3">
            <TextArea label="Not sure? Describe the problem in your own words" rows={2} maxLength={3000} value={assistText} onChange={(e) => setAssistText(e.target.value)} />
            {assistText.trim().length >= 10 && (
              <AiPanel<AssistantOutput>
                key={assistKey}
                feature="request_assistant"
                subjectType="PROPERTY"
                subjectId={pid}
                params={{ text: assistText }}
                title="Request assistant"
                autoload={false}
                applyLabel="Fill the form"
                onApply={(o) => { applyAssistant(o); setAssistKey((k) => k + 1); }}
              >
                {(o) => (
                  <div className="space-y-1">
                    <p>
                      Looks like <strong>{cats.data?.items.find((c) => c.slug === o.categorySlug)?.name ?? 'a general job'}</strong>: “{o.title}”.
                    </p>
                    {o.suggestedUrgency !== 'STANDARD' && <p>Suggested urgency: {statusLabel(o.suggestedUrgency)}</p>}
                    {o.notes && <p className="text-muted">{o.notes}</p>}
                  </div>
                )}
              </AiPanel>
            )}
          </div>
        </Card>

        {category && (
          <Card title={category.name}>
            {category.description && <p className="mb-3 text-sm text-muted">{category.description}</p>}
            <div className="space-y-4">
              <TextField label="Short title" required maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bathroom tap leaking" />
              <TextArea label="Describe the problem" required minLength={10} maxLength={5000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} invalidMessage="Describe the problem in at least 10 characters." />
              <IntakeFields schema={category.intakeSchema} answers={answers} onChange={setAnswers} />
            </div>
          </Card>
        )}

        {danger?.safetyFlag && (
          <Alert tone="danger" title="This may be unsafe">
            <ul className="space-y-1">
              {danger.guidanceKeys.map((k) => (
                <li key={k}>{guidanceMessages[k] ?? k}</li>
              ))}
            </ul>
            <p className="mt-2 font-medium">We will treat this as a safety risk and prioritise it.</p>
          </Alert>
        )}

        {category && (
          <Card title="Timing, access and photos">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Urgency"
                value={danger?.safetyFlag ? 'SAFETY_RISK' : urgency}
                disabled={danger?.safetyFlag}
                onChange={(e) => setUrgency(e.target.value)}
                options={URGENCIES.map((u) => ({ value: u, label: statusLabel(u) }))}
              />
              <SelectField label="Who will give access?" value={contactId} placeholder="I will arrange access" onChange={(e) => setContactId(e.target.value)} options={(contacts.data?.contacts ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.relationship})` }))} />
              <TextField label="Preferred window starts" type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              <TextField label="Preferred window ends" type="datetime-local" min={windowStart} value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            </div>
            <div className="mt-4">
              <FileUploader ownerType="REQUEST" onChange={setFiles} label="Add photos or a short video" />
            </div>
            {category.inspectionUsuallyRequired && (
              <div className={cx('mt-4 rounded-lg border p-3', ack ? 'border-line' : 'border-warn/40 bg-warn-soft')}>
                <Checkbox required label="I understand this kind of work usually needs an inspection visit first, which may carry a fee shown before it is booked." checked={ack} onChange={(e) => setAck(e.target.checked)} />
              </div>
            )}
          </Card>
        )}

        <ErrorAlert error={error} />
        <div className="flex justify-end">
          <Button type="submit" size="lg" busy={busy === 'submit'} disabled={!category}>
            Submit request
          </Button>
        </div>
      </Form>
    </div>
  );
}

export default function NewRequestPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewRequest />
    </Suspense>
  );
}
