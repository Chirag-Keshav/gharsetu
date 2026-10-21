import { Inject, Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PERMISSION_FLAGS, type PermissionFlag } from '@propcare/shared';
import type { Response } from 'express';
import { ENV, type Env } from '../config/env';
import { CLOCK, type Clock } from './clock';
import type { UserActor } from './context';
import { randomToken, sha256 } from './crypto';
import { PolicyService } from './policy.service';
import { PrismaService } from './prisma.service';

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf_token';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface LoadedSession {
  actor: UserActor | null;
  /** The user has no role yet (role selection pending). */
  needsRole: boolean;
  userId: string;
  sessionId: string;
}

/**
 * Server-side sessions (SPEC §5 "Authentication", §8.1): an opaque random token in an HttpOnly
 * cookie, stored only as a SHA-256 hash, carrying the active role.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async lifetimes(isAdmin: boolean) {
    if (isAdmin) {
      return {
        idleMs: (await this.policy.get('session.admin_idle_hours')) * HOUR,
        absoluteMs: (await this.policy.get('session.admin_absolute_days')) * DAY,
      };
    }
    return {
      idleMs: (await this.policy.get('session.user_idle_days')) * DAY,
      absoluteMs: (await this.policy.get('session.user_absolute_days')) * DAY,
    };
  }

  async create(userId: string, activeRole: Role | null, meta: { ipHash: string | null; userAgent?: string }) {
    const token = randomToken(32);
    const { absoluteMs } = await this.lifetimes(activeRole === 'ADMIN');
    const now = this.clock.now();
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        activeRole,
        lastSeenAt: now,
        createdAt: now,
        expiresAt: new Date(now.getTime() + absoluteMs),
        ipHash: meta.ipHash,
        userAgent: meta.userAgent?.slice(0, 200),
      },
    });
    return { token, session };
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax' });
  }

  /** Validates the cookie token and returns the actor, or null when there is no valid session. */
  async load(token: string | undefined): Promise<LoadedSession | null> {
    if (!token || token.length < 20 || token.length > 200) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { include: { roles: true } } },
    });
    if (!session || session.revokedAt) return null;
    const now = this.clock.now();
    if (session.expiresAt <= now) return null;
    const user = session.user;
    if (user.status !== 'ACTIVE') return null;
    const roles = user.roles.map((r) => r.role);
    const isAdmin = roles.includes('ADMIN');
    const { idleMs } = await this.lifetimes(isAdmin);
    if (session.lastSeenAt.getTime() + idleMs <= now.getTime()) return null;

    if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }

    let activeRole = session.activeRole && roles.includes(session.activeRole) ? session.activeRole : null;
    if (isAdmin) activeRole = 'ADMIN';
    if (!activeRole) return { actor: null, needsRole: true, userId: user.id, sessionId: session.id };

    const flags = new Set(
      user.permissionFlags.filter((f): f is PermissionFlag => (PERMISSION_FLAGS as readonly string[]).includes(f)),
    );
    return {
      actor: {
        kind: 'USER',
        userId: user.id,
        role: activeRole,
        flags: activeRole === 'ADMIN' ? flags : new Set(),
        sessionId: session.id,
        fullName: user.fullName,
      },
      needsRole: false,
      userId: user.id,
      sessionId: session.id,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: this.clock.now() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: this.clock.now() } });
  }

  async setActiveRole(sessionId: string, role: Role): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { activeRole: role } });
  }
}
