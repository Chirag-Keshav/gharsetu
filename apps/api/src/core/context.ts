/** Request context, actors and route decorators. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ActorKind, PermissionFlag, Role } from '@propcare/shared';
import type { Request } from 'express';
import { AppError } from './errors';

export interface UserActor {
  kind: 'USER';
  userId: string;
  role: Role;
  flags: ReadonlySet<PermissionFlag>;
  sessionId: string;
  fullName: string | null;
}

export interface SystemActor {
  kind: 'SYSTEM';
  userId: null;
  role: 'SYSTEM';
}

export type Actor = UserActor | SystemActor;
export const SYSTEM_ACTOR: SystemActor = { kind: 'SYSTEM', userId: null, role: 'SYSTEM' };

export function makeUserActor(userId: string, role: Role, sessionId = '', flags: PermissionFlag[] = []): UserActor {
  return { kind: 'USER', userId, role, flags: new Set(flags), sessionId, fullName: null };
}

export function actorKind(actor: Actor): ActorKind {
  return actor.kind === 'SYSTEM' ? 'SYSTEM' : actor.role;
}

export const isAdmin = (actor: Actor): boolean => actor.kind === 'USER' && actor.role === 'ADMIN';
export const hasFlag = (actor: Actor, flag: PermissionFlag): boolean => actor.kind === 'USER' && actor.role === 'ADMIN' && actor.flags.has(flag);

export function requireFlag(actor: Actor, flag: PermissionFlag): void {
  if (!hasFlag(actor, flag)) throw new AppError('FORBIDDEN', [{ code: `FLAG_REQUIRED:${flag}` }]);
}

export interface RequestStore {
  requestId: string;
  ipHash: string | null;
}

/** Per-request store so audit events can carry request IDs without threading them everywhere. */
export const requestStore = new AsyncLocalStorage<RequestStore>();

export interface AuthedRequest extends Request {
  requestId: string;
  ipHash: string | null;
  actor?: UserActor;
  rawBody?: Buffer;
}

// --- Route metadata ------------------------------------------------------------------------------
export const PUBLIC_KEY = 'propcare:public';
export const ROLES_KEY = 'propcare:roles';
export const FLAGS_KEY = 'propcare:flags';
export const ALLOW_NO_ROLE_KEY = 'propcare:allowNoRole';
export const SKIP_CSRF_KEY = 'propcare:skipCsrf';
export const IDEMPOTENT_KEY = 'propcare:idempotent';
export const RATE_LIMIT_KEY = 'propcare:rateLimit';

/** No session is read or required; the route never sees a cookie-derived identity. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const Flags = (...flags: PermissionFlag[]) => SetMetadata(FLAGS_KEY, flags);
/** Authenticated route reachable before a role is chosen (role selection, /me). */
export const AllowNoRole = () => SetMetadata(ALLOW_NO_ROLE_KEY, true);
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
/** Honour the Idempotency-Key header (SPEC §7 rule 22). */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
}
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, opts);

export interface AuthSubjectValue {
  userId: string;
  sessionId: string;
  actor: UserActor | null;
}

/** For @AllowNoRole routes: the signed-in user even before a role is chosen. */
export const AuthSubject = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthSubjectValue => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest & { pendingUser?: { userId: string; sessionId: string } }>();
  if (req.actor) return { userId: req.actor.userId, sessionId: req.actor.sessionId, actor: req.actor };
  if (req.pendingUser) return { ...req.pendingUser, actor: null };
  throw new AppError('UNAUTHENTICATED');
});

/** Injects the authenticated actor; throws 401 if absent. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserActor => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.actor) throw new AppError('UNAUTHENTICATED');
  return req.actor;
});
