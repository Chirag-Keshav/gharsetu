import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { LocalObjectStorage, OBJECT_STORAGE, type ObjectStorage } from './adapters/storage';
import { ENV, type Env } from './config/env';
import { AllExceptionsFilter, errorBody } from './core/exception.filter';

/** Shared HTTP setup for the server and for integration tests. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.disable('x-powered-by');
  http.set('trust proxy', 1);

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (env.COOKIE_SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(cookieParser());
  // Local storage driver: signed PUT uploads carry raw bytes.
  app.use('/api/v1/storage/upload', express.raw({ type: () => true, limit: '110mb' }));
  // Keep the raw body for webhook signature verification.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
  if (storage instanceof LocalObjectStorage) {
    // Only published-listing photo variants live in the public bucket (SPEC §14.1 media rules).
    app.use('/media', express.static(storage.publicDir(), { maxAge: '1d', index: false, dotfiles: 'deny' }));
    app.use('/media', (_req: Request, res: Response) => {
      res.status(404).json(errorBody('NOT_FOUND'));
    });
  }
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
}
