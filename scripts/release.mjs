#!/usr/bin/env node
/**
 * Pipeline de release de MARU Desktop.
 *
 * Pasos:
 *   1. Verifica que el árbol git esté limpio (si .git existe).
 *   2. Verifica que GH_TOKEN esté seteado (necesario para publicar a un repo
 *      privado de GitHub Releases).
 *   3. Bumpea versión en `apps/desktop/package.json` (patch | minor | major).
 *   4. Builda sidecar (PyInstaller --onedir, ver F7).
 *   5. Builda Electron (`pnpm --filter @maru/desktop build`).
 *   6. Empaqueta + publica con electron-builder (`--publish always`).
 *
 * Uso:
 *   node scripts/release.mjs patch
 *   node scripts/release.mjs minor
 *   node scripts/release.mjs major
 *   node scripts/release.mjs 1.2.3       # versión exacta
 *
 * Requiere:
 *   - GH_TOKEN env var con permisos `repo` en el repo de releases.
 *   - Para macOS: certificados de firma (en F7 se documenta).
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DESKTOP_PKG = resolve(ROOT, 'apps/desktop/package.json');

function run(cmd, opts = {}) {
  console.log(`\n› ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function bump(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [maj, min, pat] = current.split('.').map(Number);
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`bump kind inválido: ${kind}`);
}

function ensureGitClean() {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch {
    console.log('› (sin git, salteando check de árbol limpio)');
    return;
  }
  const out = execSync('git status --porcelain').toString().trim();
  if (out) {
    console.error('Árbol git no está limpio:\n' + out);
    process.exit(1);
  }
}

function ensureToken() {
  if (process.env.MARU_SKIP_PUBLISH === '1') return;
  if (!process.env.GH_TOKEN) {
    console.error(
      '\nERROR: GH_TOKEN no está seteado. Necesario para publicar a GitHub Releases privado.\n' +
        'Ejemplo: GH_TOKEN=ghp_xxx node scripts/release.mjs patch\n',
    );
    process.exit(1);
  }
}

const kind = process.argv[2];
if (!kind) {
  console.error('Uso: node scripts/release.mjs <patch|minor|major|x.y.z>');
  process.exit(1);
}

ensureToken();
ensureGitClean();

const pkg = readJson(DESKTOP_PKG);
const next = bump(pkg.version, kind);
console.log(`\n› Bump: ${pkg.version} → ${next}`);
pkg.version = next;
writeJson(DESKTOP_PKG, pkg);

run('pnpm --filter @maru/sidecar build');
run('pnpm --filter @maru/desktop build');

const publishFlag = process.env.MARU_SKIP_PUBLISH === '1' ? '--publish never' : '--publish always';
run(
  `pnpm --filter @maru/desktop exec electron-builder --config electron-builder.yml ${publishFlag}`,
  {},
);

console.log(`\n✓ Release ${next} completado.`);
console.log('  Si hay GH_TOKEN, ya se publicó a GitHub Releases.');
console.log('  Verificá el latest.yml en el release recién creado.');
