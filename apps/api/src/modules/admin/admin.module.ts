import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  auditQuery,
  isoDate,
  maskPhone,
  paginationQuery,
  POLICIES,
  POLICY_KEYS,
  policyUpdateSchema,
  staffCreateSchema,
  staffUpdateSchema,
  type PermissionFlag,
  type PolicyKey,
} from '@propcare/shared';
import { z } from 'zod';
import { CLOCK, type Clock } from '../../core/clock';
import { CurrentActor, Flags, hasFlag, Roles, type UserActor } from '../../core/context';
import { AppError, forbidden, notFound, validation } from '../../core/errors';
import { PolicyService } from '../../core/policy.service';
import { PrismaService } from '../../core/prisma.service';
import { RecordsService } from '../../core/records.service';
import { afterCursor, iso, pageOrder, toPage } from '../../core/serialize';
import { SessionsService } from '../../core/sessions.service';
import { zp } from '../../core/zod.pipe';
import { CommissionService } from '../commission/commission.service';
import { MetricsService } from '../reports/metrics.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly records: RecordsService,
    private readonly sessions: SessionsService,
    private readonly metrics: MetricsService,
    private readonly commission: CommissionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async dashboard() {
    const [queues, attention, alerts] = await Promise.all([
      this.metrics.queues(),
      this.metrics.attention(),
      this.prisma.adminAlert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return {
      queues,
      attention,
      alerts: alerts.map((a) => ({ id: a.id, type: a.type, entityType: a.entityType, entityId: a.entityId, createdAt: iso(a.createdAt) })),
    };
  }

  async resolveAlert(actor: UserActor, id: string) {
    const res = await this.prisma.adminAlert.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: this.clock.now(), resolvedBy: actor.userId } });
    if (!res.count) throw notFound();
    await this.records.audit(this.prisma, actor, { action: 'alert.resolved', entityType: 'ADMIN_ALERT', entityId: id });
    return { ok: true };
  }

  // --- staff (USER_ADMIN) --------------------------------------------------------------------------
  private serializeStaff(u: { id: string; fullName: string | null; phoneE164: string; status: string; permissionFlags: string[]; phoneVerifiedAt: Date | null; createdAt: Date }) {
    return { id: u.id, fullName: u.fullName, phone: maskPhone(u.phoneE164), status: u.status, flags: u.permissionFlags, phoneVerified: !!u.phoneVerifiedAt, createdAt: iso(u.createdAt) };
  }

  async staff() {
    const rows = await this.prisma.user.findMany({ where: { roles: { some: { role: 'ADMIN' } } }, orderBy: { createdAt: 'asc' } });
    return { items: rows.map((u) => this.serializeStaff(u)) };
  }

  async createStaff(actor: UserActor, input: z.infer<typeof staffCreateSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { phoneE164: input.phone }, include: { roles: true } });
      // ADMIN is exclusive: a phone already used by an owner/customer cannot become an admin.
      if (existing && existing.roles.some((r) => r.role !== 'ADMIN')) throw validation({ path: 'phone', code: 'PHONE_HAS_OTHER_ROLES' });
      const user =
        existing ??
        (await tx.user.create({ data: { phoneE164: input.phone, fullName: input.fullName, phoneVerifiedAt: null, lastActiveRole: 'ADMIN' } }));
      await tx.user.update({ where: { id: user.id }, data: { permissionFlags: input.flags, fullName: input.fullName } });
      await tx.userRole.upsert({ where: { userId_role: { userId: user.id, role: 'ADMIN' } }, create: { userId: user.id, role: 'ADMIN' }, update: {} });
      await this.records.audit(tx, actor, { action: 'staff.created', entityType: 'USER', entityId: user.id, metadata: { flags: input.flags } });
      return this.serializeStaff({ ...user, permissionFlags: input.flags });
    });
  }

  async updateStaff(actor: UserActor, id: string, input: z.infer<typeof staffUpdateSchema>) {
    const user = await this.prisma.user.findFirst({ where: { id, roles: { some: { role: 'ADMIN' } } } });
    if (!user) throw notFound();
    if (id === actor.userId && input.flags && !input.flags.includes('USER_ADMIN')) throw validation({ path: 'flags', code: 'CANNOT_REMOVE_OWN_USER_ADMIN' });
    const updated = await this.prisma.user.update({
      where: { id },
      data: { ...(input.flags ? { permissionFlags: input.flags as PermissionFlag[] } : {}), ...(input.status ? { status: input.status } : {}) },
    });
    if (input.status === 'SUSPENDED') await this.sessions.revokeAllForUser(id);
    await this.records.audit(this.prisma, actor, {
      action: 'staff.updated',
      entityType: 'USER',
      entityId: id,
      metadata: { from: { flags: user.permissionFlags, status: user.status }, to: { flags: input.flags ?? user.permissionFlags, status: input.status ?? user.status } },
    });
    return this.serializeStaff(updated);
  }

  async users(q: string | undefined, role: 'OWNER' | 'CUSTOMER' | undefined, cursor: string | undefined, limit: number) {
    const rows = await this.prisma.user.findMany({
      where: {
        roles: role ? { some: { role } } : { some: { role: { in: ['OWNER', 'CUSTOMER'] } } },
        ...(q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { phoneE164: { contains: q.replace(/\s/g, '') } }] } : {}),
        ...afterCursor(cursor),
      },
      include: { roles: true, ownerProfile: true },
      orderBy: pageOrder,
      take: limit + 1,
    });
    return toPage(rows, limit, (u) => ({
      id: u.id,
      fullName: u.fullName,
      phone: maskPhone(u.phoneE164),
      roles: u.roles.map((r) => r.role),
      status: u.status,
      ownerVerification: u.ownerProfile?.verificationStatus ?? null,
      commissionOverrideBps: u.ownerProfile?.commissionOverrideBps ?? null,
      createdAt: iso(u.createdAt),
    }));
  }

  async setUserStatus(actor: UserActor, id: string, status: 'ACTIVE' | 'SUSPENDED') {
    const user = await this.prisma.user.findFirst({ where: { id, roles: { none: { role: 'ADMIN' } } } });
    if (!user) throw notFound();
    await this.prisma.user.update({ where: { id }, data: { status } });
    if (status === 'SUSPENDED') await this.sessions.revokeAllForUser(id);
    await this.records.audit(this.prisma, actor, { action: 'user.status_changed', entityType: 'USER', entityId: id, metadata: { status } });
    return { id, status };
  }

  // --- policy settings ---------------------------------------------------------------------------------
  async policies() {
    const values = await this.policy.all();
    const rows = await this.prisma.policySetting.findMany();
    return {
      items: POLICY_KEYS.map((key) => {
        const row = rows.find((r) => r.key === key);
        return {
          key,
          value: values[key],
          defaultValue: POLICIES[key].defaultValue,
          description: POLICIES[key].description,
          status: POLICIES[key].status,
          // Placeholders carry a visible "unconfirmed" note in the settings screen (SPEC §10).
          unconfirmed: POLICIES[key].status === 'PLACEHOLDER',
          editFlag: POLICIES[key].editFlag,
          updatedAt: iso(row?.updatedAt),
          updatedBy: row?.updatedBy ?? null,
        };
      }),
    };
  }

  async updatePolicy(actor: UserActor, key: string, value: unknown) {
    if (!(POLICY_KEYS as string[]).includes(key)) throw notFound();
    const def = POLICIES[key as PolicyKey];
    if (!hasFlag(actor, def.editFlag)) throw forbidden(`FLAG_REQUIRED:${def.editFlag}`);
    if (def.status === 'DECISION' && !key.startsWith('ai.')) throw new AppError('FORBIDDEN', [{ code: 'DECISION_NOT_EDITABLE' }]);
    const previous = await this.policy.get(key as PolicyKey);
    let parsed: unknown;
    try {
      parsed = await this.policy.set(key as PolicyKey, value, actor.userId);
    } catch (err) {
      if (err instanceof z.ZodError) throw validation(...err.issues.map((i) => ({ path: 'value', code: i.code, message: i.message })));
      throw err;
    }
    await this.records.audit(this.prisma, actor, { action: 'policy.updated', entityType: 'POLICY', entityId: key, metadata: { from: previous as Prisma.JsonValue, to: parsed as Prisma.JsonValue } });
    if (key.startsWith('commission.')) await this.commission.recordHistory(this.prisma, actor, `POLICY_UPDATED:${key}`);
    return { key, value: parsed };
  }

  // --- audit (AUDIT_VIEW) ----------------------------------------------------------------------------
  async audit(q: z.infer<typeof auditQuery>) {
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.action ? { action: { contains: q.action } } : {}),
        ...afterCursor(q.cursor),
      },
      orderBy: pageOrder,
      take: q.limit + 1,
    });
    const actors = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.actorId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    return toPage(rows, q.limit, (e) => ({
      id: e.id,
      action: e.action,
      actorId: e.actorId,
      actorName: actors.find((a) => a.id === e.actorId)?.fullName ?? (e.actorRole === 'SYSTEM' ? 'System' : null),
      actorRole: e.actorRole,
      entityType: e.entityType,
      entityId: e.entityId,
      onBehalfOfType: e.onBehalfOfType,
      onBehalfOfId: e.onBehalfOfId,
      metadata: e.metadata,
      requestId: e.requestId,
      createdAt: iso(e.createdAt),
    }));
  }
}

