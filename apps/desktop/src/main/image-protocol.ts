/**
 * Custom protocol `maru://` para servir imágenes del bundle (G2.2).
 *
 * Resuelve URLs como:
 *   maru://images/donaciones/Rose.png
 *   maru://images/triggers/trigger_gift.png
 *   maru://images/game/valheim/entities/Boar.png
 *   maru://images/templates/dragon.png
 *   maru://images/userdata/<file>            ← gifts auto-descargados runtime
 *
 * Cada scope tiene un root path:
 *   donaciones  → resources/data/donaciones/
 *   triggers    → resources/data/icons_triggers/
 *   game/<g>/<c>→ resources/data/game_images/<g>/<c>/
 *   templates   → resources/data/game_images/_templates/
 *   userdata    → app.getPath('userData')/data/donaciones/    (auto-download)
 *
 * Premium polish:
 *   - LRU cache server-side de buffers (max 400, configurable).
 *   - `Cache-Control: public, max-age=86400` para cache cliente.
 *   - Fallback chain: si no encuentra el file, intenta `_default_<cat>.png`
 *     en la misma carpeta; si no, devuelve 404 (el renderer hace fallback
 *     UI con `<MaruImage onError>`).
 *   - Path normalization: rechaza `..`, paths absolutos, etc. para evitar
 *     traversal attacks.
 *   - Logs throttled de fallos (no spam si el sidecar pide muchos files
 *     que no existen).
 */

import { app, net, protocol } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME_CONFIG } from './runtime-config.js';

// ──────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────

const SCHEME = 'maru';

/** LRU cache size (cantidad de buffers en memoria).
 *
 * Bajado de 200 → 64 (2026-04-29 optimización RAM). 64 es más que
 * suficiente para la galería visible típica (sidebar + center + log
 * panel + dialog abierto = ~30-40 imágenes únicas). Hits frescos del
 * disco son ~5-10ms, imperceptibles.
 *
 * Ahorro estimado: ~30-50 MB en renderer cuando hay galería grande
 * cargada (ej. todos los gifts de TikTok). */
const CACHE_MAX = 64;

/** TTL del Cache-Control que mandamos al renderer (1 día). */
const CACHE_MAX_AGE_SECONDS = 86_400;

/** Auto-prune: cuando la app está idle (sin requests al protocol) por
 * IDLE_PRUNE_AFTER_MS, vaciamos el cache al HOT_KEEP. Esto libera RAM
 * en reposo (sin que el user vea diferencia — al volver a interactuar,
 * las imágenes se vuelven a leer del disco en ~10ms). */
const IDLE_PRUNE_AFTER_MS = 30_000;
const HOT_KEEP = 16; // mantenemos solo las 16 más recientes en idle

// ──────────────────────────────────────────────────────────────────────────
// Roots por scope
// ──────────────────────────────────────────────────────────────────────────

interface Roots {
  bundleBase: string;
  donaciones: string;
  triggers: string;
  gameImages: string;
  templates: string;
  userBase: string;
  userDonaciones: string;
  userGameImages: string;
  userTriggers: string;
  userEmotes: string;
}

