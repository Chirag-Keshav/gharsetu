/** Indian mobile numbers (SPEC §8.1): normalise to E.164 and reject anything non-Indian. */

const INDIAN_MOBILE_E164 = /^\+91[6-9]\d{9}$/;

export function normaliseIndianPhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;
  let national: string;
  if (hasPlus) {
    if (!digits.startsWith('91') || digits.length !== 12) return null;
    national = digits.slice(2);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    national = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  } else {
    return null;
  }
  const e164 = `+91${national}`;
  return INDIAN_MOBILE_E164.test(e164) ? e164 : null;
}

export function isIndianMobileE164(value: string): boolean {
  return INDIAN_MOBILE_E164.test(value);
}

/** "+919876543210" → "+91 ••••••3210". Safe for logs and pre-confirmation displays. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  return `${e164.slice(0, 3)} ••••••${e164.slice(-4)}`;
}
