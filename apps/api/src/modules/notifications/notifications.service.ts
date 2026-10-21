import { Inject, Injectable } from '@nestjs/common';
import type { OutboxEvent, Prisma } from '@prisma/client';
import { brandFromEnv, interpolate, notificationTemplates, smsTemplates, type PermissionFlag } from '@propcare/shared';
import { OBJECT_STORAGE, type ObjectStorage } from '../../adapters/storage';
import { SMS_PROVIDER, type SmsProvider } from '../../adapters/sms';
import { CLOCK, type Clock } from '../../core/clock';
import type { UserActor } from '../../core/context';
import { notFound } from '../../core/errors';
import { errorFields, log } from '../../core/logger';
import { PolicyService } from '../../core/policy.service';
import { PrismaService } from '../../core/prisma.service';
import { afterCursor, iso, pageOrder, toPage } from '../../core/serialize';
import { ListingMediaService } from '../listings/listing-media.service';
import { RequestsService } from '../maintenance/requests.service';

const brand = brandFromEnv(process.env);
const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;

type Payload = Record<string, unknown> & { [k: string]: unknown };
interface Recipient {
  userId: string;
  template: string;
  params?: Record<string, unknown>;
}

/**
 * Transactional outbox dispatcher and notification fan-out (SPEC §14.3, §16). A failing handler
 * never rolls back the business action that wrote the event; it is retried with bounded backoff.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly media: ListingMediaService,
    private readonly requests: RequestsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- outbox ----------------------------------------------------------------------------------------
  /** Claims a batch with a lease so concurrent dispatchers never process the same event. */
  async dispatchOnce(limit = 25): Promise<number> {
    const now = this.clock.now();
    const claimed = await this.prisma.$queryRaw<OutboxEvent[]>`
      UPDATE outbox_events SET next_attempt_at = ${new Date(now.getTime() + LEASE_MS)}
      WHERE id IN (
        SELECT id FROM outbox_events WHERE dispatched_at IS NULL AND next_attempt_at <= ${now}
        ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id, type, payload, attempts`;
    for (const e of claimed) {
      try {
        await this.handle(e.id, e.type, (e.payload ?? {}) as Payload);
        await this.prisma.outboxEvent.update({ where: { id: e.id }, data: { dispatchedAt: this.clock.now(), lastError: null } });
      } catch (err) {
        const attempts = e.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        const delay = Math.min(3_600_000, 5_000 * 2 ** attempts);
        await this.prisma.outboxEvent.update({
          where: { id: e.id },
          data: {
            attempts,
            lastError: String(errorFields(err).errorMessage ?? 'error').slice(0, 500),
            nextAttemptAt: new Date(this.clock.now().getTime() + delay),
            ...(giveUp ? { failedAt: this.clock.now(), dispatchedAt: this.clock.now() } : {}),
          },
        });
        log.warn('outbox_handler_failed', { eventId: e.id, type: e.type, attempts, ...errorFields(err) });
        if (giveUp) await this.prisma.adminAlert.create({ data: { type: 'OUTBOX_HANDLER_FAILED', entityType: 'OUTBOX_EVENT', entityId: e.id, metadata: { type: e.type } } });
      }
    }
    return claimed.length;
  }

  /** Drains the outbox (used by tests and on-demand runs). */
  async drain(maxRounds = 20): Promise<void> {
    for (let i = 0; i < maxRounds; i++) if ((await this.dispatchOnce(100)) === 0) return;
  }

  private async admins(flag?: PermissionFlag): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: 'ADMIN' } }, ...(flag ? { permissionFlags: { has: flag } } : {}) },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async handle(eventId: string, type: string, p: Payload): Promise<void> {
    const out: Recipient[] = [];
    const to = (userId: unknown, template: string, params: Record<string, unknown> = {}) => {
      if (typeof userId === 'string' && userId) out.push({ userId, template, params: { ...p, ...params } });
    };
    const toAdmins = async (template: string, flag?: PermissionFlag, params: Record<string, unknown> = {}) => {
      for (const id of await this.admins(flag)) to(id, template, params);
    };

    switch (type) {
      case 'listing.submitted':
        to(p.ownerUserId, 'listing.submitted');
        await toAdmins('admin.listing_to_review', 'LISTING_REVIEW');
        break;
      case 'listing.status_changed': {
        await this.media.sync(String(p.listingId));
        if (p.byAdmin) {
          const map: Record<string, string> = {
            CHANGES_REQUESTED: 'listing.changes_requested',
            PUBLISHED: 'listing.published',
            REJECTED: 'listing.rejected',
            PAUSED: 'listing.paused_by_admin',
          };
          if (map[String(p.to)]) to(p.ownerUserId, map[String(p.to)]);
        }
        break;
      }
      case 'listing.photos_changed':
        await this.media.sync(String(p.listingId));
        break;
      case 'listing.photo_removed':
        await Promise.all([
          this.storage.delete('public', `listings/${p.listingId}/${p.photoId}-sm.webp`),
          this.storage.delete('public', `listings/${p.listingId}/${p.photoId}-lg.webp`),
        ]);
        break;
      case 'verification.submitted':
        await toAdmins('admin.verification_pending', 'LISTING_REVIEW');
        break;
      case 'booking.created':
        if (p.status === 'REQUESTED') {
          to(p.customerUserId, 'booking.request_sent');
          to(p.ownerUserId, 'booking.request_received', { deadline: p.deadline ? new Date(String(p.deadline)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '' });
        } else to(p.customerUserId, 'booking.payment_due');
        break;
      case 'booking.approved':
        to(p.customerUserId, 'booking.payment_due');
        break;
      case 'booking.declined':
        to(p.customerUserId, 'booking.declined');
        break;
      case 'booking.expired': {
        const b = await this.prisma.booking.findUnique({ where: { id: String(p.bookingId) }, select: { customerUserId: true, reference: true } });
        if (b) to(b.customerUserId, 'booking.expired', { reference: b.reference });
        break;
      }
      case 'booking.confirmed':
        to(p.customerUserId, 'booking.confirmed');
        to(p.ownerUserId, 'booking.confirmed_owner');
        break;
      case 'booking.cancelled':
        to(p.customerUserId, 'booking.cancelled');
        to(p.ownerUserId, 'booking.cancelled_owner');
        break;
      case 'booking.completed': {
        to(p.customerUserId, 'booking.review_prompt');
        if (p.turnoverCleaning && (await this.policy.get('features.turnover_cleaning'))) {
          const exists = await this.prisma.serviceRequest.findFirst({ where: { bookingId: String(p.bookingId), source: 'TURNOVER_AUTO' } });
          if (!exists) {
            await this.prisma.tx(async (tx) => {
              const created =
                (await this.requests.createSystem(tx, { propertyId: String(p.propertyId), categorySlug: 'pre-arrival-preparation', title: `Turnover cleaning after ${p.reference}`, description: `Automatic turnover-cleaning request after stay ${p.reference}. Please triage.`, bookingId: String(p.bookingId) })) ??
                (await this.requests.createSystem(tx, { propertyId: String(p.propertyId), categorySlug: 'deep-cleaning', title: `Turnover cleaning after ${p.reference}`, description: `Automatic turnover-cleaning request after stay ${p.reference}. Please triage.`, bookingId: String(p.bookingId) }));
              return created;
            });
          }
        }
        break;
      }
      case 'refund.succeeded':
        if (p.bookingId) {
          const b = await this.prisma.booking.findUnique({ where: { id: String(p.bookingId) }, select: { reference: true } });
          to(p.payerUserId, 'booking.refund_issued', { reference: b?.reference ?? '' });
        }
        break;
      case 'payment.succeeded':
      case 'payment.failed': {
        const template = type;
        if (p.bookingId) {
          const b = await this.prisma.booking.findUnique({ where: { id: String(p.bookingId) }, select: { reference: true } });
          to(p.payerUserId, template, { reference: b?.reference ?? '', link: `/trips/${p.bookingId}` });
        } else if (p.requirementId) {
          const r = await this.prisma.paymentRequirement.findUnique({ where: { id: String(p.requirementId) }, include: { request: { select: { reference: true, id: true } } } });
          to(p.payerUserId, template, { reference: r?.request.reference ?? '', link: `/owner/requests/${r?.request.id ?? ''}` });
        }
        break;
      }
      case 'payout.eligible':
        to(p.ownerUserId, 'payout.eligible');
        await toAdmins('admin.payout_eligible', 'FINANCE');
        break;
      case 'payout.paid':
        to(p.ownerUserId, 'payout.paid');
        break;
      case 'request.submitted':
        to(p.ownerUserId, 'request.submitted');
        await toAdmins(p.safetyFlag ? 'admin.safety_flagged_request' : 'admin.new_request');
        break;
      case 'request.information_requested':
        to(p.ownerUserId, 'request.information_requested');
        break;
      case 'request.inspection_scheduled':
        to(p.ownerUserId, 'request.inspection_scheduled');
        break;
      case 'request.quote_sent':
        to(p.ownerUserId, 'request.quote_sent');
        break;
      case 'request.owner_replied':
        if (p.handledByAdminId) to(p.handledByAdminId, 'admin.owner_reply');
        else await toAdmins('admin.owner_reply');
        break;
      case 'request.closed':
        to(p.ownerUserId, 'request.closed');
        break;
      case 'work.change_order':
        to(p.ownerUserId, 'work.change_order');
        break;
      case 'work.scheduled':
      case 'work.rescheduled':
      case 'work.started':
      case 'work.progress':
      case 'work.ready_for_owner_review':
      case 'work.completed':
      case 'work.cancelled':
      case 'work.safety_mitigation':
        to(p.ownerUserId, type);
        break;
      case 'admin.work_order_blocked':
        await toAdmins('admin.work_order_blocked');
        break;
      case 'issue.opened': {
        const link = (_role: 'owner' | 'customer') => `/issues/${p.issueId}`;
        if (p.ownerUserId !== p.raisedBy) to(p.ownerUserId, 'issue.opened', { link: link('owner') });
        if (p.customerUserId && p.customerUserId !== p.raisedBy) to(p.customerUserId, 'issue.opened', { link: link('customer') });
        await toAdmins('admin.issue_opened');
        break;
      }
      case 'issue.resolved':
        to(p.raisedBy, 'issue.resolved', { link: `/issues/${p.issueId}` });
        break;
      case 'message.posted': {
        const recipients = Array.isArray(p.recipients) ? (p.recipients as string[]) : [];
        if (p.threadType === 'BOOKING') {
          const b = await this.prisma.booking.findUnique({ where: { id: String(p.threadId) }, select: { reference: true, ownerUserId: true } });
          for (const r of recipients) to(r, 'booking.message', { reference: b?.reference ?? '', link: r === b?.ownerUserId ? `/owner/bookings/${p.threadId}` : `/trips/${p.threadId}` });
        } else if (p.threadType === 'REQUEST' && p.authorRole === 'ADMIN') {
          const r = await this.prisma.serviceRequest.findUnique({ where: { id: String(p.threadId) }, select: { reference: true } });
          for (const u of recipients) to(u, 'request.message', { reference: r?.reference ?? '', requestId: p.threadId });
        } else if (p.threadType === 'ISSUE') {
          const i = await this.prisma.issue.findUnique({ where: { id: String(p.threadId) }, select: { reference: true } });
          for (const u of recipients) to(u, 'issue.message', { reference: i?.reference ?? '', link: `/issues/${p.threadId}` });
        }
        break;
      }
      case 'admin.alert': {
        const map: Record<string, string> = {
          LATE_PAYMENT_DATES_TAKEN: 'admin.late_payment_dates_taken',
          REFUND_FAILED: 'admin.refund_failed',
        };
        const template = map[String(p.alertType)];
        if (template) {
          const ref = p.entityType === 'BOOKING' ? (await this.prisma.booking.findUnique({ where: { id: String(p.entityId) }, select: { reference: true } }))?.reference : String(p.entityId ?? '');
          await toAdmins(template, template === 'admin.refund_failed' ? 'FINANCE' : undefined, { reference: ref ?? '', bookingId: p.entityId });
        }
        break;
      }
      case 'ai.briefing_ready':
        await toAdmins('admin.ai_briefing_ready');
        break;
      default:
        break;
    }
    if (out.length) await this.deliver(eventId, out);
  }

  /** In-app always; SMS for critical templates. Non-critical ones respect user preferences. */
  private async deliver(eventId: string, recipients: Recipient[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(recipients.map((r) => r.userId))] } },
      select: { id: true, phoneE164: true, communicationPrefs: true, status: true },
    });
    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const r of recipients) {
      const tpl = notificationTemplates[r.template];
      const user = users.find((u) => u.id === r.userId);
      if (!tpl || !user || user.status !== 'ACTIVE') continue;
      const prefs = (user.communicationPrefs ?? {}) as Record<string, boolean>;
      if (!tpl.critical && prefs[r.template] === false) continue;
      const params = this.safeParams(r.params ?? {});
      rows.push({ userId: r.userId, channel: 'IN_APP', templateKey: r.template, params, status: 'SENT', sentAt: this.clock.now(), outboxEventId: eventId });
      if (tpl.critical) rows.push({ userId: r.userId, channel: 'SMS', templateKey: r.template, params, status: 'PENDING', nextAttemptAt: this.clock.now(), outboxEventId: eventId });
    }
    // The unique (event, user, channel, template) key makes redelivery a no-op.
    if (rows.length) await this.prisma.notification.createMany({ data: rows, skipDuplicates: true });
    await this.sendPendingSms(eventId);
  }

  /** Only identifiers and references go into params — never access details or locations. */
  private safeParams(params: Record<string, unknown>): Prisma.InputJsonValue {
    const allowed = ['reference', 'quoteReference', 'propertyId', 'listingId', 'bookingId', 'requestId', 'workOrderId', 'issueId', 'deadline', 'checkIn', 'link'];
    return Object.fromEntries(Object.entries(params).filter(([k, v]) => allowed.includes(k) && (typeof v === 'string' || typeof v === 'number'))) as Prisma.InputJsonValue;
  }

  render(templateKey: string, params: Record<string, unknown>) {
    const tpl = notificationTemplates[templateKey];
    const values = { ...(params as Record<string, string>), productName: brand.productName };
    if (!tpl) return { title: templateKey, body: '', link: null as string | null };
    return { title: interpolate(tpl.title, values), body: interpolate(tpl.body, values), link: tpl.link ? interpolate(tpl.link, values) : null };
  }

  async sendPendingSms(eventId?: string): Promise<number> {
    const now = this.clock.now();
    const pending = await this.prisma.notification.findMany({
      where: { channel: 'SMS', status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 }, nextAttemptAt: { lte: now }, ...(eventId ? { outboxEventId: eventId } : {}) },
      include: { user: { select: { phoneE164: true } } },
      take: 100,
    });
    for (const n of pending) {
      try {
        const { title } = this.render(n.templateKey, n.params as Record<string, unknown>);
        const res = await this.sms.send({ to: n.user.phoneE164, template: 'notification', body: interpolate(smsTemplates.generic, { productName: brand.productName, title }) });
        await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: this.clock.now(), providerRef: res.providerRef, attempts: { increment: 1 } } });
      } catch (err) {
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { status: 'FAILED', attempts: { increment: 1 }, failureReason: String(errorFields(err).errorMessage).slice(0, 200), nextAttemptAt: new Date(this.clock.now().getTime() + 60_000 * 2 ** n.attempts) },
        });
      }
    }
    return pending.length;
  }

  // --- in-app API -----------------------------------------------------------------------------------
  async list(actor: UserActor, cursor: string | undefined, limit: number) {
    const rows = await this.prisma.notification.findMany({
      where: { userId: actor.userId, channel: 'IN_APP', ...afterCursor(cursor) },
      orderBy: pageOrder,
      take: limit + 1,
    });
    const unread = await this.prisma.notification.count({ where: { userId: actor.userId, channel: 'IN_APP', readAt: null } });
    return {
      ...toPage(rows, limit, (n) => ({ id: n.id, templateKey: n.templateKey, ...this.render(n.templateKey, n.params as Record<string, unknown>), readAt: iso(n.readAt), createdAt: iso(n.createdAt) })),
      unread,
    };
  }

  async markRead(actor: UserActor, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId: actor.userId }, data: { readAt: this.clock.now() } });
    if (!res.count) throw notFound();
    return { ok: true };
  }

  async markAllRead(actor: UserActor) {
    await this.prisma.notification.updateMany({ where: { userId: actor.userId, readAt: null }, data: { readAt: this.clock.now() } });
    return { ok: true };
  }
}
