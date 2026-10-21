#!/usr/bin/env node
// Fails when the product name is hard-coded anywhere outside the brand config (SPEC §0.2).
// The default name lives only in packages/shared/src/brand.ts; docs may mention it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = ['ghar', 'setu'].join(''); // assembled so this script does not flag itself
const ALLOWED = new Set(['packages/shared/src/brand.ts']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.data', 'coverage', 'docs', '.git', 'test-results', 'playwright-report']);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.prisma', '.sql', '.yaml', '.yml', '.example']);
const SKIP_FILES = new Set(['README.md', 'CLAUDE.md', 'pnpm-lock.yaml']);

const offenders = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (ALLOWED.has(rel) || (SKIP_FILES.has(entry) && !rel.includes('/'))) continue;
    if (!EXTENSIONS.has(path.extname(entry)) && entry !== '.env.example') continue;
    const text = readFileSync(full, 'utf8');
    if (text.toLowerCase().includes(NAME)) offenders.push(rel);
  }
}
walk(root);
if (offenders.length) {
  console.error(`Hard-coded product name found (use the brand config instead):\n${offenders.map((o) => `  - ${o}`).join('\n')}`);
  process.exit(1);
}
console.log('Brand check passed: product name only in brand config.');
