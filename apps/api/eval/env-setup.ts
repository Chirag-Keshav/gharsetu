/**
 * `pnpm ai:eval` reads the seeded development database (read-only: dryRun writes nothing) and uses
 * whichever AI provider .env configures — mock by default, Anthropic when AI_PROVIDER=anthropic.
 */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
Object.assign(process.env, { JOBS_ENABLED: 'false', AI_ENABLED: 'true', LOG_LEVEL: 'error' });
