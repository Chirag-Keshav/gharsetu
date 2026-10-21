/**
 * Category intake schemas and danger rules (SPEC §9). Evaluated in the browser for guidance and
 * again on the server, which is authoritative.
 */
import { z } from 'zod';

export const INTAKE_FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'select', 'multiselect', 'date'] as const;

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const conditionSchema = z.object({ field: z.string(), equals: scalar });

export const intakeFieldSchema = z.preprocess(
  (raw) => {
    // Accept the snake_case `show_if` used in SPEC prose as an alias of `showIf`.
    if (raw && typeof raw === 'object' && 'show_if' in raw && !('showIf' in raw)) {
      const { show_if, ...rest } = raw as Record<string, unknown>;
      return { ...rest, showIf: show_if };
    }
    return raw;
  },
  z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1).max(200),
    type: z.enum(INTAKE_FIELD_TYPES),
    required: z.boolean().default(false),
    helpText: z.string().max(300).optional(),
    options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    showIf: conditionSchema.optional(),
  }),
);

export const dangerRuleSchema = z.object({
  when: conditionSchema,
  severity: z.literal('SAFETY_RISK'),
  guidanceKey: z.string().min(1),
});

export const intakeSchemaSchema = z.object({
  fields: z.array(intakeFieldSchema).max(40),
  dangerRules: z.array(dangerRuleSchema).default([]),
});

export type IntakeField = z.infer<typeof intakeFieldSchema>;
export type DangerRule = z.infer<typeof dangerRuleSchema>;
export type IntakeSchema = z.infer<typeof intakeSchemaSchema>;
export type IntakeAnswers = Record<string, unknown>;

function matches(answer: unknown, expected: string | number | boolean): boolean {
  if (Array.isArray(answer)) return answer.includes(expected);
  return answer === expected;
}

export function isFieldVisible(field: IntakeField, answers: IntakeAnswers): boolean {
  if (!field.showIf) return true;
  return matches(answers[field.showIf.field], field.showIf.equals);
}

export interface IntakeValidation {
  ok: boolean;
  errors: Array<{ field: string; code: 'REQUIRED' | 'INVALID_TYPE' | 'OUT_OF_RANGE' | 'INVALID_OPTION' }>;
  /** Answers restricted to known, visible fields. */
  cleaned: IntakeAnswers;
}

export function validateIntakeAnswers(schema: IntakeSchema, answers: IntakeAnswers): IntakeValidation {
  const errors: IntakeValidation['errors'] = [];
  const cleaned: IntakeAnswers = {};
  for (const field of schema.fields) {
    if (!isFieldVisible(field, answers)) continue;
    const value = answers[field.key];
    const empty =
      value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (field.required) errors.push({ field: field.key, code: 'REQUIRED' });
      continue;
    }
    const optionValues = field.options?.map((o) => o.value) ?? [];
    switch (field.type) {
      case 'text':
      case 'textarea':
        if (typeof value !== 'string' || value.length > (field.type === 'text' ? 300 : 3000)) {
          errors.push({ field: field.key, code: 'INVALID_TYPE' });
          continue;
        }
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push({ field: field.key, code: 'INVALID_TYPE' });
          continue;
        }
        if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
          errors.push({ field: field.key, code: 'OUT_OF_RANGE' });
          continue;
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({ field: field.key, code: 'INVALID_TYPE' });
          continue;
        }
        break;
      case 'select':
        if (typeof value !== 'string' || !optionValues.includes(value)) {
          errors.push({ field: field.key, code: 'INVALID_OPTION' });
          continue;
        }
        break;
      case 'multiselect':
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !optionValues.includes(v))) {
          errors.push({ field: field.key, code: 'INVALID_OPTION' });
          continue;
        }
        break;
      case 'date':
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors.push({ field: field.key, code: 'INVALID_TYPE' });
          continue;
        }
        break;
    }
    cleaned[field.key] = value;
  }
  return { ok: errors.length === 0, errors, cleaned };
}

export interface DangerEvaluation {
  safetyFlag: boolean;
  triggered: DangerRule[];
  guidanceKeys: string[];
}

/** Deterministic danger-rule evaluation (SPEC §7 rule 8); never delegated to AI. */
export function evaluateDangerRules(schema: IntakeSchema, answers: IntakeAnswers): DangerEvaluation {
  const triggered = schema.dangerRules.filter((rule) => matches(answers[rule.when.field], rule.when.equals));
  return {
    safetyFlag: triggered.length > 0,
    triggered,
    guidanceKeys: [...new Set(triggered.map((r) => r.guidanceKey))],
  };
}

// --- Checklists (SPEC §9.4) ---------------------------------------------------------------------
export const CHECKLIST_ITEM_TYPES = ['BOOLEAN', 'TEXT', 'NUMBER', 'PHOTO'] as const;

export const checklistItemSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(200),
  type: z.enum(CHECKLIST_ITEM_TYPES),
  required: z.boolean().default(false),
  minCount: z.number().int().min(1).max(20).optional(),
});
export const checklistTemplateSchema = z.object({ items: z.array(checklistItemSchema).max(50) });
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type ChecklistTemplate = z.infer<typeof checklistTemplateSchema>;

/** Minimum media per evidence phase, configured per category. */
export const requiredEvidenceSchema = z
  .object({
    BEFORE: z.number().int().min(0).max(20).default(0),
    DURING: z.number().int().min(0).max(20).default(0),
    AFTER: z.number().int().min(0).max(20).default(0),
  })
  .default({});
export type RequiredEvidence = z.infer<typeof requiredEvidenceSchema>;

export interface ChecklistResultLike {
  itemKey: string;
  result: unknown;
}

/** Returns the keys of mandatory checklist items that are not satisfied. */
export function missingChecklistItems(template: ChecklistTemplate, results: ChecklistResultLike[]): string[] {
  const latest = new Map<string, unknown>();
  for (const r of results) latest.set(r.itemKey, r.result);
  const missing: string[] = [];
  for (const item of template.items) {
    if (!item.required) continue;
    const value = latest.get(item.key);
    let ok: boolean;
    switch (item.type) {
      case 'BOOLEAN':
        ok = value === true;
        break;
      case 'TEXT':
        ok = typeof value === 'string' && value.trim().length > 0;
        break;
      case 'NUMBER':
        ok = typeof value === 'number' && Number.isFinite(value);
        break;
      case 'PHOTO':
        ok = Array.isArray(value) && value.length >= (item.minCount ?? 1);
        break;
    }
    if (!ok) missing.push(item.key);
  }
  return missing;
}

export function missingEvidence(
  required: RequiredEvidence,
  counts: Partial<Record<'BEFORE' | 'DURING' | 'AFTER', number>>,
): Array<{ phase: 'BEFORE' | 'DURING' | 'AFTER'; required: number; present: number }> {
  const phases = ['BEFORE', 'DURING', 'AFTER'] as const;
  return phases
    .map((phase) => ({ phase, required: required[phase] ?? 0, present: counts[phase] ?? 0 }))
    .filter((p) => p.present < p.required);
}
