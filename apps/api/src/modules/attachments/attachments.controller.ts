import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { attachmentCompleteSchema, presignSchema } from '@propcare/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { LocalObjectStorage, OBJECT_STORAGE, type ObjectStorage } from '../../adapters/storage';
import { CurrentActor, Public, RateLimit, SkipCsrf, type AuthedRequest, type UserActor } from '../../core/context';
import { AppError, notFound } from '../../core/errors';
import { PrismaService } from '../../core/prisma.service';
import { zp } from '../../core/zod.pipe';
import { AttachmentsService } from './attachments.service';

@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @RateLimit({ bucket: 'uploads', limit: 120, windowMs: 60_000 })
  @Post('uploads/presign')
  presign(@CurrentActor() actor: UserActor, @Body(zp(presignSchema)) body: z.infer<typeof presignSchema>) {
    return this.attachments.presign(actor, body);
  }

  @Post('attachments/complete')
  @HttpCode(200)
  complete(@CurrentActor() actor: UserActor, @Body(zp(attachmentCompleteSchema)) body: z.infer<typeof attachmentCompleteSchema>) {
    return this.attachments.complete(actor, body.attachmentId);
  }

  @Get('attachments/:id/download-url')
  download(@CurrentActor() actor: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.downloadUrl(actor, id);
  }
}

const signedQuery = z.object({
  key: z.string().max(300),
  exp: z.coerce.number().int(),
  sig: z.string().max(128),
  max: z.coerce.number().int().optional(),
  ct: z.string().max(100).optional(),
  fn: z.string().max(200).optional(),
});

/**
 * Local-driver stand-in for S3 presigned URLs. Authorisation is the HMAC signature issued by
 * AttachmentsService after its access check; no session is read.
 */
@Controller('storage')
export class LocalStorageController {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly prisma: PrismaService,
  ) {}

  private local(): LocalObjectStorage {
    if (!(this.storage instanceof LocalObjectStorage)) throw notFound();
    return this.storage;
  }

  @Public()
  @SkipCsrf()
  @Put('upload')
  @HttpCode(200)
  async upload(@Query(zp(signedQuery)) q: z.infer<typeof signedQuery>, @Req() req: AuthedRequest) {
    const local = this.local();
    if (!local.verify({ op: 'put', key: q.key, exp: q.exp, max: q.max, ct: q.ct }, q.sig)) throw new AppError('FORBIDDEN');
    if (req.header('content-type')?.split(';')[0] !== q.ct) throw new AppError('BAD_REQUEST', [{ code: 'CONTENT_TYPE_MISMATCH' }]);
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError('BAD_REQUEST', [{ code: 'EMPTY_BODY' }]);
    if (q.max && body.length > q.max) throw new AppError('BAD_REQUEST', [{ code: 'TOO_LARGE' }]);
    const att = await this.prisma.attachment.findUnique({ where: { objectKey: q.key } });
    if (!att || att.status !== 'PENDING') throw new AppError('FORBIDDEN');
    await local.put('private', q.key, body);
    return { ok: true };
  }

  @Public()
  @Get('download')
  async download(@Query(zp(signedQuery)) q: z.infer<typeof signedQuery>, @Res() res: Response) {
    const local = this.local();
    if (!local.verify({ op: 'get', key: q.key, exp: q.exp, fn: q.fn }, q.sig)) throw new AppError('FORBIDDEN');
    const att = await this.prisma.attachment.findUnique({ where: { objectKey: q.key } });
    const body = att && att.status === 'AVAILABLE' ? await local.get('private', q.key) : null;
    if (!att || !body) throw notFound();
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${(q.fn ?? 'file').replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.send(body);
  }
}
