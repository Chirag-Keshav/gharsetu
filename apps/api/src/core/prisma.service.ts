import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ENV, type Env } from '../config/env';

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ datasources: { db: { url: env.DATABASE_URL } }, log: ['warn', 'error'] });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Runs `fn` in a READ COMMITTED transaction with a generous timeout for row locks. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000, maxWait: 10_000 });
  }
}

/** Postgres error code carried by a Prisma error, if any (e.g. 23P01 exclusion violation). */
export function pgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  if (e.meta?.code) return e.meta.code;
  const m = /(?:Code|code):?\s*`?(\w{5})`?/.exec(e.message ?? '');
  if (m) return m[1];
  if (e.message?.includes('exclusion constraint')) return '23P01';
  if (e.message?.includes('P0001') || e.message?.includes('is frozen') || e.message?.includes('append-only')) return 'P0001';
  return undefined;
}

export function isExclusionViolation(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? '';
  return pgErrorCode(err) === '23P01' || msg.includes('conflicting key value violates exclusion constraint');
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002' || pgErrorCode(err) === '23505';
}
