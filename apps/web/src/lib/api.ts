'use client';
/**
 * Browser API client. Requests go to the same origin (/api is proxied), carry the CSRF token, and
 * mutating calls can send an Idempotency-Key (SPEC §7 rule 22, §12.9).
 */
import useSWR, { type SWRConfiguration } from 'swr';
import { statusLabel } from '@propcare/shared';

export interface ApiErrorDetail {
  path?: string;
  code?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
  }
}

function cookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

let csrfPromise: Promise<void> | null = null;
async function csrf(): Promise<string> {
  if (!cookie('csrf_token')) {
    csrfPromise ??= fetch('/api/v1/auth/csrf', { credentials: 'same-origin' }).then(() => undefined);
    await csrfPromise;
    csrfPromise = null;
  }
  return cookie('csrf_token') ?? '';
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** true → a fresh key; string → that key (reuse it on retries of the same action). */
  idempotency?: boolean | string;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = await csrf();
  if (opts.idempotency) headers['idempotency-key'] = typeof opts.idempotency === 'string' ? opts.idempotency : newIdempotencyKey();
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'You appear to be offline. Check your connection and try again.');
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'INTERNAL', err.message ?? 'Something went wrong.', err.details ?? []);
  }
  return json as T;
}

export const post = <T = unknown>(path: string, body: unknown = {}, idempotency?: boolean | string) => api<T>(path, { method: 'POST', body, idempotency });
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' });

export function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, (p: string) => api<T>(p), { revalidateOnFocus: false, shouldRetryOnError: false, ...config });
}

/** Human message for an API error, including field-level detail messages. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const extra = err.details
      .map((d) => {
        const code = d.code ? statusLabel(d.code.replace(/:.*/, '')) : '';
        // Short machine messages (e.g. "0/1") read better next to the code they qualify.
        if (d.message && d.message.length > 12) return d.message;
        return [code || d.path, d.message].filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .join(' · ');
    return extra ? `${err.message} ${extra}` : err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** Upload with progress: presign → signed PUT (XHR for progress events) → complete. */
export async function uploadFile(
  file: File,
  opts: { ownerType: string; ownerId?: string; evidencePhase?: string },
  onProgress?: (fraction: number) => void,
): Promise<{ id: string; filename: string; mimeType: string }> {
  const presign = await post<{ attachmentId: string; upload: { url: string; method: 'PUT'; headers: Record<string, string> } }>('/uploads/presign', {
    ownerType: opts.ownerType,
    ownerId: opts.ownerId,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    evidencePhase: opts.evidencePhase,
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presign.upload.url);
    for (const [k, v] of Object.entries(presign.upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'UPLOAD_FAILED', 'Upload failed. Please retry.')));
    xhr.onerror = () => reject(new ApiError(0, 'UPLOAD_FAILED', 'Upload failed. Check your connection and retry.'));
    xhr.send(file);
  });
  const done = await post<{ id: string; filename: string; mimeType: string }>('/attachments/complete', { attachmentId: presign.attachmentId });
  return done;
}

export async function openAttachment(id: string) {
  const { url } = await api<{ url: string }>(`/attachments/${id}/download-url`);
  window.open(url, '_blank', 'noopener');
}