const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const usersQuery = paginationQuery.extend({ q: z.string().max(60).optional(), role: z.enum(['OWNER', 'CUSTOMER']).optional() });

@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Post('alerts/:id/resolve')
  @HttpCode(200)
  resolveAlert(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resolveAlert(a, id);
  }

  @Get('staff')
  staff() {
    return this.admin.staff();
  }

  @Flags('USER_ADMIN')
  @Post('staff')
  createStaff(@CurrentActor() a: UserActor, @Body(zp(staffCreateSchema)) body: z.infer<typeof staffCreateSchema>) {
    return this.admin.createStaff(a, body);
  }

  @Flags('USER_ADMIN')
  @Patch('staff/:id')
  updateStaff(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(staffUpdateSchema)) body: z.infer<typeof staffUpdateSchema>) {
    return this.admin.updateStaff(a, id, body);
  }

  @Get('users')
  users(@Query(zp(usersQuery)) q: z.infer<typeof usersQuery>) {
    return this.admin.users(q.q, q.role, q.cursor, q.limit);
  }

  @Flags('USER_ADMIN')
  @Post('users/:id/suspend')
  @HttpCode(200)
  suspend(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setUserStatus(a, id, 'SUSPENDED');
  }

  @Flags('USER_ADMIN')
  @Post('users/:id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setUserStatus(a, id, 'ACTIVE');
  }

  @Get('policy-settings')
  policies() {
    return this.admin.policies();
  }

  @Patch('policy-settings/:key')
  updatePolicy(@CurrentActor() a: UserActor, @Param('key') key: string, @Body(zp(policyUpdateSchema)) body: z.infer<typeof policyUpdateSchema>) {
    return this.admin.updatePolicy(a, key, body.value);
  }

  @Get('reports/operations')
  operations(@Query(zp(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    const { from, to } = this.range(q);
    return this.metrics.care(from, to);
  }

  @Get('reports/marketplace')
  marketplace(@Query(zp(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    const { from, to } = this.range(q);
    return this.metrics.marketplace(from, to);
  }

  @Flags('AUDIT_VIEW')
  @Get('audit-events')
  audit(@Query(zp(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.admin.audit(q);
  }

  private range(q: z.infer<typeof rangeQuery>) {
    const to = q.to ? new Date(`${q.to}T23:59:59+05:30`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00+05:30`) : new Date(to.getTime() - 30 * 86_400_000);
    return { from, to };
  }
}

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
