/**
 * Cablea los push events del sidecar a los slices del store.
 *
 * Se llama una sola vez al montar `<App />`. Devuelve una función de cleanup.
 */

import type {
  GameHealthState,
  LogEntry,
  SpotifyNowPlaying,
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
        avatarUrl?: string;
      };
      const next = p.connected
        ? 'connected'
        : p.connecting || p.reconnecting
          ? 'connecting'
          : 'disconnected';
      useAppStore.getState().setTikTokStatus(next, p.username, p.avatarUrl);
    }),
  );
  // tiktok:event NO se suscribe en el renderer: el LogPanel ya recibe los
  // mismos eventos vía `log:entry` desde el sidecar. El feed Zustand era
  // consumidor-fantasma (clonaba un array de 200 refs en cada like/gift sin
  // que ningún componente lo leyera) → causaba gc pressure masivo en lives
  // largos. v1.0.69: eliminado.
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

  // v1.1.3 — promote-to-bottom: cuando un mensaje se dedupea (ej.
  // taps repetidos del mismo user), el sidecar emite `log:entry:updated`
  // con {id, ts, count} para actualizar la entry existente y moverla
  // al final del buffer. Sin esto, las agrupaciones quedaban
  // "enterradas" arriba al llegar entries nuevas.
  offs.push(
    window.maruApi.on('log:entry:updated' as never, (payload: unknown) => {
      const p = payload as { id?: string; ts?: number; count?: number };
      if (
        p &&
        typeof p.id === 'string' &&
        typeof p.ts === 'number' &&
        typeof p.count === 'number'
      ) {
        useAppStore
          .getState()
          .updateLogEntry({ id: p.id, ts: p.ts, count: p.count });
      }
    }),
  );

  // v1.0.72: healthcheck del juego activo. Cada 30s el sidecar pinguea el
  // mod y publica el resultado. UI pinta pill verde/amarillo/rojo.
  offs.push(
    window.maruApi.on('game:health' as never, (payload: unknown) => {
      useAppStore.getState().setGameHealth(payload as GameHealthState);
    }),
  );
  // Snapshot inicial al conectar — evita esperar 30s al primer tick para
  // que el dialog tenga estado.
  void window.maruApi.rpc
    .call('games.health.snapshot', {})
    .then((r) => {
      const games = (r as { games?: Record<string, GameHealthState> }).games;
      if (games && Object.keys(games).length > 0) {
        useAppStore.getState().setGameHealthBulk(games);
      }
    })
    .catch(() => undefined);

  // (nota) `tiktok:log` ya no se publica desde el sidecar — toda la info
  // detallada del worker viaja via `log:entry` para evitar duplicados.

  // gifts:updated → un gift se descargó o reactivó en vivo. Refrescamos
  // el catálogo (RPC) para que la galería muestre la imagen sin polling.
  // NO publicamos pushLogEntry sintético: el sidecar ya emite el log
  // entry "🎁✨ Nueva donación detectada" via LogsService → log:entry.
  // Duplicar acá producía 2 entries idénticos en el panel.
  offs.push(
    window.maruApi.on('gifts:updated' as never, () => {
      void window.maruApi.rpc
        .call('donations.list', {})
        .then((r) => {
          const gifts = (r as { gifts?: never[] }).gifts;
          if (gifts) useAppStore.getState().setGifts(gifts);
        })
        .catch(() => undefined);
    }),
  );

  // tiktok:error → solo actualiza el state (banner de error). El sidecar
  // ya publica un log:entry con level=ERROR para cada error de TikTok,
  // así que NO hacemos pushLogEntry sintético acá (eso duplicaba).

  // social:user-updated (v1.0.90+) — el sidecar publica este event cuando
  // detecta cambio de estado relevante de un user (típico: pérdida de
  // SuperFan). Refrescamos la entry específica en el store sin recargar
  // toda la lista — así el badge dorado se quita sin esperar refresh
  // manual del SocialDialog.
  offs.push(
    window.maruApi.on('social:user-updated' as never, (payload: unknown) => {
      const p = payload as { user?: string };
      const username = typeof p?.user === 'string' ? p.user.trim() : '';
      if (!username) return;
      void window.maruApi.rpc
        .call('social.users.get', { username })
        .then((r) => {
          const u = (r as { user?: unknown }).user;
          if (u) useAppStore.getState().upsertSocialUserLocal(u as never);
        })
        .catch(() => undefined);
    }),
  );

  // profiles:loaded (v1.0.91+) — el sidecar restauró un perfil. Invalidamos
  // los caches de data (entries del catálogo) y rules del juego afectado
  // para que useData/useRules hagan refetch automático en su próximo
  // render. Sin esto el user veía las entries/reglas viejas en pantalla
  // hasta cerrar+abrir las pestañas.
  offs.push(
    window.maruApi.on('profiles:loaded' as never, (payload: unknown) => {
      const p = payload as {
        gameId?: string | null;
        isPerGame?: boolean;
      };
      const state = useAppStore.getState();
      const gid = p?.gameId;
      if (gid) {
        // Per-game: invalidar buckets de ese juego (todos los kinds).
        const prefix = `${gid}::`;
        for (const key of Object.keys(state.dataBuckets)) {
          if (key.startsWith(prefix)) {
            state.setDataBucket(key as never, { status: 'idle' });
          }
        }
        state.setRulesBucket(gid as never, { status: 'idle' });
      } else {
        // Legacy completo: invalidar TODOS los buckets de todos los juegos.
        for (const key of Object.keys(state.dataBuckets)) {
          state.setDataBucket(key as never, { status: 'idle' });
        }
        for (const k of Object.keys(state.rulesBuckets)) {
          state.setRulesBucket(k as never, { status: 'idle' });
        }
      }
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

  // rules:executed → solo refresca el state UI con el resultado de la
  // regla. NO pushLogEntry sintético acá: el RuleDispatcher del sidecar
  // ya emite log.info(...) que llega al panel via log:entry. Antes acá
  // duplicaba cada ejecución de regla en el panel.
  // Si en el futuro queremos info adicional (ranks del user, etc), eso
  // se agrega al log del sidecar para mantener una sola fuente de verdad.

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
