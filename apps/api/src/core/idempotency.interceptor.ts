import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { catchError, from, map, Observable, of, switchMap, throwError } from 'rxjs';
import { IDEMPOTENT_KEY, type AuthedRequest } from './context';
import { sha256, stableStringify } from './crypto';
import { AppError } from './errors';
import { ERROR_HTTP_STATUS } from '@propcare/shared';
import { isUniqueViolation, PrismaService } from './prisma.service';

/**
 * Idempotency-Key handling (SPEC §7 rule 22, §11 idempotency_keys). The first response for a
 * (user, endpoint, key) is stored and replayed; the same key with a different body is rejected.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key || !req.actor) return next.handle();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppError('BAD_REQUEST', [{ code: 'IDEMPOTENCY_KEY_FORMAT' }]);

    const userId = req.actor.userId;
    const endpoint = `${req.method} ${req.originalUrl.split('?')[0]}`;
    const requestHash = sha256(stableStringify(req.body ?? {}));

    return from(this.claim(userId, endpoint, key, requestHash)).pipe(
      switchMap((existing) => {
        if (existing) {
          res.status(existing.status);
          return of(existing.body);
        }
        return next.handle().pipe(
          switchMap((body) =>
            from(
              this.prisma.idempotencyKey.updateMany({
                where: { userId, endpoint, key },
                data: {
                  responseStatus: res.statusCode || 201,
                  responseBody: (body ?? null) as Prisma.InputJsonValue,
                },
              }),
            ).pipe(map(() => body)),
          ),
          catchError((err: unknown) => {
            // Client errors are replayed; server errors release the key so a retry can succeed.
            const status = err instanceof AppError ? ERROR_HTTP_STATUS[err.code] : 500;
            const release =
              status >= 500
                ? this.prisma.idempotencyKey.deleteMany({ where: { userId, endpoint, key } })
                : this.prisma.idempotencyKey.updateMany({
                    where: { userId, endpoint, key },
                    data: { responseStatus: status, responseBody: { replayError: err instanceof AppError ? err.code : 'INTERNAL' } },
                  });
            return from(release).pipe(switchMap(() => throwError(() => err)));
          }),
        );
      }),
    );
  }

  /** Returns a stored response to replay, or null if this call owns the key. */
  private async claim(userId: string, endpoint: string, key: string, requestHash: string) {
    try {
      await this.prisma.idempotencyKey.create({ data: { userId, endpoint, key, requestHash } });
      return null;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    const row = await this.prisma.idempotencyKey.findUnique({ where: { userId_endpoint_key: { userId, endpoint, key } } });
    if (!row) return null;
    if (row.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED');
    if (row.responseStatus === null) throw new AppError('CONFLICT', [{ code: 'IDEMPOTENT_REQUEST_IN_PROGRESS' }]);
    const body = row.responseBody as { replayError?: string } | null;
    if (body && typeof body === 'object' && 'replayError' in body && body.replayError) {
      throw new AppError(body.replayError as keyof typeof ERROR_HTTP_STATUS);
    }
    return { status: row.responseStatus, body: row.responseBody };
  }
}
