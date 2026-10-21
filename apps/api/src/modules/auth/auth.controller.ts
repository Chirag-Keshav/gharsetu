import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import {
  activeRoleSchema,
  addRoleSchema,
  consentSchema,
  otpRequestSchema,
  otpVerifySchema,
  ownerProfileUpdateSchema,
  updateMeSchema,
} from '@propcare/shared';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AllowNoRole,
  AuthSubject,
  CurrentActor,
  Public,
  RateLimit,
  Roles,
  type AuthedRequest,
  type AuthSubjectValue,
  type UserActor,
} from '../../core/context';
import { PrismaService } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { CSRF_COOKIE, SessionsService } from '../../core/sessions.service';
import { zp } from '../../core/zod.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Public()
  @Get('csrf')
  csrf(@Req() req: AuthedRequest) {
    return { token: req.cookies?.[CSRF_COOKIE] ?? null };
  }

  @Public()
  @RateLimit({ bucket: 'otp-request', limit: 20, windowMs: 15 * 60_000 })
  @Post('otp/request')
  @HttpCode(200)
  request(@Body(zp(otpRequestSchema)) body: z.infer<typeof otpRequestSchema>, @Req() req: AuthedRequest) {
    return this.auth.requestOtp(body.phone, req.ipHash);
  }

  @Public()
  @RateLimit({ bucket: 'otp-verify', limit: 40, windowMs: 15 * 60_000 })
  @Post('otp/verify')
  @HttpCode(200)
  async verify(
    @Body(zp(otpVerifySchema)) body: z.infer<typeof otpVerifySchema>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyOtp(body, { ipHash: req.ipHash, userAgent: req.header('user-agent') });
    this.sessions.setCookie(res, result.token, result.expiresAt);
    const session = await this.sessions.load(result.token);
    return this.auth.me(result.userId, session!.sessionId);
  }

  @AllowNoRole()
  @Post('logout')
  @HttpCode(200)
  async logout(@AuthSubject() subject: AuthSubjectValue, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(subject.sessionId);
    this.sessions.clearCookie(res);
    return { ok: true };
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @AllowNoRole()
  @Get()
  me(@AuthSubject() s: AuthSubjectValue) {
    return this.auth.me(s.userId, s.sessionId);
  }

  @AllowNoRole()
  @Patch()
  update(@AuthSubject() s: AuthSubjectValue, @Body(zp(updateMeSchema)) body: z.infer<typeof updateMeSchema>) {
    return this.auth.updateMe(s.userId, s.sessionId, body);
  }

  @AllowNoRole()
  @Post('consents')
  consent(@AuthSubject() s: AuthSubjectValue, @Body(zp(consentSchema)) body: z.infer<typeof consentSchema>) {
    return this.auth.recordConsent(s.userId, body.documentType, body.version);
  }

  @AllowNoRole()
  @Post('roles')
  @HttpCode(200)
  addRole(@AuthSubject() s: AuthSubjectValue, @Body(zp(addRoleSchema)) body: z.infer<typeof addRoleSchema>) {
    return this.auth.addRole(s.userId, s.sessionId, body.role);
  }

  @AllowNoRole()
  @Post('active-role')
  @HttpCode(200)
  activeRole(@AuthSubject() s: AuthSubjectValue, @Body(zp(activeRoleSchema)) body: z.infer<typeof activeRoleSchema>) {
    return this.auth.switchRole(s.userId, s.sessionId, body.role);
  }
}

@Controller('owner/profile')
@Roles('OWNER')
export class OwnerProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
  ) {}

  private serialize(p: { defaultServiceMode: string | null; payoutAccountRef: string | null; verificationStatus: string; commissionOverrideBps: number | null }) {
    return {
      defaultServiceMode: p.defaultServiceMode,
      payoutAccountRef: p.payoutAccountRef,
      verificationStatus: p.verificationStatus,
      hasCommissionOverride: p.commissionOverrideBps !== null,
    };
  }

  @Get()
  async get(@CurrentActor() actor: UserActor) {
    const p = await this.prisma.ownerProfile.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId }, update: {} });
    return this.serialize(p);
  }

  @Patch()
  async update(@CurrentActor() actor: UserActor, @Body(zp(ownerProfileUpdateSchema)) body: z.infer<typeof ownerProfileUpdateSchema>) {
    const p = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ownerProfile.upsert({
        where: { userId: actor.userId },
        create: { userId: actor.userId, ...body },
        update: body,
      });
      await this.records.audit(tx, actor, {
        action: 'owner_profile.updated',
        entityType: 'OWNER_PROFILE',
        entityId: actor.userId,
        metadata: { fields: Object.keys(body) },
      });
      return updated;
    });
    return this.serialize(p);
  }
}
