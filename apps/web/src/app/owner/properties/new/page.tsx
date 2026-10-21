'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PROPERTY_TYPES, SERVICE_MODES, statusLabel } from '@propcare/shared';
import { Button, Card, ErrorAlert, Form, Loading, PageHeader, SelectField, TextArea, TextField } from '@/components/ui';
import { ApiError, post, useApi } from '@/lib/api';
import { useAction } from '@/lib/use-action';

const MODE_LABELS: Record<string, string> = { CARE: 'Care only', LIST: 'List for stays', LIST_AND_CARE: 'List and care' };

function NewProperty() {
  const router = useRouter();
  const sp = useSearchParams();
  const profile = useApi<{ defaultServiceMode: string | null }>('/owner/profile');
  const [f, setF] = useState<Record<string, string>>({ propertyType: 'APARTMENT' });
  const { busy, error, run } = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const mode = f.serviceMode ?? sp.get('mode') ?? profile.data?.defaultServiceMode ?? 'CARE';
  const fieldError = (path: string) => (error instanceof ApiError ? error.details.find((d) => d.path === path)?.message ?? null : null);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add a property" back={{ href: '/owner', label: 'Dashboard' }} subtitle="Only you and our team see the exact address. Guests see it after a confirmed booking." />
      <Form
        className="space-y-6"
        onSubmit={() =>
          run('save', async () => {
            const p = await post<{ id: string }>(
              '/properties',
              {
                nickname: f.nickname,
                propertyType: f.propertyType,
                addressLine1: f.addressLine1,
                addressLine2: f.addressLine2 || null,
                locality: f.locality,
                city: f.city,
                district: f.district,
                state: f.state,
                pinCode: f.pinCode,
                areaSqft: f.areaSqft ? Number(f.areaSqft) : null,
                accessNotes: f.accessNotes || null,
                serviceMode: mode,
              },
              true,
            );
            router.push(`/owner/properties/${p.id}?created=1`);
          })
        }
      >
        <Card title="About the property">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nickname" required maxLength={80} value={f.nickname ?? ''} onChange={set('nickname')} hint="For example “Goa flat”." error={fieldError('nickname')} />
            <SelectField label="Type" required value={f.propertyType} onChange={set('propertyType')} options={PROPERTY_TYPES.map((t) => ({ value: t, label: statusLabel(t) }))} />
            <SelectField label="What do you need?" required value={mode} onChange={set('serviceMode')} options={SERVICE_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))} />
            <TextField label="Area (sq ft, optional)" type="number" min={50} max={1000000} value={f.areaSqft ?? ''} onChange={set('areaSqft')} />
          </div>
        </Card>
        <Card title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField className="sm:col-span-2" label="Address line 1" required maxLength={200} autoComplete="address-line1" value={f.addressLine1 ?? ''} onChange={set('addressLine1')} />
            <TextField className="sm:col-span-2" label="Address line 2 (optional)" maxLength={200} autoComplete="address-line2" value={f.addressLine2 ?? ''} onChange={set('addressLine2')} />
            <TextField label="Locality" required maxLength={100} value={f.locality ?? ''} onChange={set('locality')} />
            <TextField label="City" required maxLength={100} autoComplete="address-level2" value={f.city ?? ''} onChange={set('city')} />
            <TextField label="District" required maxLength={100} value={f.district ?? ''} onChange={set('district')} />
            <TextField label="State" required maxLength={100} autoComplete="address-level1" value={f.state ?? ''} onChange={set('state')} />
            <TextField label="PIN code" required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} autoComplete="postal-code" value={f.pinCode ?? ''} onChange={set('pinCode')} invalidMessage="Enter a 6-digit PIN code." error={fieldError('pinCode')} />
          </div>
        </Card>
        <Card title="Access notes (optional)">
          <TextArea label="How does our team get in?" rows={3} maxLength={2000} value={f.accessNotes ?? ''} onChange={set('accessNotes')} hint="Encrypted and shown only to our team when a visit is scheduled. Do not include door codes you use elsewhere." />
        </Card>
        <ErrorAlert error={error} />
        <div className="flex justify-end">
          <Button type="submit" size="lg" busy={busy === 'save'}>
            Save property
          </Button>
        </div>
      </Form>
    </div>
  );
}

export default function NewPropertyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewProperty />
    </Suspense>
  );
}
