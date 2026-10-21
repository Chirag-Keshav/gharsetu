'use client';
import Link from 'next/link';
import { Button, Card, Empty, ErrorAlert, Loading, PageHeader, cx } from '@/components/ui';
import { post, useApi } from '@/lib/api';
import { ago, dateTimeLabel } from '@/lib/format';
import { SignedIn } from '@/lib/session';

interface Note {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function Notifications() {
  const { data, error, isLoading, mutate } = useApi<{ items: Note[]; unread: number }>('/notifications?limit=50');
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title="Notifications"
        subtitle={data ? `${data.unread} unread` : undefined}
        actions={
          !!data?.unread && (
            <Button variant="secondary" size="sm" onClick={async () => { await post('/notifications/read-all'); await mutate(); }}>
              Mark all read
            </Button>
          )
        }
      />
      {isLoading && <Loading />}
      <ErrorAlert error={error} />
      {data?.items.length === 0 && <Empty title="You're all caught up" />}
      {!!data?.items.length && (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {data.items.map((n) => {
              const inner = (
                <div className={cx('flex gap-3 px-4 py-3', !n.readAt && 'bg-brand-soft/40')}>
                  <span aria-hidden className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand')} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{n.title}</p>
                    {n.body && <p className="text-sm text-muted">{n.body}</p>}
                    <time className="text-xs text-muted" dateTime={n.createdAt} title={dateTimeLabel(n.createdAt)}>
                      {ago(n.createdAt)}
                    </time>
                  </div>
                </div>
              );
              const markRead = () => !n.readAt && post(`/notifications/${n.id}/read`).then(() => mutate());
              return (
                <li key={n.id}>
                  {n.link?.startsWith('/') ? (
                    <Link href={n.link} onClick={markRead} className="block hover:bg-surface-2">
                      {inner}
                    </Link>
                  ) : (
                    <button type="button" onClick={markRead} className="block w-full text-left hover:bg-surface-2">
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return <SignedIn>{() => <Notifications />}</SignedIn>;
}
