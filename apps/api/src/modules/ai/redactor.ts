/**
 * Redactor (SPEC §8.11 principle 4). Applied to every AI context after the allow-list: removes
 * phone numbers, e-mail addresses, URLs, coordinates, PIN codes and any known sensitive values
 * (exact address lines, access notes, people's names) before anything leaves the system.
 */
import { COORDINATE_RE, maskContactDetails, PIN_CODE_RE } from '@propcare/shared';

export const REDACTED = '[redacted]';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export class Redactor {
  private readonly known: string[];

  /** `knownSecrets` are exact values that must never appear (addresses, access notes, names). */
  constructor(knownSecrets: Array<string | null | undefined> = []) {
    this.known = [
      ...new Set(
        knownSecrets
          .flatMap((s) => (s ? [s, ...s.split(/[\n,]+/)] : []))
          .map((s) => s.trim())
          .filter((s) => s.length >= 4),
      ),
    ].sort((a, b) => b.length - a.length);
  }

  text(input: string): string {
    // Opaque identifiers and timestamps carry no personal data and must reach the model intact.
    if (UUID_RE.test(input) || ISO_DATE_RE.test(input)) return input;
    let out = input;
    for (const secret of this.known) {
      if (out.toLowerCase().includes(secret.toLowerCase())) {
        out = out.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), REDACTED);
      }
    }
    out = out.replace(COORDINATE_RE, REDACTED);
    out = maskContactDetails(out, REDACTED).text;
    out = out.replace(PIN_CODE_RE, REDACTED);
    return out;
  }

  /** Deep-redacts every string value of a JSON-like object. */
  value<T>(input: T): T {
    if (typeof input === 'string') return this.text(input) as unknown as T;
    if (Array.isArray(input)) return input.map((v) => this.value(v)) as unknown as T;
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, this.value(v)])) as T;
    }
    return input;
  }
}
