import { dateToIso } from '@propcare/shared';

/** BigInt paise → number (amounts are far below 2^53). */
export function num(v: bigint | number | null | undefined): number;
export function num(v: bigint | number | null | undefined, nullable: true): number | null;
export function num(v: bigint | number | null | undefined, nullable = false): number | null {
  if (v === null || v === undefined) return nullable ? null : 0;
  return typeof v === 'bigint' ? Number(v) : v;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const isoDay = (d: Date | null | undefined): string | null => (d ? dateToIso(d) : null);

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Keyset pagination on (createdAt, id) descending. Cursor is opaque base64url JSON.
 */
export function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { c: string; i: string };
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime()) || typeof parsed.i !== 'string') return null;
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ c: row.createdAt.toISOString(), i: row.id })).toString('base64url');
}

/** Prisma `where` fragment for rows after the cursor in (createdAt desc, id desc) order. */
export function afterCursor(cursor: string | undefined) {
  const c = decodeCursor(cursor);
  if (!c) return {};
  return { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] };
}

export const pageOrder = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

export function toPage<R extends { createdAt: Date; id: string }, T>(rows: R[], limit: number, map: (r: R) => T): Page<T> {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return { items: slice.map(map), nextCursor: hasMore ? encodeCursor(slice[slice.length - 1]) : null };
}
