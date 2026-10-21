import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, type AuthedRequest, type RateLimitOptions } from './context';
import { AppError } from './errors';

/**
 * In-memory fixed-window limiter (per instance). Multi-instance deployments should back this with
 * Redis; OTP per-phone limits are enforced in the database and are already global.
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();
  enabled = process.env.NODE_ENV !== 'test';

  hit(key: string, limit: number, windowMs: number): void {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - this.lastSweep > 60_000) this.sweep(now);
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    w.count += 1;
    if (w.count > limit) throw new AppError('RATE_LIMITED');
  }

  reset(): void {
    this.windows.clear();
  }

  private sweep(now: number): void {
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    this.lastSweep = now;
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!opts) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    this.limiter.hit(`${opts.bucket}:${req.ipHash ?? 'unknown'}`, opts.limit, opts.windowMs);
    return true;
  }
}
