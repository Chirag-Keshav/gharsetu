'use client';
import { useState } from 'react';
import { Badge, Button, ErrorAlert, Loading, PageHeader, cx } from '@/components/ui';
import { patch, useApi } from '@/lib/api';
import { dateTimeLabel } from '@/lib/format';
import { useMe } from '@/lib/session';
import { useAction } from '@/lib/use-action';

interface Setting {
  key: string;
  value: unknown;
  defaultValue: unknown;
  description: string;
  status: 'PLACEHOLDER' | 'POLICY_DEFAULT' | 'DECISION';
  unconfirmed: boolean;
  editFlag: string;
  updatedAt: string | null;
}

function Row({ s, canEdit, onSaved }: { s: Setting; canEdit: boolean; onSaved: () => void }) {
  const [text, setText] = useState(JSON.stringify(s.value));
  const { busy, error, run } = useAction();
  const dirty = text !== JSON.stringify(s.value);
  const editable = canEdit && (s.status !== 'DECISION' || s.key.startsWith('ai.'));
  return (
    <li className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_280px]">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-mono text-sm">
          {s.key}
          {s.unconfirmed && <Badge tone="warn">Unconfirmed placeholder</Badge>}
          {s.status === 'DECISION' && <Badge>Fixed decision</Badge>}
        </p>
        <p className="text-sm text-muted">{s.description}</p>
        <p className="text-xs text-muted">
          Default {JSON.stringify(s.defaultValue)} · edit needs {s.editFlag}
          {s.updatedAt && ` · changed ${dateTimeLabel(s.updatedAt)}`}
        </p>
      </div>
      <div className="flex items-start gap-2">
        <input
          aria-label={`Value for ${s.key}`}
          className={cx('min-w-0 flex-1 rounded-md border bg-surface px-2 py-1 font-mono text-sm', error ? 'border-danger' : 'border-line')}
          value={text}
          disabled={!editable}
          onChange={(e) => setText(e.target.value)}
        />
        {editable && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!dirty}
            busy={busy === 'save'}
            onClick={() =>
              run('save', async () => {
                let value: unknown;
                try {
                  value = JSON.parse(text);
                } catch {
                  throw new Error('Enter valid JSON, e.g. 24, true or "text".');
                }
                await patch(`/admin/policy-settings/${s.key}`, { value });
                onSaved();
              })
            }
          >
            Save
          </Button>
        )}
      </div>
      {error ? <div className="md:col-span-2"><ErrorAlert error={error} /></div> : null}
    </li>
  );
}

export default function Settings() {
  const { me } = useMe();
  const { data, error, isLoading, mutate } = useApi<{ items: Setting[] }>('/admin/policy-settings');
  const [filter, setFilter] = useState('');
  if (isLoading) return <Loading />;
  const groups = [...new Set(data?.items.map((s) => s.key.split('.')[0]))];
  return (
    <>
      <PageHeader title="Policy settings" subtitle="Values marked unconfirmed are placeholders until the business signs them off. Every change is audited." />
      <ErrorAlert error={error} />
      <input aria-label="Filter settings" placeholder="Filter…" className="mb-4 w-full max-w-sm rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {groups.map((g) => {
        const items = data!.items.filter((s) => s.key.startsWith(`${g}.`) && s.key.includes(filter));
        if (!items.length) return null;
        return (
          <section key={g} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g.replace(/_/g, ' ')}</h2>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {items.map((s) => (
                <Row key={`${s.key}:${JSON.stringify(s.value)}`} s={s} canEdit={!!me?.flags.includes(s.editFlag)} onSaved={() => mutate()} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
