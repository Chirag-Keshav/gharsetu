'use client';
import { isFieldVisible, type IntakeAnswers, type IntakeSchema } from '@propcare/shared';
import { Checkbox, SelectField, TextArea, TextField } from './ui';

/** Renders a category intake schema (SPEC §9). Hidden fields are skipped; the server re-validates. */
export function IntakeFields({ schema, answers, onChange }: { schema: IntakeSchema; answers: IntakeAnswers; onChange: (a: IntakeAnswers) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...answers, [key]: value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {schema.fields
        .filter((f) => isFieldVisible(f, answers))
        .map((f) => {
          const common = { label: f.label, hint: f.helpText, required: f.required };
          const value = answers[f.key];
          switch (f.type) {
            case 'textarea':
              return <TextArea key={f.key} className="sm:col-span-2" {...common} rows={3} value={(value as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} />;
            case 'number':
              return <TextField key={f.key} {...common} type="number" min={f.min} max={f.max} value={value === undefined ? '' : String(value)} onChange={(e) => set(f.key, e.target.value === '' ? undefined : Number(e.target.value))} />;
            case 'date':
              return <TextField key={f.key} {...common} type="date" value={(value as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} />;
            case 'boolean':
              return (
                <SelectField
                  key={f.key}
                  {...common}
                  value={value === undefined ? '' : value ? 'yes' : 'no'}
                  placeholder="Choose…"
                  onChange={(e) => set(f.key, e.target.value === '' ? undefined : e.target.value === 'yes')}
                  options={[
                    { value: 'yes', label: 'Yes' },
                    { value: 'no', label: 'No' },
                  ]}
                />
              );
            case 'select':
              return <SelectField key={f.key} {...common} value={(value as string) ?? ''} placeholder="Choose…" onChange={(e) => set(f.key, e.target.value || undefined)} options={f.options ?? []} />;
            case 'multiselect': {
              const list = Array.isArray(value) ? (value as string[]) : [];
              return (
                <fieldset key={f.key} className="sm:col-span-2">
                  <legend className="mb-1 text-sm font-medium">
                    {f.label}
                    {f.required && <span className="text-danger"> *</span>}
                  </legend>
                  <div className="grid gap-1 sm:grid-cols-3">
                    {(f.options ?? []).map((o) => (
                      <Checkbox key={o.value} label={o.label} checked={list.includes(o.value)} onChange={(e) => set(f.key, e.target.checked ? [...list, o.value] : list.filter((v) => v !== o.value))} />
                    ))}
                  </div>
                </fieldset>
              );
            }
            default:
              return <TextField key={f.key} {...common} value={(value as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} />;
          }
        })}
    </div>
  );
}
