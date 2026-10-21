#!/usr/bin/env node
// Runs the shared package watcher, the API and the web app together with prefixed output.
import { spawn, spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';
const pnpm = isWin ? 'pnpm.cmd' : 'pnpm';

const build = spawnSync(pnpm, ['--filter', '@propcare/shared', 'build'], { stdio: 'inherit', shell: isWin });
if (build.status !== 0) process.exit(build.status ?? 1);

const procs = [
  { name: 'shared', color: 35, args: ['--filter', '@propcare/shared', 'dev'] },
  { name: 'api', color: 36, args: ['--filter', '@propcare/api', 'dev'] },
  { name: 'web', color: 32, args: ['--filter', '@propcare/web', 'dev'] },
];

const children = procs.map(({ name, color, args }) => {
  const child = spawn(pnpm, args, { shell: isWin, env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
  });
  return child;
});

const shutdown = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
