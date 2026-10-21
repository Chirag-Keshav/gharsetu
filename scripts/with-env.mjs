#!/usr/bin/env node
// Loads the repository-root .env, then runs the given command. Used for Prisma CLI and scripts so
// every package reads the same configuration. Existing environment variables win.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

let args = process.argv.slice(2);
// `--test-db` points DATABASE_URL at TEST_DATABASE_URL (for test setup and test migrations).
if (args[0] === '--test-db') {
  args = args.slice(1);
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (args.length === 0) {
  console.error('Usage: with-env.mjs [--test-db] <command> [...args]');
  process.exit(1);
}
const child = spawn(args[0], args.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 1));
