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

  'social:update': { kind: string; user?: string; payload: Record<string, unknown> };

  /** G11 — log estructurado en tiempo real desde el LogsService. */
  'log:entry': LogEntry;
}

export type RpcPushEventName = keyof RpcPushEventMap;
