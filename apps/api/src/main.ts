import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { ENV, loadEnv, type Env } from './config/env';
import { configureLogger, log } from './core/logger';
import { PolicyService } from './core/policy.service';

async function bootstrap() {
  // Fails fast on invalid configuration, including OTP_TEST_MODE in production (SPEC §8.1).
  const env = loadEnv();
  configureLogger({ level: env.LOG_LEVEL, silent: false });
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  configureApp(app);
  app.enableShutdownHooks();
  await app.get(PolicyService).ensureDefaults();
  const port = app.get<Env>(ENV).API_PORT;
  await app.listen(port);
  log.info('api_started', { port, env: env.NODE_ENV, otpTestMode: env.OTP_TEST_MODE, aiProvider: env.AI_ENABLED ? env.AI_PROVIDER : 'disabled' });
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
