import { Injectable } from '@nestjs/common';
import type { MessageVisibility, ThreadType } from '@prisma/client';
import { maskContactDetails } from '@propcare/shared';
import { isAdmin, type Actor, type UserActor } from '../../core/context';
import { AppError, notFound } from '../../core/errors';
import { PrismaService, type Db } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { iso } from '../../core/serialize';

export interface ThreadAccess {
  admin: boolean;
  /** Users (other than admins) who take part in this thread. */
  participantIds: string[];
  /** BOOKING threads: masking applies until the booking is confirmed (SPEC §7 rule 20). */
  maskContacts: boolean;
}

/**
 * Message threads for requests, work orders, issues, bookings and listing reviews (SPEC §11
 * `messages`). Access is decided here once for every module and for message attachments.
 */
@Injectable()
export class ThreadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
  ) {}

  /** Throws NOT_FOUND unless the actor may read the thread. */
  async access(actor: Actor, type: ThreadType, id: string, db: Db = this.prisma): Promise<ThreadAccess> {
    const admin = actor.kind === 'SYSTEM' || isAdmin(actor);
    const uid = actor.userId;
    const role = actor.role;
    switch (type) {
      case 'REQUEST': {
        const r = await db.serviceRequest.findUnique({ where: { id }, select: { ownerUserId: true } });
        if (!r || (!admin && !(role === 'OWNER' && r.ownerUserId === uid))) throw notFound();
        return { admin, participantIds: [r.ownerUserId], maskContacts: false };
      }
      case 'WORK_ORDER': {
        const w = await db.workOrder.findUnique({ where: { id }, select: { ownerUserId: true } });
        if (!w || (!admin && !(role === 'OWNER' && w.ownerUserId === uid))) throw notFound();
        return { admin, participantIds: [w.ownerUserId], maskContacts: false };
      }
      case 'ISSUE': {
        const i = await db.issue.findUnique({ where: { id }, select: { ownerUserId: true, customerUserId: true } });
        const ok = i && (admin || (role === 'OWNER' && i.ownerUserId === uid) || (role === 'CUSTOMER' && i.customerUserId === uid));
        if (!i || !ok) throw notFound();
        return { admin, participantIds: [i.ownerUserId, ...(i.customerUserId ? [i.customerUserId] : [])], maskContacts: false };
      }
      case 'BOOKING': {
        const b = await db.booking.findUnique({ where: { id }, select: { ownerUserId: true, customerUserId: true, status: true } });
        const ok = b && (admin || (role === 'OWNER' && b.ownerUserId === uid) || (role === 'CUSTOMER' && b.customerUserId === uid));
        if (!b || !ok) throw notFound();
        return {
          admin,
          participantIds: [b.ownerUserId, b.customerUserId],
          maskContacts: b.status !== 'CONFIRMED' && b.status !== 'COMPLETED',
        };
      }
      case 'LISTING_REVIEW': {
        const l = await db.listing.findUnique({ where: { id }, select: { ownerUserId: true } });
        if (!l || (!admin && !(role === 'OWNER' && l.ownerUserId === uid))) throw notFound();
        return { admin, participantIds: [l.ownerUserId], maskContacts: false };
      }
    }
  }

  async list(actor: UserActor, type: ThreadType, id: string) {
    const access = await this.access(actor, type, id);
    if (access.admin && type === 'BOOKING') {
      // Admins reading private booking threads is audited (SPEC §7 rule 20).
      await this.records.audit(this.prisma, actor, { action: 'thread.private_read', entityType: 'BOOKING', entityId: id });
    }
    const rows = await this.prisma.message.findMany({
      where: { threadType: type, threadId: id, ...(access.admin ? {} : { visibility: 'PARTICIPANT' }) },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const attachments = await this.prisma.attachment.findMany({
      where: { ownerType: 'MESSAGE', ownerId: { in: rows.map((r) => r.id) }, status: 'AVAILABLE' },
      select: { id: true, ownerId: true, originalFilename: true, mimeType: true },
    });
    const authors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.authorUserId).filter((x): x is string => !!x))] } },
      select: { id: true, fullName: true },
    });
    const nameOf = new Map(authors.map((a) => [a.id, a.fullName]));
    return {
      items: rows.map((m) => ({
        id: m.id,
        body: m.body,
        masked: m.masked,
        visibility: m.visibility,
        authorRole: m.authorRole,
        // Owners see a "care team" label rather than individual staff names.
        authorName: m.authorRole === 'ADMIN' ? (access.admin ? (nameOf.get(m.authorUserId ?? '') ?? 'Admin') : null) : (nameOf.get(m.authorUserId ?? '')?.split(' ')[0] ?? null),
        mine: m.authorUserId === actor.userId,
        createdAt: iso(m.createdAt),
        attachments: attachments.filter((a) => a.ownerId === m.id).map((a) => ({ id: a.id, filename: a.originalFilename, mimeType: a.mimeType })),
      })),
    };
  }

  /** Posts a message; masks contact details on unconfirmed booking threads. */
  async post(
    db: Db,
    actor: Actor,
    type: ThreadType,
    id: string,
    input: { body: string; visibility?: MessageVisibility; attachmentIds?: string[] },
  ) {
    const access = await this.access(actor, type, id, db);
    const visibility = input.visibility ?? 'PARTICIPANT';
    if (visibility === 'INTERNAL' && !access.admin) throw new AppError('FORBIDDEN', [{ code: 'INTERNAL_NOTES_ADMIN_ONLY' }]);
    let body = input.body;
    let masked = false;
    if (access.maskContacts) {
      const r = maskContactDetails(body);
      body = r.text;
      masked = r.masked;
    }
    const message = await db.message.create({
      data: { threadType: type, threadId: id, authorUserId: actor.userId, authorRole: actor.role, body, visibility, masked },
    });
    if (input.attachmentIds?.length) {
      const linked = await db.attachment.updateMany({
        where: {
          id: { in: input.attachmentIds },
          ownerType: 'MESSAGE',
          ownerId: null,
          status: 'AVAILABLE',
          ...(actor.kind === 'USER' ? { uploadedBy: actor.userId } : {}),
        },
        data: { ownerId: message.id, visibility: visibility === 'INTERNAL' ? 'INTERNAL' : 'PARTICIPANT' },
      });
      if (linked.count !== input.attachmentIds.length) throw new AppError('VALIDATION_FAILED', [{ path: 'attachmentIds', code: 'INVALID_ATTACHMENT' }]);
    }
    await this.records.emit(db, 'message.posted', {
      threadType: type,
      threadId: id,
      messageId: message.id,
      authorId: actor.userId,
      authorRole: actor.role,
      visibility,
      recipients: visibility === 'INTERNAL' ? [] : access.participantIds.filter((p) => p !== actor.userId),
    });
    return { id: message.id, masked };
  }
}
