'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AI_LABEL } from '@propcare/shared';
import { ApiError, describeError, openAttachment, post, uploadFile, useApi } from '@/lib/api';
import { ago, dateTimeLabel } from '@/lib/format';
import { Alert, Badge, Button, Card, Checkbox, cx, ErrorAlert, Form, Loading } from './ui';

// --- messages ------------------------------------------------------------------------------------------
interface Message {
  id: string;
  body: string;
  masked: boolean;
  visibility: 'PARTICIPANT' | 'INTERNAL';
  authorRole: string | null;
  authorName: string | null;
  mine: boolean;
  createdAt: string;
  attachments: Array<{ id: string; filename: string; mimeType: string }>;
}

export function MessageThread({
  path,
  postPath,
  title = 'Messages',
  allowInternal = false,
  maskingNotice,
  attachOwnerType,
  onPosted,
  disabled,
}: {
  path: string;
  postPath?: string;
  title?: string;
  allowInternal?: boolean;
  maskingNotice?: boolean;
  attachOwnerType?: 'MESSAGE';
  onPosted?: () => void;
  disabled?: string;
}) {
  const { data, error, isLoading, mutate } = useApi<{ items: Message[] }>(path, { refreshInterval: 20_000 });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<Array<{ id: string; filename: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);

  return (
    <Card title={title} padded={false}>
      <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
        {isLoading && <Loading />}
        {error && <ErrorAlert error={error} />}
        {data?.items.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
        {data?.items.map((m) => (
          <div key={m.id} className={cx('max-w-[85%] rounded-xl px-3 py-2 text-sm', m.mine ? 'ml-auto bg-brand-soft' : 'bg-surface-2', m.visibility === 'INTERNAL' && 'border border-dashed border-warn bg-warn-soft')}>
            <p className="text-xs text-muted">
              {m.mine ? 'You' : m.authorRole === 'ADMIN' ? (m.authorName ?? 'Care team') : (m.authorName ?? m.authorRole?.toLowerCase())}
              {m.visibility === 'INTERNAL' && ' · internal note'} · <time dateTime={m.createdAt} title={dateTimeLabel(m.createdAt)}>{ago(m.createdAt)}</time>
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words">{m.body}</p>
            {m.masked && <p className="mt-1 text-xs text-muted">Contact details are hidden until the booking is confirmed.</p>}
            {m.attachments.map((a) => (
              <button key={a.id} type="button" onClick={() => openAttachment(a.id)} className="mt-1 block text-xs font-medium text-brand underline">
                📎 {a.filename}
              </button>
            ))}
          </div>
        ))}
      </div>
      {disabled ? (
        <p className="border-t border-line p-4 text-sm text-muted">{disabled}</p>
      ) : (
        <Form
          className="space-y-2 border-t border-line p-4"
          onSubmit={async () => {
            setBusy(true);
            setSendError(null);
            try {
              await post(postPath ?? path, { body, visibility: internal ? 'INTERNAL' : 'PARTICIPANT', ...(attachOwnerType ? { attachmentIds: files.map((f) => f.id) } : {}) });
              setBody('');
              setFiles([]);
              await mutate();
              onPosted?.();
            } catch (e) {
              setSendError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {maskingNotice && <p className="text-xs text-muted">Phone numbers, e-mail addresses and links are hidden until the booking is confirmed. Keep payments on the platform.</p>}
          <label htmlFor={`${path}-body`} className="sr-only">
            Message
          </label>
          <textarea id={`${path}-body`} required value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Write a message…" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          {attachOwnerType && <FileUploader ownerType={attachOwnerType} onChange={setFiles} compact />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {allowInternal ? <Checkbox label="Internal note (admins only)" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> : <span />}
            <Button type="submit" busy={busy} size="sm">
              Send
            </Button>
          </div>
          <ErrorAlert error={sendError} />
        </Form>
      )}
    </Card>
  );
}

// --- uploads ------------------------------------------------------------------------------------------
interface UploadItem {
  key: string;
  file: File;
  progress: number;
  id?: string;
  error?: string;
}

/** Multi-file upload with per-file progress and retry. Reports completed attachment ids. */
export function FileUploader({
  ownerType,
  ownerId,
  evidencePhase,
  accept = 'image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime',
  max = 10,
  onChange,
  compact,
  label = 'Add photos or videos',
}: {
  ownerType: string;
  ownerId?: string;
  evidencePhase?: string;
  accept?: string;
  max?: number;
  onChange: (files: Array<{ id: string; filename: string }>) => void;
  compact?: boolean;
  label?: string;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    onChangeRef.current(items.filter((i) => i.id).map((i) => ({ id: i.id!, filename: i.file.name })));
  }, [items]);

  const start = async (item: UploadItem) => {
    setItems((list) => list.map((i) => (i.key === item.key ? { ...i, error: undefined, progress: 0 } : i)));
    try {
      const res = await uploadFile(item.file, { ownerType, ownerId, evidencePhase }, (p) => setItems((list) => list.map((i) => (i.key === item.key ? { ...i, progress: p } : i))));
      setItems((list) => list.map((i) => (i.key === item.key ? { ...i, id: res.id, progress: 1 } : i)));
    } catch (e) {
      setItems((list) => list.map((i) => (i.key === item.key ? { ...i, error: describeError(e) } : i)));
    }
  };

  return (
    <div>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].slice(0, Math.max(0, max - items.length));
          const added = files.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, progress: 0 }));
          setItems((list) => [...list, ...added]);
          added.forEach(start);
          e.target.value = '';
        }}
      />
      <Button type="button" variant="secondary" size={compact ? 'sm' : 'md'} onClick={() => input.current?.click()} disabled={items.length >= max}>
        📎 {label}
      </Button>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{i.file.name}</span>
              {i.error ? (
                <>
                  <span className="text-xs text-danger">✕ {i.error}</span>
                  <button type="button" className="text-xs font-medium text-brand" onClick={() => start(i)}>
                    Retry
                  </button>
                </>
              ) : i.id ? (
                <span className="text-xs text-ok">✓ Uploaded</span>
              ) : (
                <progress value={i.progress} max={1} className="h-2 w-24" aria-label={`Uploading ${i.file.name}`} />
              )}
              <button type="button" aria-label={`Remove ${i.file.name}`} className="text-muted hover:text-danger" onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- AI suggestions --------------------------------------------------------------------------------------
