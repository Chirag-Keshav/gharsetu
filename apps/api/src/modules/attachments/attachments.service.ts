import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Attachment, AttachmentOwnerType } from '@prisma/client';
import { presignSchema } from '@propcare/shared';
import type { z } from 'zod';
import { MALWARE_SCANNER, OBJECT_STORAGE, sniffMime, type MalwareScanner, type ObjectStorage } from '../../adapters/storage';
import { CLOCK, type Clock } from '../../core/clock';
import { hasFlag, isAdmin, type Actor, type UserActor } from '../../core/context';
import { sha256 } from '../../core/crypto';
import { AppError, forbidden, notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService, type Db } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { ThreadsService } from '../threads/threads.service';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const DOCUMENT_TYPES = ['application/pdf'];
const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
};
/** Owner types whose files are only ever visible to admins. */
const ADMIN_ONLY: AttachmentOwnerType[] = ['VERIFICATION', 'PROVIDER', 'INSPECTION'];
const DOWNLOAD_TTL = 300;

/**
 * Presigned uploads to private storage and access-checked downloads (SPEC §8.7 attachments,
 * §14.1 media rules). Nothing here is ever public; listing photos get public variants elsewhere.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly records: RecordsService,
    private readonly threads: ThreadsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async allowedTypes(ownerType: AttachmentOwnerType) {
    const imageMax = (await this.policy.get('uploads.image_max_mb')) * 1024 * 1024;
    const videoMax = (await this.policy.get('uploads.video_max_mb')) * 1024 * 1024;
    const allowed = new Map<string, number>();
    for (const t of IMAGE_TYPES) allowed.set(t, imageMax);
    if (['REQUEST', 'MESSAGE', 'WORK_ORDER', 'ISSUE', 'INSPECTION'].includes(ownerType)) for (const t of VIDEO_TYPES) allowed.set(t, videoMax);
    if (['VERIFICATION', 'PROVIDER'].includes(ownerType)) for (const t of DOCUMENT_TYPES) allowed.set(t, imageMax);
    return allowed;
  }

  /** Can the actor attach files to (or read files of) this owner entity? */
  async canUseOwner(actor: Actor, ownerType: AttachmentOwnerType, ownerId: string, db: Db = this.prisma): Promise<boolean> {
    const admin = actor.kind === 'SYSTEM' || isAdmin(actor);
    const uid = actor.userId;
    switch (ownerType) {
      case 'PROPERTY': {
        const p = await db.property.findUnique({ where: { id: ownerId }, select: { ownerUserId: true } });
        return !!p && (admin || (actor.role === 'OWNER' && p.ownerUserId === uid));
      }
      case 'LISTING': {
        const l = await db.listing.findUnique({ where: { id: ownerId }, select: { ownerUserId: true } });
        return !!l && (admin || (actor.role === 'OWNER' && l.ownerUserId === uid));
      }
      case 'REQUEST': {
        const r = await db.serviceRequest.findUnique({ where: { id: ownerId }, select: { ownerUserId: true } });
        return !!r && (admin || (actor.role === 'OWNER' && r.ownerUserId === uid));
      }
      case 'WORK_ORDER': {
        const w = await db.workOrder.findUnique({ where: { id: ownerId }, select: { ownerUserId: true } });
        return !!w && (admin || (actor.role === 'OWNER' && w.ownerUserId === uid));
      }
      case 'ISSUE': {
        const i = await db.issue.findUnique({ where: { id: ownerId }, select: { ownerUserId: true, customerUserId: true } });
        return !!i && (admin || (actor.role === 'OWNER' && i.ownerUserId === uid) || (actor.role === 'CUSTOMER' && i.customerUserId === uid));
      }
      case 'MESSAGE': {
        const m = await db.message.findUnique({ where: { id: ownerId } });
        if (!m) return false;
        if (m.visibility === 'INTERNAL') return admin;
        try {
          await this.threads.access(actor, m.threadType, m.threadId, db);
          return true;
        } catch {
          return false;
        }
      }
      case 'VERIFICATION':
      case 'PROVIDER':
      case 'INSPECTION':
        return admin;
    }
  }

  async presign(actor: UserActor, input: z.infer<typeof presignSchema>) {
    if (ADMIN_ONLY.includes(input.ownerType) && input.ownerType !== 'VERIFICATION' && !isAdmin(actor)) throw forbidden();
    if (input.ownerType === 'VERIFICATION' && actor.role !== 'OWNER' && !isAdmin(actor)) throw forbidden();
    if (input.ownerType === 'WORK_ORDER' && !isAdmin(actor)) throw forbidden();
    if (input.ownerId && !(await this.canUseOwner(actor, input.ownerType, input.ownerId))) throw notFound();
    const allowed = await this.allowedTypes(input.ownerType);
    const max = allowed.get(input.mimeType);
    if (max === undefined) throw validation({ path: 'mimeType', code: 'UNSUPPORTED_TYPE' });
    if (input.sizeBytes > max) throw validation({ path: 'sizeBytes', code: 'TOO_LARGE', message: `Maximum ${Math.round(max / 1048576)} MB` });

    const now = this.clock.now();
    const id = randomUUID();
    const objectKey = `${input.ownerType.toLowerCase()}/${now.getUTCFullYear()}/${id}${EXT[input.mimeType]}`;
    await this.prisma.attachment.create({
      data: {
        id,
        ownerType: input.ownerType,
        ownerId: input.ownerId ?? null,
        evidencePhase: input.evidencePhase ?? 'GENERAL',
        objectKey,
        originalFilename: input.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 150),
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedBy: actor.userId,
        visibility: ADMIN_ONLY.includes(input.ownerType) ? 'INTERNAL' : 'PARTICIPANT',
      },
    });
    const upload = await this.storage.presignUpload(objectKey, input.mimeType, max, 900);
    return { attachmentId: id, upload, expiresInSeconds: 900 };
  }

  /** Validates the uploaded object by content sniffing, size and scanner before making it AVAILABLE. */
  async complete(actor: UserActor, attachmentId: string) {
    const att = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!att || att.uploadedBy !== actor.userId) throw notFound();
    if (att.status === 'AVAILABLE') return this.receipt(att);
    if (att.status !== 'PENDING') throw new AppError('INVALID_STATE_TRANSITION');
    const body = await this.storage.get('private', att.objectKey);
    let problem: string | null = null;
    if (!body) problem = 'NOT_UPLOADED';
    else {
      const sniffed = sniffMime(body);
      const allowed = await this.allowedTypes(att.ownerType);
      const max = allowed.get(att.mimeType) ?? 0;
      if (body.length > max) problem = 'TOO_LARGE';
      else if (!sniffed || sniffed !== att.mimeType) {
        // mp4/mov share a container family; accept either declared video type.
        const bothVideo = sniffed && VIDEO_TYPES.includes(sniffed) && VIDEO_TYPES.includes(att.mimeType);
        if (!bothVideo) problem = 'CONTENT_MISMATCH';
      }
      if (!problem && (await this.scanner.scan(body)) === 'INFECTED') problem = 'MALWARE';
    }
    if (problem === 'NOT_UPLOADED') throw validation({ code: 'NOT_UPLOADED' });
    const updated = await this.prisma.attachment.update({
      where: { id: att.id },
      data: problem
        ? { status: 'REJECTED' }
        : { status: 'AVAILABLE', sha256: sha256(body!), sizeBytes: body!.length },
    });
    if (problem) {
      await this.storage.delete('private', att.objectKey);
      throw validation({ path: 'file', code: problem });
    }
    return this.receipt(updated);
  }

  receipt(a: Attachment) {
    return {
      id: a.id,
      status: a.status,
      ownerType: a.ownerType,
      filename: a.originalFilename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      evidencePhase: a.evidencePhase,
    };
  }

  async canRead(actor: Actor, a: Attachment): Promise<boolean> {
    const admin = actor.kind === 'SYSTEM' || isAdmin(actor);
    if (a.status !== 'AVAILABLE') return false;
    // Verification documents: admins with LISTING_REVIEW only; owners get an upload receipt (SPEC §8.2, §13).
    if (a.ownerType === 'VERIFICATION') return actor.kind === 'SYSTEM' || hasFlag(actor, 'LISTING_REVIEW');
    if (a.visibility === 'INTERNAL') return admin;
    if (!a.ownerId) return admin || a.uploadedBy === actor.userId;
    return this.canUseOwner(actor, a.ownerType, a.ownerId);
  }

  async downloadUrl(actor: UserActor, id: string) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    // Return 404 rather than 403 so other users' files cannot be discovered (SPEC §12.9).
    if (!a || !(await this.canRead(actor, a))) throw notFound();
    if (a.ownerType === 'VERIFICATION' || a.ownerType === 'PROVIDER') {
      await this.records.audit(this.prisma, actor, {
        action: 'document.accessed',
        entityType: 'ATTACHMENT',
        entityId: a.id,
        metadata: { ownerType: a.ownerType, ownerId: a.ownerId },
      });
    }
    return { url: await this.storage.presignDownload(a.objectKey, DOWNLOAD_TTL, a.originalFilename), expiresInSeconds: DOWNLOAD_TTL };
  }

  /**
   * Links pending-owner attachments uploaded by the actor to a newly created entity.
   * Every id must belong to the actor (or be admin-uploaded) and be AVAILABLE.
   */
  async link(db: Db, actor: Actor, ids: string[], ownerType: AttachmentOwnerType, ownerId: string, extra: Partial<Attachment> = {}) {
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    const result = await db.attachment.updateMany({
      where: {
        id: { in: unique },
        ownerType,
        status: 'AVAILABLE',
        OR: [{ ownerId: null }, { ownerId }],
        ...(actor.kind === 'USER' && !isAdmin(actor) ? { uploadedBy: actor.userId } : {}),
      },
      data: { ownerId, ...extra },
    });
    if (result.count !== unique.length) throw validation({ path: 'attachmentIds', code: 'INVALID_ATTACHMENT' });
  }

  async listFor(ownerType: AttachmentOwnerType, ownerId: string, opts: { includeInternal: boolean }) {
    const rows = await this.prisma.attachment.findMany({
      where: { ownerType, ownerId, status: 'AVAILABLE', ...(opts.includeInternal ? {} : { visibility: { not: 'INTERNAL' } }) },
      orderBy: { createdAt: 'asc' },
    });
    return rows;
  }
}
