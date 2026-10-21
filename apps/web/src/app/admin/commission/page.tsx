'use client';
import { useState } from 'react';
import { BENCHMARK_MODES } from '@propcare/shared';
import { AiPanel } from '@/components/shared';
import { Alert, Button, Card, Checkbox, ErrorAlert, Form, KeyValue, Loading, PageHeader, SelectField, Stat, Table, TextField } from '@/components/ui';
import { patch, post, put, useApi } from '@/lib/api';
import { dateLabel, dateTimeLabel, pct, todayIst } from '@/lib/format';
import { useAction } from '@/lib/use-action';

interface Benchmark {
  id: string;
  platformName: string;
  commissionBps: number;
  note: string | null;
  sourceUrl: string | null;
  asOfDate: string;
  enabled: boolean;
}

interface Settings {
  benchmarkMode: string;
  specificBenchmarkId?: string | null;
  undercutMode: string;
  undercutBps: number;
  floorBps: number;
  ceilingBps: number;
}

interface Effective {
  benchmarkBps: number | null;
  effectiveBps: number;
  source: string;
  settings: Settings;
}

export default function Commission() {
  const benchmarks = useApi<{ items: Benchmark[] }>('/admin/commission-benchmarks');
  const effective = useApi<{ current: Effective; history: Array<{ id: string; benchmarkBps: number | null; effectiveBps: number; reason: string; createdAt: string }> }>('/admin/commission/effective');
  const [nb, setNb] = useState({ platformName: '', pct: '', sourceUrl: '', asOfDate: todayIst() });
  const [s, setS] = useState<Settings | null>(null);
  const { busy, error, run } = useAction();
  if (benchmarks.isLoading || effective.isLoading) return <Loading />;
  const cur = effective.data?.current;
  const settings = s ?? cur?.settings ?? null;
  const refresh = async () => {
    await benchmarks.mutate();
    await effective.mutate();
  };
  return (
    <>
      <PageHeader title="Commission" subtitle="Stays commission is computed from public benchmarks: lower than the benchmark, within a floor and ceiling. Changes apply to new bookings only." />
      <ErrorAlert error={error ?? benchmarks.error ?? effective.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Effective commission" value={pct(cur?.effectiveBps)} />
        <Stat label="Benchmark used" value={pct(cur?.benchmarkBps)} hint={cur?.settings.benchmarkMode} />
        <Stat label="Source" value={cur?.source === 'NO_BENCHMARK_FALLBACK' ? 'Ceiling (no benchmark)' : 'Computed'} tone={cur?.source === 'NO_BENCHMARK_FALLBACK' ? 'warn' : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Benchmarks">
          <Table
            head={['Platform', 'Rate', 'As of', 'Enabled']}
            rows={(benchmarks.data?.items ?? []).map((b) => [
              <span key="p">
                {b.platformName}
                {b.sourceUrl && (
                  <a href={b.sourceUrl} target="_blank" rel="noreferrer noopener" className="ml-1 text-xs underline">
                    source
                  </a>
                )}
              </span>,
              pct(b.commissionBps),
              dateLabel(b.asOfDate),
              <Checkbox key="e" label={b.enabled ? 'On' : 'Off'} checked={b.enabled} onChange={(e) => run(b.id, async () => { await patch(`/admin/commission-benchmarks/${b.id}`, { enabled: e.target.checked }); await refresh(); })} />,
            ])}
          />
          <Form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={() =>
              run('add', async () => {
                await post('/admin/commission-benchmarks', { platformName: nb.platformName, commissionBps: Math.round(Number(nb.pct) * 100), sourceUrl: nb.sourceUrl || null, asOfDate: nb.asOfDate, enabled: true });
                setNb({ platformName: '', pct: '', sourceUrl: '', asOfDate: todayIst() });
                await refresh();
              })
            }
          >
            <TextField label="Platform" required maxLength={80} value={nb.platformName} onChange={(e) => setNb({ ...nb, platformName: e.target.value })} />
            <TextField label="Commission %" required type="number" min={0} max={100} step="0.01" value={nb.pct} onChange={(e) => setNb({ ...nb, pct: e.target.value })} />
            <TextField label="Source URL" type="url" value={nb.sourceUrl} onChange={(e) => setNb({ ...nb, sourceUrl: e.target.value })} />
            <TextField label="As of" type="date" required value={nb.asOfDate} onChange={(e) => setNb({ ...nb, asOfDate: e.target.value })} />
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary" busy={busy === 'add'}>
                Add benchmark
              </Button>
            </div>
          </Form>
        </Card>
        {settings && (
          <Card title="Rules">
            <Alert tone="warn" title="Unconfirmed defaults">
              Floor, ceiling and undercut values are placeholders until the business confirms them.
            </Alert>
            <Form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={() => run('settings', async () => { await put('/admin/commission/settings', { ...settings, specificBenchmarkId: settings.specificBenchmarkId ?? null }); setS(null); await refresh(); })}>
              <SelectField label="Combine benchmarks by" value={settings.benchmarkMode} onChange={(e) => setS({ ...settings, benchmarkMode: e.target.value })} options={BENCHMARK_MODES.map((m) => ({ value: m, label: { MIN: 'Lowest', AVG: 'Average', MAX: 'Highest', SPECIFIC: 'One specific benchmark' }[m] }))} />
              {settings.benchmarkMode === 'SPECIFIC' ? (
                <SelectField label="Benchmark" value={settings.specificBenchmarkId ?? ''} placeholder="Choose…" onChange={(e) => setS({ ...settings, specificBenchmarkId: e.target.value || null })} options={(benchmarks.data?.items ?? []).map((b) => ({ value: b.id, label: b.platformName }))} />
              ) : (
                <div />
              )}
              <SelectField label="Undercut as" value={settings.undercutMode} onChange={(e) => setS({ ...settings, undercutMode: e.target.value })} options={[{ value: 'RELATIVE', label: '% lower than benchmark' }, { value: 'POINTS', label: 'Percentage points lower' }]} />
              <TextField label={settings.undercutMode === 'RELATIVE' ? 'Undercut (% of benchmark)' : 'Undercut (points)'} type="number" min={0} max={100} step="0.01" value={settings.undercutBps / 100} onChange={(e) => setS({ ...settings, undercutBps: Math.round(Number(e.target.value) * 100) })} />
              <TextField label="Floor %" type="number" min={0} max={100} step="0.01" value={settings.floorBps / 100} onChange={(e) => setS({ ...settings, floorBps: Math.round(Number(e.target.value) * 100) })} />
              <TextField label="Ceiling %" type="number" min={0} max={100} step="0.01" value={settings.ceilingBps / 100} onChange={(e) => setS({ ...settings, ceilingBps: Math.round(Number(e.target.value) * 100) })} />
              <div className="sm:col-span-2">
                <Button type="submit" busy={busy === 'settings'} disabled={!s}>
                  Save rules
                </Button>
              </div>
            </Form>
          </Card>
        )}
        <Card title="Rate history">
          <ul className="space-y-1 text-sm">
            {effective.data?.history.map((h) => (
              <li key={h.id} className="flex justify-between gap-2">
                <span>
                  {pct(h.effectiveBps)} <span className="text-muted">(benchmark {pct(h.benchmarkBps)})</span>
                </span>
                <span className="text-muted">
                  {h.reason} · {dateTimeLabel(h.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <AiPanel<{ observations: string[]; suggestions: string[] }> feature="commission_insights" title="Commission insights" autoload={false}>
          {(o) => (
            <div className="space-y-2">
              <KeyValue columns={1} items={[['Observations', <ul key="o" className="list-disc pl-5">{o.observations.map((x) => <li key={x}>{x}</li>)}</ul>], ['Ideas', <ul key="s" className="list-disc pl-5">{o.suggestions.map((x) => <li key={x}>{x}</li>)}</ul>]]} />
            </div>
          )}
        </AiPanel>
      </div>
    </>
  );
}
