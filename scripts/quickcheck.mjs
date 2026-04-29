#!/usr/bin/env node
/**
 * quickcheck — verifica que el repo está sano antes de un release o demo.
 *
 * Chequea (sin tocar nada):
 *   1. Estructura de carpetas obligatoria existe.
 *   2. package.json del root y de cada app/package son válidos.
 *   3. Tests Python pasan.
 *   4. El sidecar arranca y emite el handshake.
 *   5. Reporta versión + cuenta de archivos.
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const REQUIRED_PATHS = [
  'apps/desktop/src/main/index.ts',
  'apps/desktop/src/preload/index.ts',
  'apps/desktop/src/renderer/main.tsx',
  'apps/desktop/electron.vite.config.ts',
  'apps/desktop/electron-builder.yml',
  'apps/sidecar/maru_sidecar/__main__.py',
  'apps/sidecar/sidecar.spec',
  'apps/sidecar/build.py',
  'packages/shared/src/rpc/methods.ts',
  'packages/ui/src/index.ts',
  'docs/PHASE_0.md',
  'docs/PHASE_1.md',
  'docs/PHASE_2.md',
  'docs/PHASE_4.md',
  'docs/PHASE_5.md',
  'docs/PHASE_6.md',
  'docs/RELEASE.md',
];

const REQUIRED_PKGS = [
  'package.json',
  'apps/desktop/package.json',
  'apps/sidecar/package.json',
  'packages/shared/package.json',
  'packages/ui/package.json',
  'packages/tsconfig/package.json',
];

let failed = 0;
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function bad(msg) {
  console.error(`  ✗ ${msg}`);
  failed++;
}

console.log('\n› Estructura de archivos obligatoria');
for (const p of REQUIRED_PATHS) {
  if (existsSync(join(ROOT, p))) ok(p);
  else bad(`falta: ${p}`);
}

console.log('\n› package.json válidos');
for (const p of REQUIRED_PKGS) {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
    if (!j.name) throw new Error('sin name');
    ok(`${p}  → ${j.name}@${j.version ?? '?'}`);
  } catch (err) {
    bad(`${p}: ${err.message}`);
  }
}

console.log('\n› Tests Python');
try {
  execSync('python -m pytest tests -q', {
    cwd: join(ROOT, 'apps/sidecar'),
    stdio: 'pipe',
  });
  ok('pytest verde');
} catch (err) {
  const out = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
  bad(`pytest falló:\n${out.split('\n').slice(-10).join('\n')}`);
}

console.log('\n› Smoke test del sidecar (handshake)');
await new Promise((res) => {
  const p = spawn(
    process.platform === 'win32' ? 'python' : 'python3',
    ['-m', 'maru_sidecar', '--rpc-port', '0', '--ready-stdout', '--log-level', 'WARNING'],
    { cwd: join(ROOT, 'apps/sidecar') },
  );
  let resolved = false;
  const finish = (good, msg) => {
    if (resolved) return;
    resolved = true;
    if (good) ok(msg);
    else bad(msg);
    p.kill();
    res();
  };
  const t = setTimeout(() => finish(false, 'timeout esperando handshake (10s)'), 10000);
  p.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.includes('MARU_SIDECAR_READY')) {
      clearTimeout(t);
      finish(true, text.split('\n').find((l) => l.startsWith('MARU_SIDECAR_READY')));
    }
  });
  p.on('error', (err) => {
    clearTimeout(t);
    finish(false, `no se pudo arrancar el sidecar: ${err.message}`);
  });
});

console.log(failed === 0 ? '\n✓ Todo OK\n' : `\n✗ ${failed} chequeo(s) fallaron\n`);
process.exit(failed === 0 ? 0 : 1);
