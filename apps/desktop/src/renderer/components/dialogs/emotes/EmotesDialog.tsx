import { useEffect, useRef, useState } from 'react';
import { Trash2, Music, RefreshCw, Play, Volume2, Square } from 'lucide-react';
import { Button, Dialog, Empty, Input, Label, MaruImage, Select, Spinner } from '@maru/ui';
import type { EmoteInfo, EmoteStreamer } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { rpcCall } from '../../../lib/rpc.js';

/**
 * `EmotesDialog` — galería de emotes/stickers por streamer (multi-account).
 *
 * Esta pestaña es feature NUEVA del MARU Desktop (no existe en el original).
 * Aprovecha `EmoteChatEvent` de TikTokLive 6.6.5 que el original no cabló.
 *
 * Flujo:
 *   1. Cuando un viewer manda un emote en chat, el sidecar descarga el
 *      PNG en `runtime_data/data/emotes/<streamer>/<emote_id>.png`.
 *   2. Acá ves todos los emotes acumulados, podés asignar un sonido
 *      (mp3/wav) a cada uno.
 *   3. Cuando el mismo emote vuelve a llegar en chat, el sonido suena.
 */
/**
 * Componente de galería de emotes — arquitectura limpia.
 *
 * Reglas de oro:
 *   1. UNA sola fuente de verdad por slice de state.
 *   2. UN solo loader (`reload`) que se llama desde:
 *        - mount inicial (efecto [open])
 *        - push event `emotes:updated` (debounceado)
 *        - cambio de streamer activo
 *        - botones de mutación (assign-sound, delete, refresh-avatar)
 *   3. NUNCA vaciar state vía effects implícitos. Solo cuando el user
 *      explícitamente borra o cambia de streamer.
 *   4. Datos del backend son la verdad. Si vienen vacíos, conservamos
 *      lo último válido (defensa contra race con manifest siendo escrito).
 */
