/** Environment configuration, validated with zod at startup (SPEC §0.3 rule 4, §5 "Hosting"). */
import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes'].includes(v.trim().toLowerCase())));
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    DATABASE_URL: z.string().min(1),
    OTP_HMAC_SECRET: z.string().min(16),
    OTP_TEST_MODE: boolish.default(false),
    COOKIE_SECURE: boolish.default(true),
    ACCESS_NOTES_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'ACCESS_NOTES_KEY must be 32 bytes, base64-encoded'),
    STORAGE_SIGNING_SECRET: z.string().min(16),
    IP_HASH_SALT: z.string().min(8),
    SMS_PROVIDER: z.enum(['console']).default('console'),
    PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
    PAYMENT_WEBHOOK_SECRET: z.string().min(16),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('.data/storage'),
    S3_ENDPOINT: optional,
    S3_REGION: optional,
    S3_ACCESS_KEY_ID: optional,
    S3_SECRET_ACCESS_KEY: optional,
    S3_PRIVATE_BUCKET: optional,
    S3_PUBLIC_BUCKET: optional,
    S3_FORCE_PATH_STYLE: boolish.default(true),
    PUBLIC_MEDIA_BASE_URL: optional,
    MALWARE_SCANNER: z.enum(['none']).default('none'),
    QUEUE_DRIVER: z.enum(['inprocess', 'bullmq']).default('inprocess'),
    REDIS_URL: optional,
    JOBS_ENABLED: boolish.default(true),
    AI_ENABLED: boolish.default(false),
    AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    ANTHROPIC_API_KEY: optional,
    AI_MODEL_FAST: optional,
    AI_MODEL_SMART: optional,
    AI_REFUSAL_FALLBACK: z.enum(['smart', 'all', 'none']).default('smart'),
  })
  .superRefine((env, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (env.NODE_ENV === 'production') {
      if (env.OTP_TEST_MODE) fail('OTP_TEST_MODE must not be enabled in production');
      if (env.SMS_PROVIDER === 'console') fail('ConsoleSmsProvider is for development only');
      if (env.PAYMENT_PROVIDER === 'mock') fail('MockPaymentProvider is for development and staging only');
      if (!env.COOKIE_SECURE) fail('COOKIE_SECURE must be true in production');
    }
    if (env.AI_ENABLED && env.AI_PROVIDER === 'anthropic' && (!env.ANTHROPIC_API_KEY || !env.AI_MODEL_FAST || !env.AI_MODEL_SMART)) {
      fail('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY, AI_MODEL_FAST and AI_MODEL_SMART');
    }
    if (env.QUEUE_DRIVER === 'bullmq' && !env.REDIS_URL) fail('QUEUE_DRIVER=bullmq needs REDIS_URL');
    if (env.STORAGE_DRIVER === 's3' && (!env.S3_PRIVATE_BUCKET || !env.S3_PUBLIC_BUCKET)) {
      fail('STORAGE_DRIVER=s3 needs S3_PRIVATE_BUCKET and S3_PUBLIC_BUCKET');
    }
  });

export type Env = z.infer<typeof envSchema>;
export const ENV = Symbol('ENV');

/** Walks up from this file to the workspace root (the folder holding pnpm-workspace.yaml). */
export function findRepoRoot(start = __dirname): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

let loadedDotenv = false;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (!loadedDotenv && source === process.env) {
    dotenv.config({ path: path.join(findRepoRoot(), '.env'), quiet: true });
    loadedDotenv = true;
  }
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
