import { useState } from 'react';
import {
  Music,
  Play,
  Plus,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { Button, Dialog, Empty, Input, MaruImage, Select, Spinner } from '@maru/ui';
import type { DonationGift, SoundEvent, SoundLibraryItem } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useGames } from '../../../lib/use-games.js';
import { useGifts } from '../../../lib/use-gifts.js';
import { useSounds } from '../../../lib/use-sounds.js';

/**
 * `SoundsDialog` (G10) — réplica de `sounds_dialog.py` en 3 tabs:
 * Biblioteca · Regalos · Eventos.
 *
 * Mejoras vs MARU original:
 *   - Scope selector (global vs por gameId) para mantener sets distintos.
 *   - File picker via `<input type="file" multiple>` (no QFileDialog).
 *   - Indicador `❌ No existe` cuando el path está roto.
 *   - Volume slider con label live.
 *   - Playback Web Audio (no pygame) — funciona en Electron sin extra deps.
 */
type Tab = 'library' | 'gifts' | 'events';

const EVENTS_META: { id: SoundEvent; emoji: string; label: string }[] = [
  { id: 'follow', emoji: '➕', label: 'Nuevo Seguidor' },
  { id: 'share', emoji: '📤', label: 'Compartir' },
  { id: 'superfan', emoji: '⭐', label: 'Super Fan' },
];

