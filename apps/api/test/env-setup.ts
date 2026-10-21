/** Points every test at the test database with deterministic adapters (mock AI, mock payments). */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set (run "pnpm env:init" and "pnpm db:start")');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
Object.assign(process.env, {
  NODE_ENV: 'test',
  JOBS_ENABLED: 'false',
  AI_ENABLED: 'true',
  AI_PROVIDER: 'mock',
  OTP_TEST_MODE: 'true',
  COOKIE_SECURE: 'false',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: '.data/test-storage',
  QUEUE_DRIVER: 'inprocess',
});
