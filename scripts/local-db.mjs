#!/usr/bin/env node
// Local PostgreSQL 16 for development and tests without Docker.
//
// Uses the binaries shipped by the `embedded-postgres` npm package. They are copied to a short
// directory first (default: %LOCALAPPDATA%\propcare on Windows, ~/.propcare elsewhere) because the
// Postgres executables are not long-path aware and fail inside deeply nested node_modules folders.
//
// Usage: node scripts/local-db.mjs start | stop | status | reset
// Env:   PROPCARE_LOCAL_DIR, LOCAL_PG_PORT (default 54329)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const isWin = process.platform === 'win32';
const exe = (name) => (isWin ? `${name}.exe` : name);

const baseDir =
  process.env.PROPCARE_LOCAL_DIR ??
  (isWin ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'propcare') : path.join(os.homedir(), '.propcare'));
const pgHome = path.join(baseDir, 'pg16');
const binDir = path.join(pgHome, 'bin');
const dataDir = path.join(baseDir, 'data');
const logFile = path.join(baseDir, 'postgres.log');
const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const password = 'postgres';
const databases = ['propcare', 'propcare_test'];

function run(cmd, args, opts = {}) {
  const res = spawnSync(path.join(binDir, exe(cmd)), args, {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: password },
    ...opts,
  });
  if (res.error) throw res.error;
  return res;
}

function ensureBinaries() {
  if (existsSync(path.join(binDir, exe('postgres')))) return;
  const platform = isWin ? 'windows' : process.platform;
  const pkg = `@embedded-postgres/${platform}-${process.arch}`;
  let pkgRoot;
  try {
    pkgRoot = path.dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    console.error(`Could not find ${pkg}. Run "pnpm install" first (or use docker compose).`);
    process.exit(1);
  }
  console.log(`Copying PostgreSQL binaries to ${pgHome} ...`);
  mkdirSync(baseDir, { recursive: true });
  cpSync(path.join(pkgRoot, 'native'), pgHome, { recursive: true, verbatimSymlinks: true });
  // Re-create shared-library symlinks that the package's (blocked) postinstall would have created.
  const linkFile = path.join(pgHome, 'pg-symlinks.json');
  if (existsSync(linkFile)) {
    const links = JSON.parse(readFileSync(linkFile, 'utf8'));
    for (const { source, target } of links) {
      const rel = (p) => path.join(pgHome, path.relative(path.join(pkgRoot, 'native'), path.resolve(pkgRoot, p)));
      try {
        symlinkSync(path.relative(path.dirname(rel(target)), rel(source)), rel(target));
      } catch {
        // already exists
      }
    }
  }
}

function ensureCluster() {
  if (existsSync(path.join(dataDir, 'PG_VERSION'))) return;
  console.log(`Initialising cluster in ${dataDir} ...`);
  const pwFile = path.join(baseDir, 'pwfile');
  writeFileSync(pwFile, password);
  const res = run('initdb', ['-D', dataDir, '-U', 'postgres', `--pwfile=${pwFile}`, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C']);
  rmSync(pwFile, { force: true });
  if (res.status !== 0) {
    console.error(res.stdout, res.stderr);
    process.exit(1);
  }
}

function isRunning() {
  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) return false;
  return run('pg_ctl', ['-D', dataDir, 'status']).status === 0;
}

async function ensureDatabases() {
  // The embedded distribution has no psql/createdb, so use the node client.
  const { default: pg } = await import('pg');
  const client = new pg.Client({ host: 'localhost', port, user: 'postgres', password, database: 'postgres' });
  await client.connect();
  try {
    for (const db of databases) {
      const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [db]);
      if (!rowCount) {
        await client.query(`create database "${db}"`);
        console.log(`Created database ${db}`);
      }
    }
  } finally {
    await client.end();
  }
}

const command = process.argv[2] ?? 'status';
switch (command) {
  case 'start': {
    ensureBinaries();
    ensureCluster();
    if (!isRunning()) {
      const res = run('pg_ctl', ['-D', dataDir, '-o', `-p ${port}`, '-l', logFile, '-w', 'start'], { stdio: 'ignore' });
      if (res.status !== 0) {
        console.error(`PostgreSQL failed to start; see ${logFile}`);
        process.exit(1);
      }
    }
    await ensureDatabases();
    console.log(`PostgreSQL is running on port ${port}.`);
    console.log(`DATABASE_URL=postgresql://postgres:${password}@localhost:${port}/propcare`);
    break;
  }
  case 'stop':
    if (isRunning()) run('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop'], { stdio: 'inherit' });
    else console.log('PostgreSQL is not running.');
    break;
  case 'status':
    console.log(isRunning() ? `running on port ${port} (data: ${dataDir})` : 'stopped');
    break;
  case 'reset':
    // Destructive: local development cluster only.
    if (isRunning()) run('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
    rmSync(dataDir, { recursive: true, force: true });
    console.log('Local cluster removed. Run "pnpm db:start" to recreate it.');
    break;
  default:
    console.error('Usage: local-db.mjs start | stop | status | reset');
    process.exit(1);
}