/** Resuelve los roots de cada scope según dev / packaged. */
function resolveRoots(): Roots {
  // En dev: el bundle vive en `apps/desktop/resources/data/`.
  // En prod: copiado vía `extraResources` a `process.resourcesPath/data/`.
  const baseInDev = resolve(__dirname, '../../resources/data');
  const baseInProd = join(process.resourcesPath ?? '', 'data');
  const base = RUNTIME_CONFIG.isDev && existsSync(baseInDev)
    ? baseInDev
    : baseInProd;

  // Userdata: DEBE ser la misma carpeta que el sidecar Python usa
  // (`runtime_data/data/`). Antes apuntaba a `app.getPath('userData')/data`
  // que es una carpeta DIFERENTE de Electron — por eso los PNGs que el
  // bootstrap copiaba al sidecar daban 404 al cargarse en el renderer.
  const sidecarRuntime = RUNTIME_CONFIG.sidecarRuntimeDataRoot;
  const userBase = sidecarRuntime
    ? join(sidecarRuntime, 'data')
    : join(app.getPath('userData'), 'data');

  return {
    bundleBase: base,
    donaciones: join(base, 'donaciones'),
    triggers: join(base, 'icons_triggers'),
    gameImages: join(base, 'game_images'),
    templates: join(base, 'game_images', '_templates'),
    userBase,
    userDonaciones: join(userBase, 'donaciones'),
    userGameImages: join(userBase, 'game_images'),
    userTriggers: join(userBase, 'icons_triggers'),
    userEmotes: join(userBase, 'emotes'),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// LRU cache (Map preserva insertion order)
// ──────────────────────────────────────────────────────────────────────────

interface CachedImage {
  buffer: Buffer;
  mime: string;
  filePath: string;
}

const cache = new Map<string, CachedImage>();

// Timer de auto-prune que se rearma con cada acceso al cache.
let idlePruneTimer: NodeJS.Timeout | null = null;

function rearmIdlePrune(): void {
  if (idlePruneTimer !== null) clearTimeout(idlePruneTimer);
  idlePruneTimer = setTimeout(() => {
    // Mantener solo HOT_KEEP entries más recientes — Map preserva
    // insertion order, las más viejas están al inicio.
    const keys = Array.from(cache.keys());
    const toRemove = keys.length - HOT_KEEP;
    if (toRemove > 0) {
      for (let i = 0; i < toRemove; i++) cache.delete(keys[i]!);
    }
    idlePruneTimer = null;
  }, IDLE_PRUNE_AFTER_MS);
  // No mantener el event loop vivo solo por este timer.
  if (idlePruneTimer && typeof idlePruneTimer.unref === 'function') {
    idlePruneTimer.unref();
  }
}

function cacheGet(key: string): CachedImage | undefined {
  const v = cache.get(key);
  if (v) {
    // Re-insert para LRU
    cache.delete(key);
    cache.set(key, v);
    rearmIdlePrune();
  }
  return v;
}

function cacheSet(key: string, value: CachedImage): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  rearmIdlePrune();
}

export function clearImageCache(): void {
  cache.clear();
}

export function getImageCacheStats(): { size: number; max: number } {
  return { size: cache.size, max: CACHE_MAX };
}

// ──────────────────────────────────────────────────────────────────────────
// MIME resolution
// ──────────────────────────────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function mimeFromPath(p: string): string {
  return MIME_BY_EXT[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

// ──────────────────────────────────────────────────────────────────────────
// Path resolution por scope
// ──────────────────────────────────────────────────────────────────────────

interface ResolveResult {
  filePath: string;
  /** Ruta de fallback si la primaria no existe. */
  fallback?: string;
}

/**
 * Convierte el pathname de la URL en path de filesystem absoluto.
 * Aplica seguridad básica (no path traversal).
 */
function resolveScopedPath(
  pathname: string,
  roots: ReturnType<typeof resolveRoots>,
): ResolveResult | null {
  // Sanitizar: rechazar path traversal y paths absolutos.
  if (pathname.includes('..') || pathname.includes('\\')) return null;

  // Con scheme `standard: true`, `images` es el HOST y el pathname es
  // `/<scope>/<rest>` (sin el `/images/` adelante — eso lo valida el caller).
  const rest = pathname.replace(/^\/+/, '');
  if (!rest) return null;

  const segments = rest.split('/').filter(Boolean);
  const [scope, ...tail] = segments;
  const safeTail = tail.map((s) => decodeURIComponent(s));

  // Verificar segmentos por seguridad.
  for (const s of safeTail) {
    if (s.includes('..') || s.includes(sep)) return null;
  }

  switch (scope) {
    case 'donaciones': {
      // donaciones/<file>
      if (safeTail.length !== 1) return null;
      const filename = safeTail[0]!;
      // SOLO userdata — el bundle se copió al inicio via bootstrap del
      // sidecar. Toda la galería vive dentro del programa nuevo.
      const userPath = join(roots.userDonaciones, filename);
      if (existsSync(userPath)) return { filePath: userPath };
      // Fallback al bundle solo en caso extremo (bootstrap no corrió).
      const bundlePath = join(roots.donaciones, filename);
      return { filePath: bundlePath };
    }

    case 'triggers': {
      // triggers/<file> — userdata primero (sidecar runtime_data).
      if (safeTail.length !== 1) return null;
      const filename = safeTail[0]!;
      const userPath = join(roots.userTriggers, filename);
      if (existsSync(userPath)) return { filePath: userPath };
      return { filePath: join(roots.triggers, filename) };
    }

    case 'templates': {
      // templates/<file>
      if (safeTail.length !== 1) return null;
      return { filePath: join(roots.templates, safeTail[0]!) };
    }

    case 'game': {
      // game/<gid>/<cat>/<file> — userdata primero.
      if (safeTail.length !== 3) return null;
      const [gid, cat, file] = safeTail;
      const userPath = join(roots.userGameImages, gid!, cat!, file!);
      if (existsSync(userPath)) {
        const userFallback = join(
          roots.userGameImages,
          gid!,
          cat!,
          `_default_${cat}.png`,
        );
        return { filePath: userPath, fallback: userFallback };
      }
      const filePath = join(roots.gameImages, gid!, cat!, file!);
      const fallback = join(
        roots.gameImages,
        gid!,
        cat!,
        `_default_${cat}.png`,
      );
      return { filePath, fallback };
    }

    case 'emotes': {
      // emotes/<streamer>/<file>.png — galería de emotes/stickers por
      // streamer. Lo descarga el sidecar al recibir EmoteChatEvent.
      if (safeTail.length !== 2) return null;
      const [streamer, file] = safeTail;
      return { filePath: join(roots.userEmotes, streamer!, file!) };
    }

    case 'userdata': {
      // userdata/<...>
      if (safeTail.length === 0) return null;
      return { filePath: join(roots.userBase, ...safeTail) };
    }

    default:
      return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Privilegios del scheme — DEBE registrarse antes de app.ready.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Registrar privilegios del scheme `maru://`.
 *
 * Llamar desde `app.whenReady` NO funciona — Electron requiere registrarlo
 * sincronamente al inicio del proceso main, antes del `app.ready`.
 */
export function registerImageProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        bypassCSP: false,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// Handler real del protocolo (registrar después de app.ready)
// ──────────────────────────────────────────────────────────────────────────

let errorThrottle = 0;
const ERROR_LOG_THRESHOLD = 5; // log primeros 5; después callamos

function logResolveError(url: string, reason: string): void {
  errorThrottle += 1;
  if (errorThrottle <= ERROR_LOG_THRESHOLD) {
    console.warn(`[image-protocol] ${reason}: ${url}`);
  } else if (errorThrottle === ERROR_LOG_THRESHOLD + 1) {
    console.warn(
      `[image-protocol] Silenciando errores tras ${ERROR_LOG_THRESHOLD} fallos.`,
    );
  }
}

/**
 * Construye una Response a partir de un buffer + mime.
 */
function imageResponse(
  buffer: Buffer,
  mime: string,
  status: number = 200,
  mutable: boolean = false,
): Response {
  // `mutable=true` para imágenes que pueden cambiar en runtime (gifts
  // auto-descargados, emotes nuevos, avatars de streamer). Para esas
  // usamos `no-cache` que obliga a Chrome a revalidar con el protocol
  // antes de servir desde el disco cache. Sin esto, después de un
  // `gifts:updated` la galería seguía mostrando la imagen vieja
  // (placeholder o 404 cacheado) porque Chrome no volvía a pedir.
  //
  // `mutable=false` (bundle: triggers, game_images, templates) sí
  // puede ser `immutable` con TTL largo — esos paths nunca cambian
  // en una versión dada del .exe.
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Length': String(buffer.byteLength),
    'Cache-Control': mutable
      ? 'no-cache'
      : `public, max-age=${CACHE_MAX_AGE_SECONDS}, immutable`,
    'X-MARU-Source': 'image-protocol',
  };
  const body = new Uint8Array(buffer);
  return new Response(body, { status, headers });
}

async function readImageOrCached(
  filePath: string,
): Promise<CachedImage | null> {
  const cached = cacheGet(filePath);
  if (cached) return cached;
  if (!existsSync(filePath)) return null;
  try {
    const stat = statSync(filePath);
    // No cachear archivos > 5MB para no engullir memoria con assets grandes.
    const buffer = await readFile(filePath);
    const result: CachedImage = {
      buffer,
      mime: mimeFromPath(filePath),
      filePath,
    };
    if (stat.size <= 5 * 1024 * 1024) {
      cacheSet(filePath, result);
    }
    return result;
  } catch (err) {
    console.warn(`[image-protocol] read error for ${filePath}`, err);
    return null;
  }
}

/**
 * Registra el handler `maru://`. Llamar después de `app.whenReady()`.
 */
export function registerImageProtocolHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = request.url;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      logResolveError(url, 'invalid URL');
      return new Response('Invalid URL', { status: 400 });
    }

    if (parsed.host !== 'images') {
      logResolveError(url, `unknown host '${parsed.host}'`);
      return new Response('Unknown host', { status: 404 });
    }

    const roots = resolveRoots();
    const resolved = resolveScopedPath(parsed.pathname, roots);
    if (!resolved) {
      logResolveError(url, 'cannot resolve scope/path');
      return new Response('Bad path', { status: 400 });
    }

    // Detectar si el path es mutable (userdata: donaciones descargadas
    // en runtime, emotes nuevos). Para esos, Cache-Control: no-cache
    // para que Chrome no sirva el 404 viejo cuando llega un gift nuevo.
    const userBaseNorm = roots.userBase.replace(/\\/g, '/');
    const filePathNorm = resolved.filePath.replace(/\\/g, '/');
    const mutable = filePathNorm.startsWith(userBaseNorm);

    // Probar primaria.
    const primary = await readImageOrCached(resolved.filePath);
    if (primary) {
      return imageResponse(primary.buffer, primary.mime, 200, mutable);
    }

    // Fallback (ej: `_default_<cat>.png`).
    if (resolved.fallback) {
      const fb = await readImageOrCached(resolved.fallback);
      if (fb) {
        return imageResponse(fb.buffer, fb.mime, 200, mutable);
      }
    }

    logResolveError(url, `not found at ${resolved.filePath}`);
    return new Response('Not found', { status: 404 });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers para usar desde el resto del main process
// ──────────────────────────────────────────────────────────────────────────

/** URL pública para usar desde el renderer. */
export function imageUrl(scope: string, ...parts: string[]): string {
  const path = parts
    .map((p) => encodeURIComponent(p))
    .filter((p) => p.length > 0)
    .join('/');
  return `${SCHEME}://images/${scope}/${path}`;
}

/** Path absoluto a una imagen del bundle (uso interno). */
export function bundleImagePath(...parts: string[]): string {
  const roots = resolveRoots();
  return join(roots.bundleBase, ...parts);
}

/** Path absoluto a la carpeta userdata (donaciones auto-descargadas). */
export function userDataImagesRoot(): string {
  return resolveRoots().userBase;
}

/** Convierte un file path absoluto a una URL `maru://` cuando es posible. */
export function pathToMaruUrl(absPath: string): string | null {
  const roots = resolveRoots();
  const norm = normalize(absPath);

  function rel(prefix: string, scope: string): string | null {
    if (!norm.startsWith(prefix)) return null;
    const after = norm.slice(prefix.length).replace(/^[\\/]+/, '');
    return imageUrl(scope, ...after.split(/[\\/]+/));
  }

  return (
    rel(roots.userDonaciones, 'donaciones') ??
    rel(roots.donaciones, 'donaciones') ??
    rel(roots.triggers, 'triggers') ??
    rel(roots.templates, 'templates') ??
    rel(roots.gameImages, 'game') ??
    null
  );
}

// Export usado en tests / debug
export const __INTERNAL = {
  resolveRoots,
  resolveScopedPath,
  cacheGet,
  cacheSet,
  pathToFileURL,
  net,
};
