/**
 * Push events emitidos por el sidecar (Python) hacia el cliente Electron.
 * Son JSON-RPC notifications (sin id) — el renderer las recibe vía
 * `window.maruApi.on(<event>, cb)`.
 */

import type {
  LogEntry,
  SpotifyNowPlaying,
  TikTokEvent,
  TikTokStats,
} from '../types/index.js';
import type { GameHealthState } from './methods.js';

export interface RpcPushEventMap {
  'sidecar:ready': { rpcPort: number; pid: number };
  'sidecar:log': { level: 'debug' | 'info' | 'warning' | 'error'; logger: string; message: string; ts: number };

  'tiktok:status': { connected: boolean; username?: string };
  'tiktok:event': TikTokEvent;
  'tiktok:stats': TikTokStats;
  'tiktok:error': { message: string };

  'rules:fired': { ruleId: string; gameId: string; results: { ok: boolean; message: string }[] };
  /** Gift nuevo descargado o reactivado en la galería. */
  'gifts:updated': {
    action: 'downloaded' | 'reactivated';
    giftId: string;
    giftName: string;
    coins: number;
    gift: Record<string, unknown> | null;
  };

  /** RuleDispatcher publica esto por cada regla ejecutada (real o test). */
  'rules:executed': {
    gameId: string;
    ruleName: string;
    action: string;
    message: string;
    success: boolean;
    trigger: string;
    user: string;
  };

  /** Detalle granular del worker TikTok (reintentos, errores API). */
  'tiktok:log': { message: string };

  /** Comment con metadatos del usuario (super fan, moderator, level, etc.) */
  'tiktok:comment-enriched': {
    user: string;
    is_super_fan?: boolean;
    is_moderator?: boolean;
    is_top_gifter?: boolean;
    member_level?: number | null;
    gifter_level?: number | null;
    is_friend?: boolean;
  };

  /** Emote nuevo descargado o asignado a sonido. */
  'emotes:updated': {
    streamer: string;
    emoteId: string;
    path: string;
    action: 'downloaded' | 'sound_assigned';
  };

  'spotify:status': { connected: boolean; account?: { id?: string; name?: string } | null };
  'spotify:now-playing': SpotifyNowPlaying;
  /** Cambio en el estado de PlayFan: usos restantes por user, super_fans
   *  resync, etc. */
  'spotify:playfan-state': {
    perUser?: Record<string, number>;
    defaultUses?: number;
    items?: Array<{ user: string; playfan_uses?: number }>;
  };
  'spotify:queue': { items: unknown[]; total: number };

  'social:update': { kind: string; user?: string; payload: Record<string, unknown> };

  /** v1.0.90+ — refresh de UN user específico en el SocialDialog. Lo
   *  emite el sidecar al detectar transiciones relevantes (ej. pérdida
   *  del rol SuperFan → ring dorado debe quitarse en vivo). El renderer
   *  hace `social.users.get` solo de ese user (no recarga lista entera). */
  'social:user-updated': { user: string };

  /** v1.0.91+ — emitido por el sidecar después de restaurar un perfil de
   *  stream. El renderer debe invalidar caches de `useData` y `useRules`
   *  del juego restaurado (las entries del catálogo + reglas pueden
   *  haber cambiado) sin esperar a que el user cierre+abra las pestañas. */
  'profiles:loaded': {
    profileId: string;
    gameId: string | null;
    isPerGame: boolean;
  };

  /** G11 — log estructurado en tiempo real desde el LogsService. */
  'log:entry': LogEntry;

  /** v1.0.72 — healthcheck periódico del juego activo. Cada 30s el sidecar
   *  pinguea el mod del juego y publica el resultado. UI consume para
   *  pintar pill verde/amarillo/rojo en cada perfil de juego. */
  'game:health': GameHealthState;
}

export type RpcPushEventName = keyof RpcPushEventMap;
