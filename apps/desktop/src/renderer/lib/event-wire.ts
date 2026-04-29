/**
 * Cablea los push events del sidecar a los slices del store.
 *
 * Se llama una sola vez al montar `<App />`. Devuelve una función de cleanup.
 */

import type {
  LogEntry,
  SpotifyNowPlaying,
  TikTokEvent,
  TikTokStats,
} from '@maru/shared';
import { useAppStore } from './store/index.js';
import type { UpdaterState } from './store/updater-slice.js';

export function wireSidecarEvents(): () => void {
  const offs: Array<() => void> = [];

  offs.push(
    window.maruApi.on('sidecar:ready', () => {
      useAppStore.getState().setSidecarStatus('connected');
    }),
  );
  offs.push(
    window.maruApi.on('rpc:connected', () => {
      useAppStore.getState().setRpcStatus('connected');
      // Re-fetch de TODA la data principal cuando el sidecar se conecta.
      // Cubre el caso de bootstrap lento (copia de assets al primer boot)
      // donde el frontend hizo las primeras RPC antes de que el server
      // estuviera listo y los slices quedaron vacíos.
      void Promise.allSettled([
        window.maruApi.rpc.call('games.list', {}).then((r) => {
          const g = (r as { games?: never[] }).games;
          if (g) useAppStore.getState().setGames(g as never);
        }),
        window.maruApi.rpc.call('donations.list', {}).then((r) => {
          const x = (r as { gifts?: never[] }).gifts;
          if (x) useAppStore.getState().setGifts(x as never);
        }),
      ]).catch(() => undefined);
    }),
  );
  offs.push(
    window.maruApi.on('rpc:disconnected', () => {
      useAppStore.getState().setRpcStatus('disconnected');
    }),
  );

  // TikTok push events — el sidecar publica `connecting:true` durante el
  // handshake inicial; respetarlo evita el "parpadeo" del botón.
  offs.push(
    window.maruApi.on('tiktok:status' as never, (payload: unknown) => {
      const p = payload as {
        connected: boolean;
        username?: string;
        connecting?: boolean;
        reconnecting?: boolean;
      };
      const next = p.connected
        ? 'connected'
        : p.connecting || p.reconnecting
          ? 'connecting'
          : 'disconnected';
      useAppStore.getState().setTikTokStatus(next, p.username);
    }),
  );
  offs.push(
    window.maruApi.on('tiktok:event' as never, (payload: unknown) => {
      const evt = payload as TikTokEvent;
      // Solo el feed visual — el LogPanel ya recibe los mismos eventos
      // vía `log:entry` desde el sidecar (`worker.log_message` → LogsService).
      // Sintetizar acá causaba entries duplicados en el log.
      useAppStore.getState().pushTikTokEvent(evt);
    }),
  );
  offs.push(
    window.maruApi.on('tiktok:stats' as never, (payload: unknown) => {
      useAppStore.getState().setTikTokStats(payload as TikTokStats);
    }),
  );
  offs.push(
    window.maruApi.on('tiktok:error' as never, (payload: unknown) => {
      const p = payload as { message: string };
      useAppStore.getState().setTikTokError(p.message);
    }),
  );

  // G11: log push events del sidecar.
  offs.push(
    window.maruApi.on('log:entry' as never, (payload: unknown) => {
      useAppStore.getState().pushLogEntry(payload as LogEntry);
    }),
  );

  // (nota) `tiktok:log` ya no se publica desde el sidecar — toda la info
  // detallada del worker viaja via `log:entry` para evitar duplicados.

  // gifts:updated → un gift se descargó o reactivó en vivo. Refrescamos
  // el catálogo (RPC) para que la galería muestre la imagen sin polling.
  offs.push(
    window.maruApi.on('gifts:updated' as never, (payload: unknown) => {
      const p = payload as { giftId?: string; giftName?: string; action?: string };
      // Re-fetch del catálogo completo es más seguro que mergear (el
      // backend puede haber re-normalizado nombres). Es una sola RPC.
      void window.maruApi.rpc
        .call('donations.list', {})
        .then((r) => {
          const gifts = (r as { gifts?: never[] }).gifts;
          if (gifts) useAppStore.getState().setGifts(gifts);
        })
        .catch(() => undefined);
      // Log entry visible para que el usuario vea que llegó nueva donación.
      useAppStore.getState().pushLogEntry({
        id: `gu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        level: 'INFO',
        source: 'donations',
        category: 'gift',
        message:
          p.action === 'reactivated'
            ? `🎁✅ Donación reactivada: ${p.giftName}`
            : `🎁✨ Nueva donación detectada: ${p.giftName}`,
      });
    }),
  );

  // tiktok:error → siempre al log con nivel ERROR (complementa el set state).
  offs.push(
    window.maruApi.on('tiktok:error' as never, (payload: unknown) => {
      const p = payload as { message?: string };
      if (!p?.message) return;
      useAppStore.getState().pushLogEntry({
        id: `tke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        level: 'ERROR',
        source: 'tiktok',
        category: 'error',
        message: `❌ TikTok: ${String(p.message)}`,
      });
    }),
  );

  // G14: Spotify push events (now-playing + queue + status).
  offs.push(
    window.maruApi.on('spotify:now-playing' as never, (payload: unknown) => {
      useAppStore.getState().setSpotifyNow(payload as SpotifyNowPlaying);
    }),
  );
  offs.push(
    window.maruApi.on('spotify:queue' as never, (payload: unknown) => {
      const p = payload as { items?: unknown[] };
      const items = Array.isArray(p?.items) ? p.items : [];
      useAppStore.getState().setSpotifyQueue(items as never);
    }),
  );
  offs.push(
    window.maruApi.on('spotify:status' as never, (payload: unknown) => {
      const p = payload as { connected: boolean; account?: unknown };
      useAppStore.getState().setSpotifyStatus({
        connected: p.connected,
        available: true,
        account: (p.account as { id?: string; name?: string } | null) ?? null,
        rateLimited: false,
      });
    }),
  );

  // G14: rules:executed → log feed. El RuleDispatcher publica esto cada
  // vez que ejecuta una regla (real o desde Probar) — así el usuario ve
  // si el HTTP/RCON al juego salió OK.
  offs.push(
    window.maruApi.on('rules:executed' as never, (payload: unknown) => {
      const p = payload as {
        gameId: string;
        ruleName: string;
        action: string;
        message: string;
        success: boolean;
        trigger: string;
        user: string;
        userRanks?: string;
      };
      const store = useAppStore.getState();
      const userTag = p.user ? `@${p.user}` : '';
      const ranksTag = p.userRanks ? ` (${p.userRanks})` : '';
      const userInfo = userTag ? ` · ${userTag}${ranksTag}` : '';
      store.pushLogEntry({
        id: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        level: p.success ? 'INFO' : 'ERROR',
        source: 'rules',
        category: 'rule',
        message: `${p.success ? '✅' : '❌'} ${p.ruleName} (${p.action}) → ${p.message}${userInfo}`,
        meta: p as Record<string, unknown>,
      });
    }),
  );

  // Sincroniza activeGame en el sidecar cuando el usuario cambia de juego
  // en el sidebar. El RuleDispatcher lo lee para saber a qué juego
  // mandar las acciones cuando llega un tiktok:event.
  let lastSyncedGameId: string | null = null;
  const syncActiveGame = (gid: string | null) => {
    if (gid === lastSyncedGameId) return;
    lastSyncedGameId = gid;
    if (!gid) return;
    // Escribir AMBAS keys: `activeGame` (esquema nuevo) + `current_game`
    // (esquema MARU original). El RuleDispatcher lee la primera no vacía.
    void window.maruApi.rpc
      .call('settings.set', {
        patch: { activeGame: gid, current_game: gid },
      })
      .catch(() => undefined);
  };
  syncActiveGame(useAppStore.getState().selectedGameId);
  const unsubGame = useAppStore.subscribe((s, prev) => {
    if (s.selectedGameId !== prev.selectedGameId) {
      syncActiveGame(s.selectedGameId);
    }
  });
  offs.push(unsubGame);

  // Updater push events
  offs.push(
    window.maruApi.on('updater:state' as never, (payload: unknown) => {
      useAppStore.getState().setUpdaterState(payload as UpdaterState);
    }),
  );
  // Pedimos el estado actual una vez al montar
  void window.maruApi.updater.getState().then((s) => {
    useAppStore.getState().setUpdaterState(s as UpdaterState);
  });

  // Auto-reconnect Spotify al boot — paridad MARU original que recuerda
  // la última cuenta activa (`isCurrent: true` en accounts.json) y
  // restablece la sesión sin pedir login.
  void window.maruApi.rpc
    .call('spotify.accounts.list', {})
    .then((r) => {
      const accounts = (r as { accounts?: Array<{ name: string; isCurrent: boolean }> })
        .accounts;
      const current = accounts?.find((a) => a.isCurrent);
      if (current) {
        return window.maruApi.rpc.call('spotify.accounts.load', {
          name: current.name,
        });
      }
    })
    .catch(() => undefined);

  return () => offs.forEach((off) => off());
}
