'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate as globalMutate } from 'swr';
import { SERVICE_MODES, statusLabel } from '@propcare/shared';
import { SuccessNote } from '@/components/shared';
import { Button, Card, Checkbox, ErrorAlert, Form, KeyValue, PageHeader, SelectField, StatusBadge, TextField } from '@/components/ui';
import { patch, post, useApi } from '@/lib/api';
import { homeFor, SignedIn, switchRole, type Me, type Role } from '@/lib/session';
import { useAction } from '@/lib/use-action';

const PREF_LABELS: Record<string, string> = {
  sms_transactional: 'Text messages about bookings and requests',
  in_app: 'In-app notifications',
  sms_marketing: 'Occasional offers by text message',
};

function OwnerSettings() {
  const { data, mutate } = useApi<{ defaultServiceMode: string | null; payoutAccountRef: string | null; verificationStatus: string }>('/owner/profile');
  const [mode, setMode] = useState<string | null>(null);
  const [payout, setPayout] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  if (!data) return null;
  return (
    <Card title="Owner settings">
      <Form
        className="space-y-3"
        onSubmit={() =>
          run('owner', async () => {
            await patch('/owner/profile', { defaultServiceMode: mode ?? data.defaultServiceMode ?? undefined, payoutAccountRef: (payout ?? data.payoutAccountRef) || null });
            await mutate();
            setSaved(true);
          })
        }
      >
        <KeyValue items={[['Identity verification', <StatusBadge key="v" status={data.verificationStatus} />]]} />
        <SelectField
          label="Default service"
          value={mode ?? data.defaultServiceMode ?? ''}
          onChange={(e) => setMode(e.target.value)}
          placeholder="Choose…"
          options={SERVICE_MODES.map((m) => ({ value: m, label: m === 'CARE' ? 'Care only' : m === 'LIST' ? 'List for stays only' : 'List and care' }))}
        />
        <TextField
          label="Payout account"
          value={payout ?? data.payoutAccountRef ?? ''}
          onChange={(e) => setPayout(e.target.value)}
          pattern="^(tok_[A-Za-z0-9_]+|[A-Za-z .]*[•*xX]{4,}\d{2,4})$"
          invalidMessage="Enter the masked account shown by your bank, e.g. HDFC ••••1234"
          hint="We store only a masked reference or a payment-provider token — never full bank details."
        />
        <SuccessNote show={saved}>Saved.</SuccessNote>
        <ErrorAlert error={error} />
        <Button type="submit" busy={busy === 'owner'}>
          Save owner settings
        </Button>
      </Form>
    </Card>
  );
}

function Account({ me }: { me: Me }) {
  const router = useRouter();
  const [name, setName] = useState(me.user.fullName ?? '');
  const [email, setEmail] = useState(me.user.email ?? '');
  const [prefs, setPrefs] = useState<Record<string, boolean>>({ sms_transactional: true, in_app: true, sms_marketing: false, ...me.user.communicationPrefs });
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const missing = (['OWNER', 'CUSTOMER'] as Role[]).filter((r) => !me.roles.includes(r));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <PageHeader title="Account" subtitle={me.user.phoneMasked} />
      <Card title="Profile">
        <Form
          className="space-y-3"
          onSubmit={() =>
            run('profile', async () => {
              await patch('/me', { fullName: name, email: email || null, communicationPrefs: prefs });
              await globalMutate('/me');
              setSaved(true);
            })
          }
        >
          <TextField label="Full name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <TextField label="Email (optional)" type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" invalidMessage="Enter a valid email address." />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Messages</legend>
            {Object.keys(prefs).map((k) => (
              <Checkbox key={k} label={PREF_LABELS[k] ?? statusLabel(k)} checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} />
            ))}
          </fieldset>
          <SuccessNote show={saved}>Profile saved.</SuccessNote>
          <ErrorAlert error={error} />
          <Button type="submit" busy={busy === 'profile'}>
            Save profile
          </Button>
        </Form>
      </Card>

      {me.activeRole !== 'ADMIN' && (
        <Card title="Roles">
          <p className="text-sm text-muted">One account can both own property and book stays. Switch between them from the header.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {me.roles
              .filter((r) => r !== me.activeRole)
              .map((r) => (
                <Button
                  key={r}
                  variant="secondary"
                  onClick={async () => {
                    await switchRole(r);
                    router.push(homeFor(r));
                  }}
                >
                  Switch to {r === 'OWNER' ? 'owner' : 'guest'}
                </Button>
              ))}
            {missing.map((r) => (
              <Button
                key={r}
                variant="secondary"
                busy={busy === r}
                onClick={() =>
                  run(r, async () => {
                    await post('/me/roles', { role: r });
                    await switchRole(r);
                    router.push(homeFor(r));
                  })
                }
              >
                {r === 'OWNER' ? 'I also own property' : 'I also want to book stays'}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {me.activeRole === 'OWNER' && <OwnerSettings />}

      <Card title="Sign out">
        <Button
          variant="secondary"
          onClick={async () => {
            await post('/auth/logout');
            await globalMutate(() => true, undefined, { revalidate: false });
            router.push('/');
            router.refresh();
          }}
        >
          Sign out of this device
        </Button>
      </Card>
    </div>
  );
}

export default function AccountPage() {
  return <SignedIn>{(me) => <Account me={me} />}</SignedIn>;
}