function fmtSize(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function SoundsDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'sounds'));
  const closeModal = useAppStore((s) => s.closeModal);
  const selectedGameId = useAppStore((s) => s.selectedGameId);

  const { games } = useGames({ autoLoad: open });
  const { allGifts } = useGifts({ autoLoad: open });

  const [scope, setScope] = useState<string>(selectedGameId ?? 'global');
  const sounds = useSounds(scope, { autoLoad: open });

  const [tab, setTab] = useState<Tab>('library');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  if (!open) return null;

  function handlePlay(path: string) {
    if (!path) return;
    sounds.playLocal(path);
  }

  async function handleAddFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.flac';
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return;
      // Electron 32+: `File.path` removido. Usar `webUtils.getPathForFile`
      // expuesto desde el preload (`window.maruApi.getPathForFile`).
      const paths = files
        .map((f) => window.maruApi.getPathForFile(f))
        .filter(Boolean);
      if (!paths.length) {
        setOpError('No se pudo obtener el path absoluto del archivo.');
        return;
      }
      setBusy(true);
      try {
        await sounds.addToLibrary(paths);
      } catch (ex) {
        setOpError(ex instanceof Error ? ex.message : String(ex));
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }

  async function handleRemoveLib(path: string) {
    if (!confirm('¿Quitar este sonido de la biblioteca? También se desasigna de cualquier gift/evento.')) {
      return;
    }
    setBusy(true);
    try {
      await sounds.removeFromLibrary(path);
    } catch (ex) {
      setOpError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  const visibleLib = sounds.library.filter((s) =>
    s.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const tabs: { id: Tab; label: string; emoji: string }[] = [
    { id: 'library', label: `Biblioteca (${sounds.library.length})`, emoji: '📁' },
    { id: 'gifts', label: `Regalos (${Object.keys(sounds.gifts).length})`, emoji: '🎁' },
    { id: 'events', label: 'Eventos (3)', emoji: '⚡' },
  ];

  return (
    <Dialog
      open
      onClose={() => !busy && closeModal()}
      size="xl"
      bodyFlush
      title="🔔 Gestor de Sonidos"
      description="Biblioteca compartida + asignaciones por gift y evento."
    >
      {/* Header tools: scope + volume */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3 bg-bg-elev/30">
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">Scope:</span>
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="w-[180px]"
            disabled={busy}
          >
            <option value="global">🌐 Global</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.icon} {g.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex-1 flex items-center gap-2">
          <Volume2 className="h-3.5 w-3.5 text-fg-muted" />
          <input
            type="range"
            min={0}
            max={100}
            value={sounds.volume}
            onChange={(e) =>
              void sounds.setVolume(parseInt(e.target.value, 10) || 0)
            }
            className="flex-1 accent-accent max-w-[220px]"
            disabled={busy}
          />
          <span className="w-10 text-right text-xs font-mono text-fg-subtle">
            {sounds.volume}%
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div role="tablist" className="flex border-b border-border bg-bg-elev/30">
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={[
                'px-4 py-2 text-xs font-medium uppercase tracking-wider whitespace-nowrap',
                'transition-colors border-b-2',
                active
                  ? 'text-accent border-accent'
                  : 'text-fg-muted border-transparent hover:text-fg',
              ].join(' ')}
            >
              <span className="font-emoji mr-1">{t.emoji}</span>
              {t.label}
            </button>
          );
        })}
      </div>

      {opError && (
        <div className="px-5 py-2 text-xs border-b border-border bg-danger/10 text-danger">
          {opError}
        </div>
      )}

      {/* Cuerpo */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {sounds.status === 'loading' ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : tab === 'library' ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Buscar sonido..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={busy}
                className="flex-1"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleAddFiles()}
                disabled={busy}
              >
                <Plus className="h-3.5 w-3.5" />
                Añadir sonidos
              </Button>
            </div>
            {visibleLib.length === 0 ? (
              <Empty
                icon={Music}
                title={search ? 'Sin coincidencias' : 'Biblioteca vacía'}
                description={
                  search
                    ? `No hay sonidos que matcheen "${search}".`
                    : 'Añadí archivos audio (mp3/wav/ogg/m4a/flac) para asignarlos.'
                }
              />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-bg-elev/30">
                {visibleLib.map((s) => (
                  <li
                    key={s.path}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                  >
                    <span className={s.exists ? 'text-success' : 'text-danger'}>
                      {s.exists ? '✅' : '❌'}
                    </span>
                    <span className="flex-1 truncate font-mono" title={s.path}>
                      {s.name}
                    </span>
                    <span className="text-fg-subtle">{fmtSize(s.sizeBytes)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePlay(s.path)}
                      disabled={!s.exists}
                      title="Probar"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRemoveLib(s.path)}
                      disabled={busy}
                      title="Quitar de biblioteca"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : tab === 'gifts' ? (
          <GiftSoundsList
            gifts={allGifts}
            assignments={sounds.gifts}
            library={sounds.library}
            onAssign={(gid, path) => void sounds.assignGift(gid, path)}
            onPlay={handlePlay}
            disabled={busy}
          />
        ) : (
          <EventSoundsList
            events={sounds.events}
            library={sounds.library}
            onAssign={(ev, path) => void sounds.assignEvent(ev, path)}
            onPlay={handlePlay}
            disabled={busy}
          />
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <p className="text-[11px] text-fg-subtle flex-1">
          Sonidos por scope <code>{scope}</code> persistidos en
          <code className="ml-1 font-mono">data/sounds_{scope}.json</code>.
        </p>
        <Button variant="ghost" size="sm" onClick={() => sounds.stopLocal()}>
          ⏹ Stop
        </Button>
        <Button variant="primary" size="sm" onClick={closeModal}>
          Cerrar
        </Button>
      </footer>
    </Dialog>
  );
}

// ── Sub-componentes inline ──────────────────────────────────────────────

function GiftSoundsList({
  gifts,
  assignments,
  library,
  onAssign,
  onPlay,
  disabled,
}: {
  gifts: DonationGift[];
  assignments: Record<string, string>;
  library: SoundLibraryItem[];
  onAssign: (giftId: string, path: string) => void;
  onPlay: (path: string) => void;
  disabled: boolean;
}) {
  if (gifts.length === 0) {
    return (
      <Empty
        icon={Music}
        title="Sin gifts configurados"
        description="Configurá gifts en el GiftsDialog primero."
      />
    );
  }
  // Mismo enriquecimiento de iconPath que GiftCard usa para resolver
  // la ruta relativa al scope `donaciones/`. Sin esto la imagen real
  // del PNG nunca se cargaba acá y solo veíamos el emoji fallback.
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-bg-elev/30">
      {gifts.map((g) => {
        const path = assignments[g.id] || '';
        const iconRel = g.iconPath?.startsWith('donaciones/')
          ? g.iconPath.slice('donaciones/'.length)
          : g.iconPath;
        return (
          <li key={g.id} className="flex items-center gap-2 px-3 py-2">
            <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-md bg-bg-elev/60 overflow-hidden">
              {iconRel ? (
                <MaruImage
                  scope="donaciones"
                  path={iconRel}
                  alt={g.name}
                  width={32}
                  height={32}
                  fallback={g.icon || '🎁'}
                  className="object-contain max-w-[32px] max-h-[32px]"
                />
              ) : (
                <span className="font-emoji text-lg">{g.icon || '🎁'}</span>
              )}
            </div>
            <span className="text-sm flex-1 truncate" title={g.name}>
              {g.name}
            </span>
            {(g.coins ?? 0) > 0 && (
              <span className="text-[10px] text-fg-subtle font-mono shrink-0">
                💎{g.coins}
              </span>
            )}
            <Select
              value={path}
              onChange={(e) => onAssign(g.id, e.target.value)}
              className="w-[200px]"
              disabled={disabled}
            >
              <option value="">— Sin sonido —</option>
              {library.map((s) => (
                <option key={s.path} value={s.path}>
                  🔊 {s.name}
                </option>
              ))}
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPlay(path)}
              disabled={!path}
              title="Probar"
            >
              <Play className="h-3 w-3" />
            </Button>
            {path && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAssign(g.id, '')}
                disabled={disabled}
                title="Quitar"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EventSoundsList({
  events,
  library,
  onAssign,
  onPlay,
  disabled,
}: {
  events: Record<SoundEvent, string>;
  library: SoundLibraryItem[];
  onAssign: (event: SoundEvent, path: string) => void;
  onPlay: (path: string) => void;
  disabled: boolean;
}) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-bg-elev/30">
      {EVENTS_META.map((ev) => {
        const path = events[ev.id] || '';
        return (
          <li key={ev.id} className="flex items-center gap-3 px-3 py-2">
            <span className="font-emoji text-lg shrink-0 w-8">{ev.emoji}</span>
            <span className="text-sm font-medium w-36 shrink-0">{ev.label}</span>
            <Select
              value={path}
              onChange={(e) => onAssign(ev.id, e.target.value)}
              className="flex-1"
              disabled={disabled}
            >
              <option value="">— Sin sonido —</option>
              {library.map((s) => (
                <option key={s.path} value={s.path}>
                  🔊 {s.name}
                </option>
              ))}
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPlay(path)}
              disabled={!path}
              title="Probar"
            >
              <Play className="h-3 w-3" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
