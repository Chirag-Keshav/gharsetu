/**
 * Generates docs/openapi.json (SPEC §12.9) by reading the controllers' route decorators and turning
 * the shared zod schemas used in `zp(...)` into JSON Schema. Request bodies and query parameters
 * come from the same schemas the API validates with, so the document cannot drift from them.
 *
 *   pnpm --filter @propcare/api openapi
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as shared from '@propcare/shared';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const SRC = path.resolve(__dirname, '../src');
const OUT = path.resolve(__dirname, '../../../docs/openapi.json');

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));

const schemas = shared as unknown as Record<string, unknown>;
const isZod = (v: unknown): v is ZodTypeAny => !!v && typeof v === 'object' && 'safeParse' in (v as object);
function toJson(name: string): Record<string, unknown> | null {
  const s = schemas[name];
  if (!isZod(s)) return null;
  const json = (zodToJsonSchema as (s: unknown, o: object) => Record<string, unknown>)(s, { target: 'openApi3', $refStrategy: 'none' });
  delete json.$schema;
  return json;
}

interface Route {
  method: string;
  path: string;
  tag: string;
  roles: string[];
  flags: string[];
  isPublic: boolean;
  idempotent: boolean;
  body: string | null;
  query: string | null;
}

const routes: Route[] = [];
for (const file of walk(SRC).filter((f) => f.endsWith('.ts'))) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('@Controller(')) continue;
  // Split per controller class so each method uses its own controller prefix and class-level roles.
  const blocks = text.split(/(?=@Controller\()/).slice(1);
  for (const block of blocks) {
    const prefix = block.match(/^@Controller\((?:'([^']*)')?\)/)?.[1] ?? '';
    const header = block.slice(0, block.indexOf('{'));
    const classRoles = [...header.matchAll(/@Roles\(([^)]*)\)/g)].flatMap((m) => m[1].match(/'([A-Z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
    const classPublic = header.includes('@Public()');
    // Decorators, then the handler signature up to its opening brace (parameters nest parentheses).
    const methodRe = /((?:\s*@[A-Za-z]+\([^)]*\)\s*)+)\s*(?:async\s+)?[a-zA-Z]+\(([\s\S]*?)\)\s*(?::[^{;]+)?\{/g;
    for (const m of block.matchAll(methodRe)) {
      const decorators = m[1];
      const verb = decorators.match(/@(Get|Post|Patch|Put|Delete)\((?:'([^']*)')?\)/);
      if (!verb) continue;
      const params = m[2];
      const sub = verb[2] ?? '';
      const full = `/api/v1/${[prefix, sub].filter(Boolean).join('/')}`.replace(/:([a-zA-Z]+)/g, '{$1}').replace(/\/+$/, '');
      const roles = [...decorators.matchAll(/@Roles\(([^)]*)\)/g)].flatMap((x) => x[1].match(/'([A-Z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
      const flags = [...decorators.matchAll(/@Flags\(([^)]*)\)/g)].flatMap((x) => x[1].match(/'([A-Z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
      routes.push({
        method: verb[1].toLowerCase(),
        path: full,
        tag: prefix.split('/')[0] || path.basename(file, '.ts').split('.')[0],
        roles: roles.length ? roles : classRoles,
        flags,
        isPublic: classPublic || decorators.includes('@Public()'),
        idempotent: decorators.includes('@Idempotent()'),
        body: params.match(/@Body\(zp\(([A-Za-z0-9_]+)\)\)/)?.[1] ?? null,
        query: params.match(/@Query\(zp\(([A-Za-z0-9_]+)\)\)/)?.[1] ?? null,
      });
    }
  }
}

const error = { $ref: '#/components/schemas/Error' };
const paths: Record<string, Record<string, unknown>> = {};
for (const r of routes.sort((a, b) => a.path.localeCompare(b.path))) {
  const pathParams = [...r.path.matchAll(/\{([a-zA-Z]+)\}/g)].map((p) => ({ name: p[1], in: 'path', required: true, schema: { type: 'string', format: p[1] === 'provider' ? undefined : 'uuid' } }));
  const query = r.query ? toJson(r.query) : null;
  const queryParams = query && typeof query.properties === 'object' ? Object.entries(query.properties as Record<string, unknown>).map(([name, schema]) => ({ name, in: 'query', required: false, schema })) : [];
  const body = r.body ? toJson(r.body) : null;
  const access = r.isPublic ? 'Public' : `Roles: ${r.roles.join(', ') || 'any signed-in role'}${r.flags.length ? ` · flags: ${r.flags.join(', ')}` : ''}`;
  paths[r.path] ??= {};
  paths[r.path][r.method] = {
    tags: [r.tag],
    summary: `${r.method.toUpperCase()} ${r.path}`,
    description: `${access}${r.idempotent ? ' · requires Idempotency-Key header' : ''}`,
    ...(r.isPublic ? { security: [] } : {}),
    parameters: [
      ...pathParams,
      ...queryParams,
      ...(r.idempotent ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' } }] : []),
    ],
    ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
    responses: {
      '200': { description: 'OK' },
      '400': { description: 'Validation failed', content: { 'application/json': { schema: error } } },
      '401': { description: 'Not signed in', content: { 'application/json': { schema: error } } },
      '403': { description: 'Wrong role or missing permission flag', content: { 'application/json': { schema: error } } },
      '404': { description: "Not found (also returned for other users' resources)", content: { 'application/json': { schema: error } } },
    },
  };
}

const doc = {
  openapi: '3.1.0',
  info: { title: `${shared.brandFromEnv(process.env).productName} API`, version: '0.1.0', description: 'Generated from controller decorators and shared zod schemas. Cookie session + double-submit CSRF (x-csrf-token header) on mutating requests.' },
  servers: [{ url: 'http://localhost:4000' }],
  components: {
    securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'sid' }, csrf: { type: 'apiKey', in: 'header', name: 'x-csrf-token' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } } } } },
          },
        },
      },
    },
  },
  security: [{ session: [], csrf: [] }],
  paths,
};

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), OUT)}: ${routes.length} operations, ${routes.filter((r) => r.body).length} with request schemas.`);
