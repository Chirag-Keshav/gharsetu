'use client';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';
import { cx, ErrorAlert, PageHeader } from '@/components/ui';
import { patch } from '@/lib/api';
import { brand } from '@/lib/brand';
import { useAction } from '@/lib/use-action';

const MODES = [
  { mode: 'CARE', title: 'Care for my property', body: 'Repairs, cleaning, inspections and upkeep, with quotes you approve before any work starts.', icon: '🛠️' },
  { mode: 'LIST', title: 'List it for stays', body: 'Earn from short stays. We review your listing, take bookings and pay you out after each stay.', icon: '🏡' },
  { mode: 'LIST_AND_CARE', title: 'Both', body: 'List for stays and let us handle turnover cleaning and maintenance between guests.', icon: '✨' },
] as const;

export default function OwnerStart() {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`What would you like ${brand.productName} to do?`} subtitle="You can change this per property later." />
      <div className="grid gap-4 md:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            disabled={!!busy}
            onClick={() =>
              run(m.mode, async () => {
                await patch('/owner/profile', { defaultServiceMode: m.mode });
                await mutate('/me');
                router.push(`/owner/properties/new?mode=${m.mode}`);
              })
            }
            className={cx('rounded-xl border border-line bg-surface p-5 text-left transition hover:border-brand focus-visible:border-brand', busy === m.mode && 'opacity-60')}
          >
            <span aria-hidden className="text-3xl">
              {m.icon}
            </span>
            <p className="mt-3 font-semibold">{m.title}</p>
            <p className="mt-1 text-sm text-muted">{m.body}</p>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <ErrorAlert error={error} />
      </div>
    </div>
  );
}
