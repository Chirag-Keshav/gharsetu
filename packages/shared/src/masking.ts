/**
 * Deterministic contact-detail masking for pre-confirmation booking threads (SPEC §7 rule 20).
 * Also reused by the AI redactor for phones, e-mails and URLs.
 */

export const MASK_TOKEN = '[contact details hidden]';

const EMAIL_RE = /[A-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[A-Z0-9.-]+\s*(?:\.|\(dot\)|\[dot\])\s*[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const BARE_DOMAIN_RE =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|in|net|org|co|io|me|app|info|biz|link|ly|gl|page|site|xyz|online|store)\b(?:\/[^\s]*)?/gi;
// Ten or more digits, optionally with +, spaces, dots, hyphens or brackets between them. Dates such as
// 2026-11-12 (eight digits) are deliberately not matched.
const PHONE_RE = /(?:\+\s*)?(?:\d[\s\-.()]{0,3}){9,}\d/g;

export type MaskHit = 'EMAIL' | 'URL' | 'PHONE';

export interface MaskResult {
  text: string;
  masked: boolean;
  hits: MaskHit[];
}

export function maskContactDetails(input: string, token: string = MASK_TOKEN): MaskResult {
  const hits: MaskHit[] = [];
  let text = input.replace(EMAIL_RE, () => {
    hits.push('EMAIL');
    return token;
  });
  text = text.replace(URL_RE, () => {
    hits.push('URL');
    return token;
  });
  text = text.replace(BARE_DOMAIN_RE, () => {
    hits.push('URL');
    return token;
  });
  text = text.replace(PHONE_RE, () => {
    hits.push('PHONE');
    return token;
  });
  return { text, masked: hits.length > 0, hits };
}

/** Coordinates such as "15.4909, 73.8278" (used by the AI redactor). */
export const COORDINATE_RE = /-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/g;
/** Indian PIN codes (6 digits starting 1-9). */
export const PIN_CODE_RE = /\b[1-9]\d{5}\b/g;
