import { useMemo, type ReactNode } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useAppStore } from '../lib/store/index.js';
import { rpcCall } from '../lib/rpc.js';

/**
 * `NowPlayingCard` — card visual del Spotify reproduciendo (FASE V4 v1.0.40).
 *
 * Diseño:
 *   - Fondo derivado: gradient pseudo-album-art (3 colores) BLUR fuerte
 *     + scrim oscuro inferior. La librería de Spotipy NO devuelve
 *     dominantColor del album, así que generamos un gradient estable a
 *     partir del hash del nombre del track. Cero requests extra, cero
 *     RAM extra.
 *   - Controles glass: skip back · play/pause · skip forward.
 *
 * Comportamiento:
 *   - Solo se muestra cuando `spotifyStatus.connected === true`. Si
 *     Spotify no está conectado, retorna null — el botón "Spotify" del
 *     área de Configuración del Sidebar SIGUE disponible para conectar.
 *   - Si conectado pero no hay track sonando (`isPlaying=false`), muestra
 *     un estado vacío "Sin reproducción" pero conserva el card visible.
 *
 * Reglas duras:
 *   - Cero RPC nuevos. Reusa los selectores `spotifyStatus` / `spotifyNow`
 *     que ya pueblan el `spotify-slice` (los actualiza el push event
 *     `spotify:now-playing` que ya existe en el sidecar).
 *   - Cero hooks adicionales (`useSpotify` no se llama acá: ya hay un
 *     scheduler global que mantiene `spotifyNow` fresco).
 *   - Tamaño chico (~130px) — no roba espacio a las cards principales.
 */
export function NowPlayingCard(): ReactNode {
  const status = useAppStore((s) => s.spotifyStatus);
  const now = useAppStore((s) => s.spotifyNow);

  // Gradient estable derivado del nombre del track. Al cambiar el track,
  // cambia el background — sin necesidad de fetch del cover real.
  const bgGradient = useMemo(() => deriveGradient(now.track?.name ?? ''), [now.track?.name]);

  if (!status.connected) {
    return null;
  }

  const playing = now.isPlaying && now.track;
  const positionPct =
    playing && now.track && now.track.durationMs > 0
      ? Math.min(100, Math.max(0, (now.track.positionMs / now.track.durationMs) * 100))
      : 0;

  const handleSkip = () => void rpcCall('spotify.skip', {}).catch(() => undefined);
  const handleToggle = () =>
    void rpcCall('spotify.toggle-playback', {}).catch(() => undefined);

  return (
    <div
      className="maru-np-card"
      role="region"
      aria-label="Spotify · ahora suena"
    >
      <div
        className="maru-np-art"
        aria-hidden="true"
        style={{ background: bgGradient }}
      />
      <div className="maru-np-scrim" aria-hidden="true" />

      <div className="maru-np-source">
        <SpotifyMark />
        <span>SPOTIFY · NOW PLAYING</span>
      </div>

      <div className="maru-np-controls">
        <button
          type="button"
          className="maru-np-btn"
          title="Saltar al final / siguiente en cola"
          onClick={handleSkip}
        >
          <SkipBack className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="maru-np-btn primary"
          title={playing ? 'Pausar' : 'Reanudar'}
          onClick={handleToggle}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Play className="h-3.5 w-3.5 translate-x-px" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="maru-np-btn"
          title="Siguiente"
          onClick={handleSkip}
        >
          <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="maru-np-content">
        {playing && now.track ? (
          <>
            <div className="maru-np-title" title={now.track.name}>
              {now.track.name}
            </div>
            <div className="maru-np-artist" title={now.track.artist}>
              {now.track.artist}
              {now.requestedBy ? ` · pedida por @${now.requestedBy}` : ''}
            </div>
            <div className="maru-np-progress" aria-hidden="true">
              <div
                className="maru-np-progress-fill"
                style={{ width: `${positionPct}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="maru-np-title">Sin reproducción</div>
            <div className="maru-np-artist">
              Cuando alguien pida una canción la vas a ver acá.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers locales ───────────────────────────────────────────────────

function deriveGradient(seed: string): string {
  // Hash simple FNV-1a para derivar 3 hues estables del nombre del track.
  // Salida: gradient lineal con 3 paradas → mismo track = mismo gradient.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  const hue1 = h % 360;
  const hue2 = (hue1 + 60) % 360;
  const hue3 = (hue1 + 200) % 360;
  return (
    `linear-gradient(135deg, hsl(${hue1}, 65%, 35%), ` +
    `hsl(${hue2}, 60%, 25%) 50%, hsl(${hue3}, 55%, 30%))`
  );
}

function SpotifyMark(): ReactNode {
  // Spotify-green dot con glow. NO logo oficial (evitamos issues de
  // marca registrada en la UI), solo señal cromática reconocible.
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: '#1DB954',
        boxShadow: '0 0 6px #1DB95488',
      }}
    />
  );
}
