import { Inject, Injectable } from '@nestjs/common';
import { isoToDate, verificationMachine } from '@propcare/shared';
import { CLOCK, type Clock } from '../../core/clock';
import type { UserActor } from '../../core/context';
import { AppError, notFound, validation } from '../../core/errors';
import { PrismaService } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { afterCursor, iso, pageOrder, toPage } from '../../core/serialize';

/** Admin verification queue (SPEC §8.2 VER-01). Requires LISTING_REVIEW at the controller. */
@Injectable()
export class VerificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async queue(status: 'PENDING' | 'APPROVED' | 'REJECTED' | undefined, cursor: string | undefined, limit: number) {
    const rows = await this.prisma.verification.findMany({
      where: { ...(status ? { status } : {}), ...afterCursor(cursor) },
      orderBy: pageOrder,
      take: limit + 1,
    });
    const docs = await this.prisma.verificationDocument.findMany({ where: { ownerType: 'VERIFICATION', ownerId: { in: rows.map((r) => r.id) } } });
    const ownerIds = rows.filter((r) => r.subjectType === 'OWNER').map((r) => r.subjectId);
    const propertyIds = rows.filter((r) => r.subjectType === 'PROPERTY').map((r) => r.subjectId);
    const [owners, properties] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, fullName: true } }),
      this.prisma.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true, nickname: true, city: true, state: true, ownerUserId: true, owner: { select: { fullName: true } } },
      }),
    ]);
    return toPage(rows, limit, (v) => {
      const property = properties.find((p) => p.id === v.subjectId);
      const owner = owners.find((o) => o.id === v.subjectId);
      return {
        id: v.id,
        subjectType: v.subjectType,
        subjectId: v.subjectId,
        subjectLabel: v.subjectType === 'OWNER' ? (owner?.fullName ?? 'Owner') : `${property?.nickname ?? 'Property'} · ${property?.city ?? ''}`,
        ownerName: v.subjectType === 'OWNER' ? owner?.fullName : property?.owner.fullName,
        status: v.status,
        submittedAt: iso(v.submittedAt),
        reviewedAt: iso(v.reviewedAt),
        reason: v.reason,
        createdAt: iso(v.createdAt),
        documents: docs
          .filter((d) => d.ownerId === v.id)
          .map((d) => ({ id: d.id, docType: d.docType, attachmentId: d.attachmentId, expiresAt: iso(d.expiresAt) })),
      };
    });
  }

  async decide(actor: UserActor, id: string, decision: 'APPROVED' | 'REJECTED', reason: string | null | undefined, expiresAt?: string) {
    if (decision === 'REJECTED' && !reason) throw validation({ path: 'reason', code: 'REQUIRED' });
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.verification.findUnique({ where: { id } });
      if (!v) throw notFound();
      await this.records.transition(tx, verificationMachine, { entityId: v.id, from: v.status, to: decision, actor, reason });
      const res = await tx.verification.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: decision,
          reviewedBy: actor.userId,
          reviewedAt: this.clock.now(),
          reason: reason ?? null,
          expiresAt: expiresAt ? isoToDate(expiresAt) : null,
        },
      });
      if (res.count !== 1) throw new AppError('INVALID_STATE_TRANSITION');
      if (v.subjectType === 'OWNER') {
        await tx.ownerProfile.update({ where: { userId: v.subjectId }, data: { verificationStatus: decision } });
      } else {
        await tx.property.update({ where: { id: v.subjectId }, data: { verificationStatus: decision } });
      }
      await this.records.audit(tx, actor, {
        action: decision === 'APPROVED' ? 'verification.approved' : 'verification.rejected',
        entityType: 'VERIFICATION',
        entityId: id,
        metadata: { subjectType: v.subjectType, subjectId: v.subjectId },
      });
      await this.records.emit(tx, 'verification.decided', { verificationId: id, subjectType: v.subjectType, subjectId: v.subjectId, decision });
      return { id, status: decision };
    });
  }
}
