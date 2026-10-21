/**
 * Structured JSON logger. Callers pass identifiers only — never OTPs, session IDs, access notes,
 * full phone numbers, payment payloads or document content (SPEC §0.3 rule 6, §14.5).
 */
import { requestStore } from './context';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel: Level = (process.env.LOG_LEVEL as Level) || 'info';
let silent = process.env.NODE_ENV === 'test';

export function configureLogger(opts: { level?: Level; silent?: boolean }): void {
  if (opts.level) minLevel = opts.level;
  if (opts.silent !== undefined) silent = opts.silent;
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (silent || ORDER[level] < ORDER[minLevel]) return;
  const store = requestStore.getStore();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(store ? { requestId: store.requestId } : {}),
    ...fields,
  });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.name, errorMessage: err.message.slice(0, 500) };
  return { error: String(err).slice(0, 200) };
}
