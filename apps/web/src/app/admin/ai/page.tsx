'use client';
import Link from 'next/link';
import { AI_FEATURES, type AiFeatureKey } from '@propcare/shared';
import { Alert, ErrorAlert, Loading, PageHeader, Stat, Table } from '@/components/ui';
import { useApi } from '@/lib/api';
import { dateLabel } from '@/lib/format';

interface Usage {
  since: string;
  provider: string;
  enabled: boolean;
  features: Array<{ featureKey: string; id: string; total: number; failed: number; accepted: number; edited: number; dismissed: number; acceptanceRate: number | null; avgLatencyMs: number | null; calls: number; inputTokens: number; outputTokens: number }>;
}

export default function AiUsage() {
  const { data, error, isLoading } = useApi<Usage>('/admin/ai/usage');
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorAlert error={error} />;
  const totals = data.features.reduce((t, f) => ({ calls: t.calls + f.calls, input: t.input + f.inputTokens, output: t.output + f.outputTokens, failed: t.failed + f.failed }), { calls: 0, input: 0, output: 0, failed: 0 });
  return (
    <>
      <PageHeader title="AI usage" subtitle={`Since ${dateLabel(data.since)} · provider ${data.provider}`} />
      {!data.enabled && (
        <div className="mb-4">
          <Alert tone="warn">AI is switched off. Every flow keeps working without it. Turn features on in <Link href="/admin/settings" className="underline">policy settings</Link> (ai.*).</Alert>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Calls" value={totals.calls} />
        <Stat label="Input tokens" value={totals.input.toLocaleString('en-IN')} />
        <Stat label="Output tokens" value={totals.output.toLocaleString('en-IN')} />
        <Stat label="Failures" value={totals.failed} tone={totals.failed ? 'warn' : undefined} />
      </div>
      <Table
        head={['Feature', 'Suggestions', 'Accepted / edited', 'Dismissed', 'Acceptance', 'Avg latency', 'Tokens in / out']}
        rows={data.features.map((f) => [
          <span key="f" className="font-medium">
            {AI_FEATURES[f.featureKey as AiFeatureKey]?.label ?? f.featureKey}
            <span className="block text-xs font-normal text-muted">{f.id}</span>
          </span>,
          `${f.total}${f.failed ? ` (${f.failed} failed)` : ''}`,
          `${f.accepted} / ${f.edited}`,
          f.dismissed,
          f.acceptanceRate === null ? '—' : `${f.acceptanceRate}%`,
          f.avgLatencyMs === null ? '—' : `${(f.avgLatencyMs / 1000).toFixed(1)}s`,
          `${f.inputTokens.toLocaleString('en-IN')} / ${f.outputTokens.toLocaleString('en-IN')}`,
        ])}
      />
    </>
  );
}