export interface Suggestion<T = Record<string, unknown>> {
  id: string;
  featureKey: string;
  status: 'PENDING' | 'READY' | 'ACCEPTED' | 'EDITED' | 'DISMISSED' | 'FAILED';
  output: T | null;
  createdAt: string;
}

/**
 * AI suggestion panel (SPEC §8.11, §15.5): clearly labelled, editable and dismissible. Hidden when
 * the feature is off or the provider fails, so no core flow depends on it.
 */
export function AiPanel<T = Record<string, unknown>>({
  feature,
  subjectType,
  subjectId,
  params,
  title,
  autoload = true,
  children,
  onApply,
  applyLabel = 'Use this',
}: {
  feature: string;
  subjectType?: string;
  subjectId?: string;
  params?: Record<string, unknown>;
  title: string;
  autoload?: boolean;
  children: (output: T) => ReactNode;
  onApply?: (output: T) => void;
  applyLabel?: string;
}) {
  const status = useApi<{ enabled: boolean; features: Record<string, boolean> }>('/ai/status');
  const existing = useApi<{ items: Suggestion<T>[] }>(subjectType && subjectId ? `/ai/suggestions?subjectType=${subjectType}&subjectId=${subjectId}` : null);
  const [current, setCurrent] = useState<Suggestion<T> | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const enabled = status.data?.enabled && status.data.features[feature];

  useEffect(() => {
    const found = existing.data?.items.find((s) => s.featureKey === feature);
    if (found && !current) setCurrent(found);
  }, [existing.data, feature, current]);

  // Poll background suggestions until they finish.
  useEffect(() => {
    if (current?.status !== 'PENDING') return;
    const poll = setInterval(async () => {
      const res = await fetch(`/api/v1/ai/suggestions/${current.id}`, { credentials: 'same-origin' });
      if (res.ok) {
        const s = (await res.json()) as Suggestion<T>;
        if (s.status !== 'PENDING') setCurrent(s);
      }
    }, 1200);
    return () => clearInterval(poll);
  }, [current]);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      setCurrent(await post<Suggestion<T>>('/ai/suggestions', { featureKey: feature, subjectType, subjectId, params: params ?? {} }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AI_UNAVAILABLE') setHidden(true);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoload && enabled && existing.data && !existing.data.items.some((s) => s.featureKey === feature) && !current && !busy) void request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoload, enabled, existing.data]);

  const act = async (action: 'accept' | 'edit' | 'dismiss') => {
    if (!current) return;
    const updated = await post<Suggestion<T>>(`/ai/suggestions/${current.id}/${action}`, {});
    setCurrent(updated);
    if (action === 'dismiss') setHidden(true);
  };

  if (!enabled || hidden || current?.status === 'FAILED' || current?.status === 'DISMISSED') return null;
  return (
    <section className="rounded-xl border border-ai/30 bg-ai-soft/50 p-4" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden>✨</span> {title}
        </h3>
        <Badge tone="info" className="!border-ai/30 !bg-surface !text-ai">
          {AI_LABEL}
        </Badge>
      </div>
      <div className="mt-3 text-sm">
        {!current && !busy && (
          <Button variant="ai" size="sm" onClick={request}>
            Ask the assistant
          </Button>
        )}
        {(busy || current?.status === 'PENDING') && (
          <p className="text-muted" role="status">
            Thinking…
          </p>
        )}
        {current?.output && current.status !== 'PENDING' && children(current.output)}
        <ErrorAlert error={error} />
      </div>
      {current?.output && current.status !== 'PENDING' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onApply && current.status === 'READY' && (
            <Button
              size="sm"
              variant="ai"
              onClick={async () => {
                onApply(current.output as T);
                await act('edit');
              }}
            >
              {applyLabel}
            </Button>
          )}
          {current.status === 'READY' && (
            <Button size="sm" variant="secondary" onClick={() => act('accept')}>
              Helpful
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => act('dismiss')}>
            Dismiss
          </Button>
          {(current.status === 'ACCEPTED' || current.status === 'EDITED') && <span className="self-center text-xs text-muted">Thanks — feedback recorded.</span>}
          <Button size="sm" variant="ghost" onClick={request}>
            Refresh
          </Button>
        </div>
      )}
    </section>
  );
}

export function Timeline({ items }: { items: Array<{ from: string | null; to: string; actorRole: string; reason?: string | null; at: string }> }) {
  if (!items.length) return null;
  return (
    <ol className="space-y-3 border-l border-line pl-4 text-sm">
      {items.map((e, i) => (
        <li key={i} className="relative">
          <span aria-hidden className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
          <p className="font-medium">{e.to.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</p>
          <p className="text-xs text-muted">
            {dateTimeLabel(e.at)} · by {e.actorRole === 'ADMIN' ? 'our team' : e.actorRole.toLowerCase()}
            {e.reason ? ` · ${e.reason}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function SuccessNote({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <Alert tone="ok">{children}</Alert>;
}
