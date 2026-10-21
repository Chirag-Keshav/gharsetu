/**
 * Brand configuration (SPEC §0.2). The product name is configuration, never code: every UI string
 * and notification template interpolates `{{productName}}` from here.
 *
 * This file holds the only permitted copy of the default product name.
 */
export interface BrandConfig {
  productName: string;
  legalEntityName: string;
  supportEmail: string;
  supportPhone: string;
}

const DEFAULT_PRODUCT_NAME = 'Gharsetu';

type EnvLike = Record<string, string | undefined>;

export function brandFromEnv(env: EnvLike): BrandConfig {
  const pick = (key: string) => env[key] || env[`NEXT_PUBLIC_${key}`] || undefined;
  return {
    productName: pick('PRODUCT_NAME') ?? DEFAULT_PRODUCT_NAME,
    legalEntityName: pick('LEGAL_ENTITY_NAME') ?? 'Operator legal entity (placeholder)',
    supportEmail: pick('SUPPORT_EMAIL') ?? 'support@example.invalid',
    supportPhone: pick('SUPPORT_PHONE') ?? '+91 00000 00000',
  };
}

/** Replaces `{{name}}` placeholders. Unknown placeholders are left in place so gaps are visible. */
export function interpolate(template: string, params: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}
