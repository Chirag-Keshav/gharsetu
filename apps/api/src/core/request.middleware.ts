import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { ENV, type Env } from '../config/env';
import { requestStore, type AuthedRequest } from './context';
import { hmac, randomToken } from './crypto';
import { log } from './logger';
import { CSRF_COOKIE } from './sessions.service';

/**
 * Assigns a request ID, hashes the client IP (raw IPs are never stored), issues the CSRF cookie and
 * writes one structured access-log line without query strings or bodies (SPEC §14.5).
 */
@Injectable()
export class RequestMiddleware implements NestMiddleware {
  constructor(@Inject(ENV) private readonly env: Env) {}

  use(req: AuthedRequest, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    const ip = (req.header('x-forwarded-for')?.split(',')[0] ?? req.socket.remoteAddress ?? '').trim();
    req.ipHash = ip ? hmac(this.env.IP_HASH_SALT, ip).slice(0, 32) : null;
    res.setHeader('x-request-id', requestId);

    if (!req.cookies?.[CSRF_COOKIE]) {
      const token = randomToken(24);
      req.cookies = { ...(req.cookies ?? {}), [CSRF_COOKIE]: token };
      res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: '/' });
    }

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      log.info('http_request', {
        requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(ms),
      });
    });
    requestStore.run({ requestId, ipHash: req.ipHash }, () => next());
  }
}
