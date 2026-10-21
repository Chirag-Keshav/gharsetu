'use client';
/** Small design-system kit. Status is never conveyed by colour alone; every badge has text. */
import Link from 'next/link';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type FormEvent,
  type FormHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { describeError } from '@/lib/api';
import { statusLabel, toneOf, type Tone } from '@/lib/format';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:opacity-90',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
  ai: 'bg-ai-soft text-ai border border-ai/30 hover:opacity-90',
};
const SIZES = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES; busy?: boolean }>(
  function Button({ variant = 'primary', size = 'md', busy, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50', VARIANTS[variant], SIZES[size], className)}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...rest}
      >
        {busy && <Spinner small />}
        {children}
      </button>
    );
  },
);

export function LinkButton({ href, variant = 'primary', size = 'md', className, children }: { href: string; variant?: Variant; size?: keyof typeof SIZES; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition', VARIANTS[variant], SIZES[size], className)}>
      {children}
    </Link>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span aria-hidden className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-3.5 w-3.5' : 'h-5 w-5')} />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-10 text-muted">
      <Spinner /> <span>{label}</span>
    </div>
  );
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-line',
  ok: 'bg-ok-soft text-ok border-ok/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  info: 'bg-info-soft text-info border-info/30',
  brand: 'bg-brand-soft text-brand border-brand/30',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CLASSES[tone], className)}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return null;
  return <Badge tone={toneOf(status)}>{label ?? statusLabel(status)}</Badge>;
}

export function Alert({ tone = 'info', title, children }: { tone?: Exclude<Tone, 'brand'>; title?: string; children?: ReactNode }) {
  const icon = { ok: '✓', warn: '!', danger: '⚠', info: 'ℹ', neutral: '•' }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-lg border p-3 text-sm', TONE_CLASSES[tone])}>
      <span aria-hidden className="font-bold">{icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5', 'text-ink/90')}>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorAlert({ error, title = 'That did not work' }: { error: unknown; title?: string }) {
  if (!error) return null;
  return (
    <Alert tone="danger" title={title}>
      {describeError(error)}
    </Alert>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {typeof title === 'string' ? <h2 className="text-base font-semibold">{title}</h2> : title}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(padded && 'p-4')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-block text-sm text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KeyValue({ items, columns = 2 }: { items: Array<[ReactNode, ReactNode]>; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3 text-sm', columns === 1 ? 'grid-cols-1' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-muted">{k}</dt>
          <dd className="mt-0.5 break-words font-medium">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: Tone }) {
  const body = (
    <div className={cx('h-full rounded-xl border bg-surface p-4', tone && tone !== 'neutral' ? TONE_CLASSES[tone] : 'border-line', href && 'transition hover:border-brand')}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

// --- forms -------------------------------------------------------------------------------------------
/**
 * Form wrapper: keeps `aria-invalid` in sync with the visual :user-invalid state for assistive
 * technology (blur, input and submit), and leaves the submit button enabled.
 */
export function Form({ onSubmit, children, className, ...rest }: Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & { onSubmit: (e: FormEvent<HTMLFormElement>) => void }) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const sync = (el: Element) => {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
      let invalid = !el.checkValidity();
      try {
        invalid = el.matches(':user-invalid');
      } catch {
        // older engines: fall back to validity after interaction
      }
      if (invalid) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    };
    const onBlur = (e: Event) => e.target && sync(e.target as Element);
    const onInput = (e: Event) => {
      const t = e.target as Element;
      if (t.hasAttribute('aria-invalid')) sync(t);
    };
    const onInvalid = (e: Event) => (e.target as Element).setAttribute('aria-invalid', 'true');
    form.addEventListener('blur', onBlur, true);
    form.addEventListener('input', onInput);
    form.addEventListener('invalid', onInvalid, true);
    return () => {
      form.removeEventListener('blur', onBlur, true);
      form.removeEventListener('input', onInput);
      form.removeEventListener('invalid', onInvalid, true);
    };
  }, []);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      {...rest}
    >
      {children}
    </form>
  );
}

const control = 'block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 disabled:opacity-60';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Message shown when the browser flags the field invalid after interaction. */
  invalidMessage?: string;
  required?: boolean;
  className?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

export function Field({ label, hint, error, invalidMessage, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = `${id}-err`;
  return (
    <div className={cx('field', className)}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}*
          </span>
        )}
      </label>
      {children(id, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      <p id={errId} className="field-error mt-1 items-center gap-1 text-xs text-danger" {...(error ? { 'data-server': '' } : {})}>
        <span aria-hidden>✕</span> {error ?? invalidMessage ?? 'Please check this field.'}
      </p>
    </div>
  );
}

export function TextField({ label, hint, error, invalidMessage, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: string | null; invalidMessage?: string }) {
  return (
    <Field label={label} hint={hint} error={error} invalidMessage={invalidMessage ?? (rest.required ? 'This field is required.' : undefined)} required={rest.required} className={className}>
      {(id, describedBy) => <input id={id} aria-describedby={describedBy} aria-errormessage={describedBy?.split(' ').pop()} className={control} {...rest} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, invalidMessage, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; hint?: ReactNode; error?: string | null; invalidMessage?: string }) {
  return (
    <Field label={label} hint={hint} error={error} invalidMessage={invalidMessage ?? (rest.required ? 'This field is required.' : undefined)} required={rest.required} className={className}>
      {(id, describedBy) => <textarea id={id} aria-describedby={describedBy} rows={rest.rows ?? 4} className={control} {...rest} />}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  options,
  placeholder,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; hint?: ReactNode; error?: string | null; options: Array<{ value: string; label: string }>; placeholder?: string }) {
  return (
    <Field label={label} hint={hint} error={error} invalidMessage={rest.required ? 'Choose an option.' : undefined} required={rest.required} className={className}>
      {(id, describedBy) => (
        <select id={id} aria-describedby={describedBy} className={control} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-1 h-4 w-4 accent-[var(--brand)]" {...rest} />
      <label htmlFor={id} className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </label>
    </div>
  );
}

// --- dialog ----------------------------------------------------------------------------------------
/** Native modal <dialog> (Esc closes; light dismiss where supported). */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Progressive enhancement: light dismiss where `closedby` is supported.
      {...({ closedby: 'any' } as Record<string, string>)}
      onClose={onClose}
      className={cx('w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-muted hover:bg-surface-2" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </dialog>
  );
}

// --- tabs ------------------------------------------------------------------------------------------
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', value === t.id ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, rows, empty }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <Empty title={empty ?? 'Nothing here yet'} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
