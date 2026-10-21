/** SPEC §8.1 AUTH/ROLE acceptance criteria and §18.1 "Auth and roles". */
import { createTestContext, nextPhone, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('phone OTP', () => {
  it('signs up a new user who must then choose a role', async () => {
    const c = ctx.client();
    const phone = nextPhone();
    const req = await c.post('/auth/otp/request', { phone: phone.replace('+91', '') });
    expect(req.status).toBe(200);
    expect(req.body).toEqual({ challengeId: expect.any(String), expiresInSeconds: 300, resendAfterSeconds: 30 });
    // Only an HMAC verifier is stored, never the code.
    const stored = await ctx.prisma.otpChallenge.findUniqueOrThrow({ where: { id: req.body.challengeId } });
    expect(stored.verifier).not.toContain('123456');
    const verify = await c.post('/auth/otp/verify', { challengeId: req.body.challengeId, code: '123456' });
    expect(verify.status).toBe(200);
    expect(verify.body.onboarding).toEqual({ needsName: true, needsRole: true, needsServiceMode: false });
    // A user without a role cannot reach any owner or customer area (SPEC §3.7).
    expect((await c.get('/properties')).status).toBe(403);
    expect((await c.get('/bookings')).body.error.code).toBe('ROLE_REQUIRED');
    expect((await c.get('/me')).status).toBe(200);
  });

  it('rejects wrong, reused, expired and over-attempted codes with a generic error', async () => {
    const phone = nextPhone();
    const c = ctx.client();
    const r1 = await c.post('/auth/otp/request', { phone });
    expect((await c.post('/auth/otp/verify', { challengeId: r1.body.challengeId, code: '000000' })).body.error.code).toBe('OTP_INVALID');
    expect((await c.post('/auth/otp/verify', { challengeId: r1.body.challengeId, code: '123456' })).status).toBe(200);
    // Single use.
    expect((await c.post('/auth/otp/verify', { challengeId: r1.body.challengeId, code: '123456' })).body.error.code).toBe('OTP_INVALID');

    ctx.clock.advance(31_000);
    const r2 = await c.post('/auth/otp/request', { phone });
    for (let i = 0; i < 5; i++) await c.post('/auth/otp/verify', { challengeId: r2.body.challengeId, code: '999999' });
    // The sixth attempt fails even with the right code.
    expect((await c.post('/auth/otp/verify', { challengeId: r2.body.challengeId, code: '123456' })).body.error.code).toBe('OTP_INVALID');

    ctx.clock.advance(31_000);
    const r3 = await c.post('/auth/otp/request', { phone });
    ctx.clock.advance(301_000);
    expect((await c.post('/auth/otp/verify', { challengeId: r3.body.challengeId, code: '123456' })).body.error.code).toBe('OTP_INVALID');
  });

  it('enforces the resend cooldown and the hourly limit per phone', async () => {
    const phone = nextPhone();
    const c = ctx.client();
    expect((await c.post('/auth/otp/request', { phone })).status).toBe(200);
    const again = await c.post('/auth/otp/request', { phone });
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('RATE_LIMITED');
    for (let i = 0; i < 4; i++) {
      ctx.clock.advance(31_000);
      // Challenges are timestamped with the app clock, so the hourly window is deterministic.
      expect((await c.post('/auth/otp/request', { phone })).status).toBe(200);
    }
    ctx.clock.advance(31_000);
    expect((await c.post('/auth/otp/request', { phone })).status).toBe(429);
  });

  it('rejects non-Indian numbers', async () => {
    const res = await ctx.client().post('/auth/otp/request', { phone: '+14155552671' });
    expect(res.status).toBe(422);
  });

  it('applies the per-IP limiter when enabled', async () => {
    const { RateLimiter } = await import('../src/core/rate-limit');
    const limiter = ctx.app.get(RateLimiter);
    limiter.enabled = true;
    try {
      const c = ctx.client();
      let last = 0;
      for (let i = 0; i < 22; i++) last = (await c.post('/auth/otp/request', { phone: nextPhone() })).status;
      expect(last).toBe(429);
    } finally {
      limiter.enabled = false;
      limiter.reset();
    }
  });
});

describe('sessions, CSRF and roles', () => {
  it('returns 401 without a session and 403 without a CSRF token', async () => {
    const anon = ctx.client();
    expect((await anon.get('/me')).status).toBe(401);
    const owner = await ctx.owner();
    const noCsrf = await owner.client.agent.post('/api/v1/properties').send({});
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_INVALID');
  });

  it('adds roles, switches the active role and keeps role-scoped access', async () => {
    const owner = await ctx.owner();
    expect((await owner.client.get('/properties')).status).toBe(200);
    expect((await owner.client.get('/trips')).status).toBe(404);
    // Switching to a role the user does not hold fails.
    expect((await owner.client.post('/me/active-role', { role: 'CUSTOMER' })).status).toBe(403);
    const added = await owner.client.post('/me/roles', { role: 'CUSTOMER' });
    expect(added.body.roles.sort()).toEqual(['CUSTOMER', 'OWNER']);
    expect(added.body.activeRole).toBe('CUSTOMER');
    // As a customer the owner area is forbidden.
    expect((await owner.client.get('/properties')).status).toBe(403);
    expect((await owner.client.post('/me/active-role', { role: 'OWNER' })).body.activeRole).toBe('OWNER');
    expect((await owner.client.get('/properties')).status).toBe(200);
  });

  it('never lets self-service produce an admin and keeps ADMIN exclusive', async () => {
    const c = await ctx.login(nextPhone());
    expect((await c.post('/me/roles', { role: 'ADMIN' })).status).toBe(422);
    const admin = await ctx.admin();
    expect((await admin.client.post('/me/roles', { role: 'OWNER' })).status).toBe(403);
    // The database trigger rejects ADMIN alongside another role.
    await expect(ctx.prisma.userRole.create({ data: { userId: admin.id, role: 'CUSTOMER' } })).rejects.toThrow();
  });

  it('treats a logged-out booking attempt as CUSTOMER without the role page', async () => {
    const phone = nextPhone();
    const c = ctx.client();
    const r = await c.post('/auth/otp/request', { phone });
    const v = await c.post('/auth/otp/verify', { challengeId: r.body.challengeId, code: '123456', intent: 'BOOKING' });
    expect(v.body.activeRole).toBe('CUSTOMER');
    expect(v.body.onboarding.needsRole).toBe(false);
  });

  it('revokes the session on logout and blocks suspended users', async () => {
    const owner = await ctx.owner();
    expect((await owner.client.post('/auth/logout')).status).toBe(200);
    expect((await owner.client.get('/me')).status).toBe(401);
    await ctx.prisma.user.update({ where: { id: owner.id }, data: { status: 'SUSPENDED' } });
    ctx.clock.advance(31_000);
    await expect(ctx.login(owner.phone)).rejects.toThrow(/otp verify 422/);
  });

  it('expires idle sessions per policy', async () => {
    const owner = await ctx.owner();
    ctx.clock.advance(31 * 24 * 3_600_000);
    expect((await owner.client.get('/me')).status).toBe(401);
  });

  it('gives admins shorter sessions', async () => {
    const admin = await ctx.admin();
    ctx.clock.advance(13 * 3_600_000);
    expect((await admin.client.get('/me')).status).toBe(401);
  });
});
