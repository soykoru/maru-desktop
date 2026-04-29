import type { SystemHealthIndicator } from '@maru/shared';
import { useAppStore } from '../../lib/store/index.js';
import { StatusDot } from '@maru/ui';

/**
 * `SystemHealthWidget` — 4 indicadores: Sidecar / TikTok / Game / TTS.
 *
 * Lee del store los status conocidos. El indicador de "Game" usa el
 * `selectedGameId` y consulta cualquier perfil cargado (asume disponible
 * si está en games-slice). Para TTS asume disponible si `voicesStatus
 * === 'ready'`.
 */
export function SystemHealthWidget() {
  const sidecar = useAppStore((s) => s.sidecarStatus);
  const tiktokStatus = useAppStore((s) => s.tiktokStatus);
  const tiktokUser = useAppStore((s) => s.tiktokUsername);
  const selectedGameId = useAppStore((s) => s.selectedGameId);
  const games = useAppStore((s) => s.games);
  const ttsStatus = useAppStore((s) => s.ttsVoicesStatus);

  const indicators: SystemHealthIndicator[] = [
    {
      id: 'sidecar',
      label: 'Sidecar',
      status:
        sidecar === 'connected'
          ? 'connected'
          : sidecar === 'error'
            ? 'error'
            : 'disconnected',
      detail: sidecar,
    },
    {
      id: 'tiktok',
      label: 'TikTok',
      status:
        tiktokStatus === 'connected'
          ? 'connected'
          : tiktokStatus === 'error'
            ? 'error'
            : 'disconnected',
      detail: tiktokUser ?? 'Sin conexión',
    },
    {
      id: 'game',
      label: 'Juego',
      status: selectedGameId
        ? games.some((g) => g.id === selectedGameId)
          ? 'idle'
          : 'disconnected'
        : 'disconnected',
      detail:
        games.find((g) => g.id === selectedGameId)?.name ?? 'Sin perfil',
    },
    {
      id: 'tts',
      label: 'TTS',
      status:
        ttsStatus === 'ready'
          ? 'idle'
          : ttsStatus === 'error'
            ? 'error'
            : 'disconnected',
      detail: ttsStatus,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-1.5 px-3 py-1.5 text-[10px]">
      {indicators.map((ind) => {
        const dotStatus =
          ind.status === 'connected'
            ? 'connected'
            : ind.status === 'error'
              ? 'error'
              : ind.status === 'idle'
                ? 'connecting'
                : 'disconnected';
        return (
          <div
            key={ind.id}
            className="flex items-center gap-1 truncate"
            title={`${ind.label}: ${ind.detail ?? ''}`}
          >
            <StatusDot status={dotStatus as never} label="" />
            <span className="text-fg-muted truncate">{ind.label}</span>
          </div>
        );
      })}
    </div>
  );
}
