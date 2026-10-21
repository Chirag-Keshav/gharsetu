import path from 'node:path';
import { Global, Module } from '@nestjs/common';
import { MOCK_SIGNATURE_HEADER, MockPaymentProvider, PAYMENT_PROVIDER } from '../adapters/payments';
import { ConsoleSmsProvider, SMS_PROVIDER } from '../adapters/sms';
import { LocalObjectStorage, MALWARE_SCANNER, NoopScanner, OBJECT_STORAGE, S3ObjectStorage } from '../adapters/storage';
import { ENV, findRepoRoot, loadEnv, type Env } from '../config/env';
import { CLOCK, SystemClock } from './clock';
import { FIELD_CIPHER, FieldCipher } from './crypto';
import { PolicyService } from './policy.service';
import { PrismaService } from './prisma.service';
import { RateLimiter } from './rate-limit';
import { RecordsService } from './records.service';
import { SessionsService } from './sessions.service';

export { MOCK_SIGNATURE_HEADER };

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: CLOCK, useClass: SystemClock },
    PrismaService,
    PolicyService,
    RecordsService,
    SessionsService,
    RateLimiter,
    { provide: FIELD_CIPHER, inject: [ENV], useFactory: (env: Env) => new FieldCipher(env.ACCESS_NOTES_KEY) },
    { provide: SMS_PROVIDER, useFactory: () => new ConsoleSmsProvider() },
    { provide: PAYMENT_PROVIDER, inject: [ENV], useFactory: (env: Env) => new MockPaymentProvider(env.PAYMENT_WEBHOOK_SECRET) },
    {
      provide: OBJECT_STORAGE,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.STORAGE_DRIVER === 's3'
          ? new S3ObjectStorage({
              endpoint: env.S3_ENDPOINT,
              region: env.S3_REGION,
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
              privateBucket: env.S3_PRIVATE_BUCKET!,
              publicBucket: env.S3_PUBLIC_BUCKET!,
              forcePathStyle: env.S3_FORCE_PATH_STYLE,
              publicBaseUrl: env.PUBLIC_MEDIA_BASE_URL,
            })
          : new LocalObjectStorage(path.resolve(findRepoRoot(), env.STORAGE_LOCAL_DIR), env.STORAGE_SIGNING_SECRET),
    },
    { provide: MALWARE_SCANNER, useFactory: () => new NoopScanner() },
  ],
  exports: [
    ENV,
    CLOCK,
    PrismaService,
    PolicyService,
    RecordsService,
    SessionsService,
    RateLimiter,
    FIELD_CIPHER,
    SMS_PROVIDER,
    PAYMENT_PROVIDER,
    OBJECT_STORAGE,
    MALWARE_SCANNER,
  ],
})
export class CoreModule {}