export function EmotesDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'emotes'));
  const closeModal = useAppStore((s) => s.closeModal);

  const [streamers, setStreamers] = useState<EmoteStreamer[]>([]);
  const [activeStreamer, setActiveStreamer] = useState<string>('');
  const [emotes, setEmotes] = useState<EmoteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState('');

  // Refs estables — leen state actual sin closures stale, no son deps.
  const activeStreamerRef = useRef(activeStreamer);
  activeStreamerRef.current = activeStreamer;

  /** Reload — función local, NO memo, no es dep de nadie. */
  async function reload(preferStreamer?: string) {
    setError(null);
    try {
      const r = (await rpcCall('emotes.list-streamers', {})) as {
        streamers: EmoteStreamer[];
      };
      const next = r.streamers || [];
      setStreamers((prev) =>
        next.length === 0 && prev.length > 0 ? prev : next,
      );

      const current = activeStreamerRef.current;
      const cur = preferStreamer || current || next[0]?.username || '';
      if (cur && cur !== current) setActiveStreamer(cur);
      if (!cur) {
        setEmotes([]);
        return;
      }
      const er = (await rpcCall('emotes.list', { streamer: cur })) as {
        emotes: EmoteInfo[];
      };
      const list = er.emotes || [];
      setEmotes((prev) =>
        list.length === 0 && prev.length > 0 && cur === current ? prev : list,
      );
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setLoading(false);
    }
  }

  // UN solo useEffect [open] — listener estable + load inicial.
  // CRÍTICO: NO depende de `reload`, así no se re-arma en cada render.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void reload();

    let timer: number | null = null;
    const off = window.maruApi.on('emotes:updated' as never, () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 600);
    });
    return () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cambiar de streamer activo → cargar sus emotes.
  useEffect(() => {
    if (!open || !activeStreamer) return;
    let aborted = false;
    void rpcCall('emotes.list', { streamer: activeStreamer })
      .then((r) => {
        if (aborted) return;
        const list = (r as { emotes: EmoteInfo[] }).emotes || [];
        // No vaciamos si la respuesta es vacía pero ya teníamos datos
        // (defensa contra race con manifest siendo escrito por otro evento).
        setEmotes((prev) => (list.length === 0 && prev.length > 0 ? prev : list));
      })
      .catch(() => undefined);
    return () => {
      aborted = true;
    };
  }, [activeStreamer, open]);

  const currentStreamer = streamers.find((s) => s.username === activeStreamer);

  async function handleAssignSound(emoteId: string) {
    if (!activeStreamer) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      // Electron 32+ removió `File.path`. Usamos `webUtils.getPathForFile`
      // expuesto por el preload. Sin esto, el path quedaba en undefined y
      // la asignación NO se persistía.
      const path = window.maruApi.getPathForFile(f);
      if (!path) {
        setError(
          'No pude obtener la ruta del archivo. Probá arrastrar el archivo desde el explorador.',
        );
        return;
      }
      try {
        const r = (await rpcCall('emotes.assign-sound', {
          streamer: activeStreamer,
          emoteId,
          soundPath: path,
        })) as { ok: boolean; message?: string };
        if (!r.ok) {
          setError(r.message || 'No se pudo asignar el sonido');
          return;
        }
        setError(null);
        await reload();
      } catch (ex) {
        setError(ex instanceof Error ? ex.message : String(ex));
      }
    };
    input.click();
  }

  async function handleDeleteEmote(emoteId: string) {
    if (!activeStreamer) return;
    if (!confirm(`Eliminar emote "${emoteId}"?`)) return;
    try {
      await rpcCall('emotes.delete', { streamer: activeStreamer, emoteId });
      await reload();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function handleClearSound(emoteId: string) {
    if (!activeStreamer) return;
    try {
      await rpcCall('emotes.assign-sound', {
        streamer: activeStreamer,
        emoteId,
        soundPath: '',
      });
      await reload();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  // Pulso visual mientras se reproduce el preview de un emote.
  // El timeout para autoclear lo guardamos en ref para poder cancelarlo
  // si el user pulsa "Detener" antes de que termine.
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  async function handlePreviewSound(emoteId: string) {
    if (!activeStreamer) return;
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPreviewing(emoteId);
    try {
      const r = (await rpcCall('emotes.preview-sound', {
        streamer: activeStreamer,
        emoteId,
      })) as { ok: boolean; message?: string };
      if (!r.ok) {
        setError(r.message || 'No se pudo reproducir el sonido');
        setPreviewing(null);
        return;
      }
      setError(null);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
      setPreviewing(null);
      return;
    }
    // Auto-clear del pulso visual tras un timeout razonable. El user
    // puede pulsar "Detener" antes para cortar manualmente el sonido.
    previewTimerRef.current = window.setTimeout(() => {
      setPreviewing(null);
      previewTimerRef.current = null;
    }, 8000);
  }

  async function handleStopSound() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPreviewing(null);
    try {
      await rpcCall('sounds.stop-all', {});
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  // Limpiar timer al desmontar.
  useEffect(() => {
    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  async function handleSaveStreamerInfo() {
    if (!activeStreamer) return;
    try {
      await rpcCall('emotes.set-streamer-avatar', {
        username: activeStreamer,
        displayName: editingDisplayName || activeStreamer,
      });
      await reload();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function handleRefreshAvatar() {
    if (!activeStreamer) return;
    try {
      const r = await rpcCall('emotes.refresh-avatar', {
        streamer: activeStreamer,
      });
      if (!r.ok) {
        setError(r.message || 'No se pudo actualizar la foto');
        return;
      }
      await reload();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function handleDeleteStreamer() {
    if (!activeStreamer) return;
    if (
      !confirm(
        `¿Eliminar PERMANENTEMENTE a "${activeStreamer}" y todos sus emotes? Esta acción no se puede deshacer.`,
      )
    )
      return;
    try {
      await rpcCall('emotes.delete-streamer', { streamer: activeStreamer });
      setActiveStreamer('');
      setEmotes([]);
      await reload();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  // Sync editingDisplayName cuando cambia activeStreamer.
  useEffect(() => {
    const s = streamers.find((x) => x.username === activeStreamer);
    setEditingDisplayName(s?.displayName ?? '');
  }, [activeStreamer, streamers]);

  if (!open) return null;

  return (
    <Dialog open onClose={closeModal} title="🎨 Emotes & Stickers" size="xl">
      <div className="flex flex-col gap-3 py-3">
        <p className="text-xs text-fg-muted">
          Emotes que llegan en el chat se descargan automáticamente acá.
          Asigná un sonido a cada uno y se reproducirá cuando alguien lo
          mande de nuevo. Los emotes se separan por streamer (multi-cuenta).
        </p>

        {/* Streamer selector */}
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Label>Streamer</Label>
            <Select
              value={activeStreamer}
              onChange={(e) => setActiveStreamer(e.target.value)}
              disabled={streamers.length === 0}
              className="w-full"
            >
              {streamers.length === 0 && (
                <option value="">Sin streamers — conectá TikTok primero</option>
              )}
              {streamers.map((s) => (
                <option key={s.username} value={s.username}>
                  {s.displayName} ({s.emoteCount} emotes)
                </option>
              ))}
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void reload()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Recargar
          </Button>
        </div>

        {/* Streamer profile */}
        {currentStreamer && (
          <div className="flex gap-3 items-center rounded-xl border border-border bg-bg-elev/30 p-3">
            <div className="shrink-0">
              {currentStreamer.avatar ? (
                <MaruImage
                  scope="emotes"
                  path={currentStreamer.avatar.replace('emotes/', '')}
                  size={64}
                  fallback="👤"
                  className="rounded-full"
                  alt={currentStreamer.displayName}
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-bg-base/60 flex items-center justify-center text-3xl">
                  👤
                </div>
              )}
            </div>
            <div className="flex-1">
              <Label>Display name</Label>
              <Input
                value={editingDisplayName}
                onChange={(e) => setEditingDisplayName(e.target.value)}
                placeholder={currentStreamer.username}
              />
              <p className="text-[10px] text-fg-subtle mt-1">
                @{currentStreamer.username} · {currentStreamer.emoteCount}{' '}
                emote{currentStreamer.emoteCount !== 1 ? 's' : ''} guardado
                {currentStreamer.emoteCount !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSaveStreamerInfo()}
              >
                💾 Guardar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRefreshAvatar()}
                title="Volver a descargar la foto del streamer (por si la actualizó en TikTok)"
              >
                🔄 Actualizar foto
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleDeleteStreamer()}
                className="!text-danger hover:!bg-danger/10"
                title="Eliminar este streamer y todos sus emotes"
              >
                🗑️ Borrar
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
            ❌ {error}
          </div>
        )}

        {/* Emotes grid */}
        <div className="min-h-[280px] max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : !activeStreamer ? (
            <Empty
              icon={Music}
              title="Sin streamer seleccionado"
              description="Conectá TikTok Live primero. Los emotes llegan automáticamente al recibir mensajes con stickers."
            />
          ) : emotes.length === 0 ? (
            <Empty
              icon={Music}
              title={`Sin emotes para ${currentStreamer?.displayName ?? activeStreamer}`}
              description="Cuando alguien envíe un emote en el chat, aparecerá acá automáticamente."
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
              {emotes.map((e) => {
                const hasSound = !!e.soundPath;
                const isPlaying = previewing === e.emoteId;
                return (
                  <div
                    key={e.emoteId}
                    className={[
                      'relative flex flex-col gap-1 rounded-xl border p-2 transition-all',
                      hasSound
                        ? 'border-success/60 bg-success/5 shadow-[0_0_0_1px_rgb(46_204_113/0.25)]'
                        : 'border-border bg-bg-elev/40',
                      isPlaying ? 'animate-accent-pulse' : '',
                    ].join(' ')}
                  >
                    {hasSound && (
                      <div
                        className="absolute -top-1.5 -right-1.5 flex items-center gap-1 rounded-full bg-success px-1.5 py-0.5 text-[9px] font-bold text-white shadow"
                        title="Este emote tiene sonido enlazado"
                      >
                        <Volume2 className="h-2.5 w-2.5" />
                        SONIDO
                      </div>
                    )}
                    <div className="flex justify-center bg-bg-base/40 rounded-md p-2 relative">
                      <MaruImage
                        scope="emotes"
                        path={e.path.replace('emotes/', '')}
                        size={64}
                        fallback="🎨"
                        className="rounded"
                        alt={e.name}
                        loadingStrategy="eager"
                      />
                      {isPlaying && (
                        <div className="absolute inset-0 flex items-center justify-center bg-success/15 rounded-md">
                          <Volume2 className="h-6 w-6 text-success animate-pulse-soft" />
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-fg-subtle truncate">
                      {e.emoteId}
                    </p>
                    {hasSound ? (
                      <>
                        <p
                          className="text-[10px] text-success font-medium truncate"
                          title={e.soundPath}
                        >
                          🔊 {e.soundPath.split(/[\\/]/).pop()}
                        </p>
                        <div className="flex gap-1">
                          {isPlaying ? (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => void handleStopSound()}
                              className="flex-1 !text-[10px] !py-1"
                              title="Detener el sonido"
                            >
                              <Square className="h-3 w-3" />
                              Detener
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => void handlePreviewSound(e.emoteId)}
                              className="flex-1 !text-[10px] !py-1"
                              title="Reproducir el sonido para probarlo"
                            >
                              <Play className="h-3 w-3" />
                              Probar
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleAssignSound(e.emoteId)}
                            className="!text-[10px] !py-1 !px-1.5"
                            title="Cambiar sonido"
                          >
                            <Music className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleClearSound(e.emoteId)}
                            className="!text-[10px] !py-1 !px-1.5 hover:!text-danger"
                            title="Quitar sonido"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-[10px] text-fg-subtle italic">
                          Sin sonido
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleAssignSound(e.emoteId)}
                          className="!text-[10px] !py-1"
                        >
                          <Music className="h-3 w-3" />
                          Asignar sonido
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDeleteEmote(e.emoteId)}
                          className="!text-[10px] !py-1 hover:!text-danger"
                          title="Eliminar emote"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={closeModal}>
            Cerrar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
