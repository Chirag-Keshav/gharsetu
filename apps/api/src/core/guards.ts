import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionFlag, Role } from '@propcare/shared';
import {
  ALLOW_NO_ROLE_KEY,
  FLAGS_KEY,
  PUBLIC_KEY,
  ROLES_KEY,
  SKIP_CSRF_KEY,
  type AuthedRequest,
} from './context';
import { safeEqual } from './crypto';
import { AppError } from './errors';
import { CSRF_COOKIE, SESSION_COOKIE, SessionsService } from './sessions.service';

/**
 * Authentication and role/flag authorisation (SPEC §8.1 AC, §13). Object-level checks happen in
 * the services' data-access scopes on top of this.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.meta<boolean>(PUBLIC_KEY, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const loaded = await this.sessions.load(req.cookies?.[SESSION_COOKIE]);
    if (!loaded) throw new AppError('UNAUTHENTICATED');

    const allowNoRole = this.meta<boolean>(ALLOW_NO_ROLE_KEY, ctx);
    if (!loaded.actor) {
      if (!allowNoRole) throw new AppError('ROLE_REQUIRED');
      (req as AuthedRequest & { pendingUser?: { userId: string; sessionId: string } }).pendingUser = {
        userId: loaded.userId,
        sessionId: loaded.sessionId,
      };
      return true;
    }
    req.actor = loaded.actor;

    const roles = this.meta<Role[]>(ROLES_KEY, ctx);
    if (roles && !roles.includes(loaded.actor.role)) throw new AppError('FORBIDDEN', [{ code: 'ROLE_NOT_ALLOWED' }]);
    const flags = this.meta<PermissionFlag[]>(FLAGS_KEY, ctx);
    if (flags?.length) {
      if (loaded.actor.role !== 'ADMIN' || flags.some((f) => !loaded.actor!.flags.has(f))) {
        throw new AppError('FORBIDDEN', [{ code: 'FLAG_REQUIRED' }]);
      }
    }
    return true;
  }
}

/** Double-submit CSRF check on every mutating request (SPEC §5 "Authentication"). */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const cookie = req.cookies?.[CSRF_COOKIE];
    const header = req.header('x-csrf-token');
    if (!cookie || !header || cookie.length < 16 || !safeEqual(cookie, header)) throw new AppError('CSRF_INVALID');
    return true;
  }
}
