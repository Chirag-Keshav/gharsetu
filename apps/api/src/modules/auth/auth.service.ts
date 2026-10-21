import { randomInt, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Role, User, UserRole } from '@prisma/client';
import { brandFromEnv, interpolate, maskPhone, smsTemplates, type SelfServiceRole } from '@propcare/shared';
import { SMS_PROVIDER, type SmsProvider } from '../../adapters/sms';
import { ENV, type Env } from '../../config/env';
import { CLOCK, type Clock } from '../../core/clock';
import { makeUserActor, SYSTEM_ACTOR } from '../../core/context';
import { hmac, safeEqual } from '../../core/crypto';
import { AppError, forbidden } from '../../core/errors';
import { log } from '../../core/logger';
import { PolicyService } from '../../core/policy.service';
import { PrismaService } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { SessionsService } from '../../core/sessions.service';

const TEST_CODE = '123456';
const brand = brandFromEnv(process.env);

type UserWithRoles = User & { roles: UserRole[] };

/** Phone OTP sign-in (SPEC §8.1). Only an HMAC verifier of each code is stored. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly sessions: SessionsService,
    private readonly records: RecordsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private verifier(challengeId: string, phone: string, code: string): string {
    return hmac(this.env.OTP_HMAC_SECRET, `${challengeId}:${phone}:${code}`);
  }

  /** Same response whether or not the phone is known. */
  async requestOtp(phone: string, ipHash: string | null) {
    const now = this.clock.now();
    const [length, ttl, cooldown, perHour] = await Promise.all([
      this.policy.get('otp.length'),
      this.policy.get('otp.ttl_seconds'),
      this.policy.get('otp.resend_cooldown_seconds'),
      this.policy.get('otp.max_requests_per_hour'),
    ]);
    const recent = await this.prisma.otpChallenge.findMany({
      where: { phoneE164: phone, createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent.length >= perHour) throw new AppError('RATE_LIMITED', [{ code: 'OTP_HOURLY_LIMIT' }]);
    if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < cooldown * 1000) {
      throw new AppError('RATE_LIMITED', [{ code: 'OTP_COOLDOWN' }]);
    }

    const code = this.env.OTP_TEST_MODE ? TEST_CODE : String(randomInt(0, 10 ** length)).padStart(length, '0');
    const id = randomUUID();
    await this.prisma.otpChallenge.create({
      data: {
        id,
        phoneE164: phone,
        verifier: this.verifier(id, phone, code),
        expiresAt: new Date(now.getTime() + ttl * 1000),
        ipHash,
        createdAt: now,
      },
    });
    try {
      await this.sms.send({
        to: phone,
        template: 'otp',
        body: interpolate(smsTemplates.otp, { productName: brand.productName, code, minutes: Math.round(ttl / 60) }),
      });
    } catch {
      log.warn('otp_sms_failed', { to: maskPhone(phone) });
    }
    return { challengeId: id, expiresInSeconds: ttl, resendAfterSeconds: cooldown };
  }

  async verifyOtp(
    input: { challengeId: string; code: string; intent?: 'BOOKING' },
    meta: { ipHash: string | null; userAgent?: string },
  ) {
    const now = this.clock.now();
    const maxAttempts = await this.policy.get('otp.max_attempts');
    // Count the attempt atomically before comparing, so parallel guesses cannot exceed the limit.
    const counted = await this.prisma.otpChallenge.updateMany({
      where: { id: input.challengeId, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count !== 1) throw new AppError('OTP_INVALID');
    const challenge = await this.prisma.otpChallenge.findUniqueOrThrow({ where: { id: input.challengeId } });
    if (!safeEqual(challenge.verifier, this.verifier(challenge.id, challenge.phoneE164, input.code))) {
      throw new AppError('OTP_INVALID');
    }
    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw new AppError('OTP_INVALID');

    let user: UserWithRoles | null = await this.prisma.user.findUnique({
      where: { phoneE164: challenge.phoneE164 },
      include: { roles: true },
    });
    const isNew = !user;
    if (!user) {
      user = await this.prisma.user.create({
        data: { phoneE164: challenge.phoneE164, phoneVerifiedAt: now },
        include: { roles: true },
      });
    } else if (!user.phoneVerifiedAt) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: now }, include: { roles: true } });
    }
    if (user.status !== 'ACTIVE') {
      await this.records.audit(this.prisma, SYSTEM_ACTOR, {
        action: 'auth.sign_in_blocked',
        entityType: 'USER',
        entityId: user.id,
        metadata: { reason: 'SUSPENDED' },
      });
      throw new AppError('OTP_INVALID');
    }

    const roles = user.roles.map((r) => r.role);
    // Deep links win: a booking started while logged out continues as CUSTOMER (§3.1).
    if (roles.length === 0 && input.intent === 'BOOKING') {
      await this.prisma.userRole.create({ data: { userId: user.id, role: 'CUSTOMER' } });
      roles.push('CUSTOMER');
    }
    const activeRole = this.pickActiveRole(roles, user.lastActiveRole);
    if (activeRole && activeRole !== user.lastActiveRole) {
      await this.prisma.user.update({ where: { id: user.id }, data: { lastActiveRole: activeRole } });
    }
    const { token, session } = await this.sessions.create(user.id, activeRole, meta);
    await this.records.audit(this.prisma, makeUserActor(user.id, activeRole ?? 'CUSTOMER', session.id), {
      action: isNew ? 'auth.sign_up' : 'auth.sign_in',
      entityType: 'USER',
      entityId: user.id,
      metadata: { activeRole, intent: input.intent ?? null },
    });
    return { token, expiresAt: session.expiresAt, userId: user.id };
  }

  private pickActiveRole(roles: Role[], last: Role | null): Role | null {
    if (roles.includes('ADMIN')) return 'ADMIN';
    if (last && roles.includes(last)) return last;
    return roles[0] ?? null;
  }

  async me(userId: string, sessionId: string) {
    const [user, session] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: true, ownerProfile: true } }),
      this.prisma.session.findUniqueOrThrow({ where: { id: sessionId } }),
    ]);
    const roles = user.roles.map((r) => r.role);
    const isAdmin = roles.includes('ADMIN');
    const activeRole = isAdmin ? 'ADMIN' : session.activeRole && roles.includes(session.activeRole) ? session.activeRole : null;
    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phoneE164,
        phoneMasked: maskPhone(user.phoneE164),
        email: user.email,
        communicationPrefs: user.communicationPrefs,
      },
      roles,
      activeRole,
      lastActiveRole: user.lastActiveRole,
      flags: isAdmin ? user.permissionFlags : [],
      onboarding: {
        needsName: !user.fullName,
        needsRole: roles.length === 0,
        needsServiceMode: roles.includes('OWNER') && !user.ownerProfile?.defaultServiceMode,
      },
    };
  }

  async updateMe(userId: string, sessionId: string, patch: { fullName?: string; email?: string | null; communicationPrefs?: Record<string, boolean> }) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: patch.fullName,
        email: patch.email === undefined ? undefined : patch.email,
        communicationPrefs: patch.communicationPrefs,
      },
    });
    return this.me(userId, sessionId);
  }

  async addRole(userId: string, sessionId: string, role: SelfServiceRole) {
    const roles = (await this.prisma.userRole.findMany({ where: { userId } })).map((r) => r.role);
    if (roles.includes('ADMIN')) throw forbidden('ADMIN_ROLE_EXCLUSIVE');
    await this.prisma.$transaction(async (tx) => {
      if (!roles.includes(role)) await tx.userRole.create({ data: { userId, role } });
      if (role === 'OWNER') await tx.ownerProfile.upsert({ where: { userId }, create: { userId }, update: {} });
      await tx.session.update({ where: { id: sessionId }, data: { activeRole: role } });
      await tx.user.update({ where: { id: userId }, data: { lastActiveRole: role } });
      await this.records.audit(tx, makeUserActor(userId, role, sessionId), {
        action: roles.includes(role) ? 'role.selected' : 'role.added',
        entityType: 'USER',
        entityId: userId,
        metadata: { role },
      });
    });
    return this.me(userId, sessionId);
  }

  async switchRole(userId: string, sessionId: string, role: Role) {
    const roles = (await this.prisma.userRole.findMany({ where: { userId } })).map((r) => r.role);
    if (!roles.includes(role)) throw forbidden('ROLE_NOT_HELD');
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: sessionId }, data: { activeRole: role } });
      await tx.user.update({ where: { id: userId }, data: { lastActiveRole: role } });
      await this.records.audit(tx, makeUserActor(userId, role, sessionId), {
        action: 'role.switched',
        entityType: 'USER',
        entityId: userId,
        metadata: { role },
      });
    });
    return this.me(userId, sessionId);
  }

  async recordConsent(userId: string, documentType: string, version: string) {
    await this.prisma.consentRecord.create({ data: { userId, documentType, version, acceptedAt: this.clock.now() } });
    return { ok: true };
  }
}
