/**
 * Telemetría opcional, opt-in.
 *
 * Diseño:
 *  - Por default deshabilitada. El usuario debe activarla en Settings →
 *    Privacidad. La preferencia se persiste en localStorage del renderer
 *    y el main la lee al arrancar leyendo un userData file.
 *  - Sentry se carga dinámicamente: si la dep no está instalada (o el
 *    user no la activó), `captureException` es un no-op.
 *  - Solo capturamos errores agregados; nunca payloads de TikTok/Spotify.
 */

import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FLAG_FILE = 'telemetry.flag';

interface SentryLike {
  init: (opts: Record<string, unknown>) => void;
  captureException: (e: unknown) => void;
  addBreadcrumb: (b: Record<string, unknown>) => void;
}

let sentry: SentryLike | null = null;

function readEnabled(): boolean {
  try {
    const p = join(app.getPath('userData'), FLAG_FILE);
    return readFileSync(p, 'utf8').trim() === '1';
  } catch {
    return false;
  }
}

export function initTelemetry(appVersion: string): void {
  if (!readEnabled()) {
    return;
  }
  // Lazy import — `@sentry/electron` es opcional, no está en deps por default.
  // Si lo agregás, este código lo activa automáticamente.
  void (async () => {
    try {
      const dsn = process.env['MARU_SENTRY_DSN'];
      if (!dsn) {
        console.log('[telemetry] habilitado pero sin MARU_SENTRY_DSN — no-op');
        return;
      }
      // @ts-expect-error — dep opcional, importada solo si está instalada.
      const mod = (await import('@sentry/electron/main')) as { default: SentryLike } | SentryLike;
      sentry = (('default' in mod ? (mod as { default: SentryLike }).default : mod) as SentryLike);
      sentry.init({
        dsn,
        release: `maru-desktop@${appVersion}`,
        tracesSampleRate: 0,
        environment: app.isPackaged ? 'production' : 'development',
        beforeSend: (event: Record<string, unknown>) => {
          // Sanitización: nunca enviar URL ni contexto del live.
          if (event['user']) delete event['user'];
          if (event['contexts']) {
            const c = event['contexts'] as Record<string, unknown>;
            delete c['tiktok'];
            delete c['spotify'];
          }
          return event;
        },
      });
      console.log('[telemetry] Sentry inicializado');
    } catch (err) {
      console.log('[telemetry] @sentry/electron no instalado — telemetría desactivada');
    }
  })();
}

export function captureException(err: unknown): void {
  if (sentry) {
    try {
      sentry.captureException(err);
    } catch {
      // ignore
    }
  }
}

export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (sentry) {
    try {
      sentry.addBreadcrumb({ message, data, timestamp: Date.now() / 1000 });
    } catch {
      // ignore
    }
  }
}
