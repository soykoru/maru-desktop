import { useEffect, useState } from 'react';
import { BookOpen, FilePlus2, Plus } from 'lucide-react';
import { Button, Dialog, Empty, Spinner } from '@maru/ui';
import { Gamepad2 } from 'lucide-react';
import type { DataKind, GameId, GameProfile } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useGames } from '../../../lib/use-games.js';
import { rpcCall } from '../../../lib/rpc.js';
import { GameCard } from './GameCard.js';

/**
 * `ManageGamesDialog` — hub de gestión de perfiles de juego.
 *
 * Réplica de `manage_games_dialog.py:ManageGamesDialog`:
 *   - 📦 Predefinidos (3 botones que abren EditPredefinedDialog).
 *   - 🎯 Personalizados (lista + Nuevo / Añadir / Editar / Eliminar).
 *   - Help bullets explicativos.
 *
 * Mejoras sobre original:
 *   - Confirmación de delete con detalle de archivos a borrar.
 *   - Loading state mientras `games.list` carga.
 *   - Sidebar selecciona automáticamente el perfil al editar.
 */
export function ManageGamesDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'manage-games'));
  const closeModal = useAppStore((s) => s.closeModal);
  const openModal = useAppStore((s) => s.openModal);

  const {
    predefined,
    custom,
    status,
    error,
    refresh,
    deleteCustom,
    setCover,
    removeCover,
  } = useGames({ autoLoad: open });

  const [pendingDelete, setPendingDelete] = useState<GameProfile | null>(null);
  const [busy, setBusy] = useState(false);
  // v1.0.71: estado del botón "Descargar documentación".
  const [docFlash, setDocFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPendingDelete(null);
      setBusy(false);
      setDocFlash(null);
    }
  }, [open]);

  /**
   * v1.0.71: descarga la documentación maestra de cómo conectar juegos
   * a MARU como archivo Markdown. Útil para:
   *   - Pegarle a una IA y que genere el mod del juego que quiere integrar.
   *   - Compartir con devs que vayan a hacer mods compatibles.
   *   - Tener referencia offline del contrato HTTP/RCON.
   */
  async function downloadDoc() {
    setBusy(true);
    setDocFlash(null);
    try {
      const res = await rpcCall('games-doc.get', {});
      const out = await window.maruApi.dialog.saveText({
        content: res.markdown,
        defaultPath: res.filename,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Texto', extensions: ['txt'] },
        ],
      });
      if (out.ok && out.path) {
        setDocFlash(`✅ Guardado en: ${out.path}`);
      } else if (out.error) {
        setDocFlash(`❌ Error: ${out.error}`);
      }
      // Si user canceló (ok=false sin error), no mostramos nada.
    } catch (exc) {
      setDocFlash(`❌ ${exc instanceof Error ? exc.message : String(exc)}`);
    } finally {
      setBusy(false);
      // Limpiar feedback automáticamente tras 6s.
      window.setTimeout(() => setDocFlash(null), 6000);
    }
  }

  if (!open) return null;

  function editPredefined(id: GameId) {
    openModal('edit-predefined', { gameId: id });
  }

  function newProfile() {
    openModal('new-profile');
  }

  function addCustom() {
    openModal('custom-game');
  }

  function editCustom(id: GameId) {
    openModal('custom-game', { gameId: id });
  }

  function openData(profile: GameProfile) {
    const firstKind: DataKind =
      profile.categories[0]?.id ??
      (profile.hasEntities
        ? 'entities'
        : profile.hasItems
          ? 'items'
          : profile.hasEvents
            ? 'events'
            : 'entities');
    openModal('data', { gameId: profile.id, kind: firstKind });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await deleteCustom(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open
        onClose={closeModal}
        size="xl"
        title="🎮 Perfiles de Juegos"
        description="Cada perfil tiene sus propias reglas, entidades e items."
      >
        {status === 'loading' && predefined.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : status === 'error' ? (
          <Empty
            icon={Gamepad2}
            title="No se pudieron cargar los perfiles"
            description={error ?? 'Error desconocido'}
            action={
              <Button size="sm" onClick={() => void refresh()}>
                Reintentar
              </Button>
            }
          />
        ) : (
          <div className="space-y-5">
            {/* v1.0.72: Galería visual estilo Steam Library.
                Predefinidos + Customs en grids separados con cards grandes. */}

            {/* 📦 Predefinidos */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-success mb-2.5">
                📦 Perfiles Predefinidos
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {predefined.map((g) => (
                  <GameCard
                    key={g.id}
                    profile={g}
                    onEdit={() => editPredefined(g.id)}
                    onOpenData={() => openData(g)}
                    onChangeCover={async (id, path) => {
                      await setCover(id, path);
                    }}
                    onRemoveCover={async (id) => {
                      await removeCover(id);
                    }}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-fg-subtle">
                Solo se pueden editar host, puerto y (Minecraft) password RCON.
              </p>
            </section>

            {/* 🎯 Custom */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-accent mb-2.5">
                🎯 Perfiles Personalizados
              </h3>

              {custom.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-bg-elev/30 px-4 py-8 text-center">
                  <p className="text-sm text-fg-subtle italic mb-3">
                    Sin perfiles custom todavía. Empezá agregando un juego desde cero o duplicando uno existente.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {custom.map((g) => (
                    <GameCard
                      key={g.id}
                      profile={g}
                      onEdit={() => editCustom(g.id)}
                      onOpenData={() => openData(g)}
                      onDelete={() => setPendingDelete(g)}
                      onChangeCover={async (id, path) => {
                        await setCover(id, path);
                      }}
                      onRemoveCover={async (id) => {
                        await removeCover(id);
                      }}
                    />
                  ))}
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={newProfile}
                  title="Crear basado en otro perfil existente"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Nuevo Perfil (basado en otro)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={addCustom}
                  title="Añadir un juego custom desde cero"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Añadir Juego (API/RCON)
                </Button>
              </div>
            </section>

            {/* Help */}
            <section className="rounded-xl border border-border bg-bg-elev/30 p-3">
              <ul className="text-[11px] text-fg-muted space-y-1 leading-relaxed">
                <li>
                  • <strong>Nuevo perfil</strong> duplica reglas/datos de otro
                  juego — útil para variantes (Valheim Modded, etc.).
                </li>
                <li>
                  • <strong>Añadir Juego</strong> permite definir endpoints
                  HTTP o comandos RCON propios.
                </li>
                <li>
                  • Cada perfil tiene su propio set de reglas (
                  <code className="font-mono">rules_&lt;id&gt;.json</code>).
                </li>
                <li>
                  • Sonidos y voces se pueden compartir entre perfiles o ser
                  específicas por perfil.
                </li>
              </ul>
            </section>

            {/* v1.0.71: Documentación maestra de juegos */}
            <section className="rounded-xl border border-accent/30 bg-accent/5 p-3">
              <div className="flex items-start gap-3">
                <BookOpen className="h-5 w-5 shrink-0 text-accent mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-accent mb-1">
                    📖 Documentación de Juegos
                  </h4>
                  <p className="text-[11px] text-fg-muted leading-relaxed mb-2">
                    Descargá un archivo Markdown completo con:
                    cómo MARU se conecta a juegos, contrato HTTP/RCON,
                    plantillas de mods (BepInEx C#, Spigot Java),
                    cómo agregar juegos nuevos, y todo lo necesario para
                    pegarle a una IA y que te genere el mod específico
                    de tu juego.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void downloadDoc()}
                    disabled={busy}
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    {busy ? 'Generando…' : 'Descargar documentación'}
                  </Button>
                  {docFlash && (
                    <p className="mt-2 text-[10px] font-mono text-fg-subtle">
                      {docFlash}
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </Dialog>

      {/* Confirm delete */}
      {pendingDelete && (
        <Dialog
          open
          onClose={() => !busy && setPendingDelete(null)}
          size="sm"
          title="🗑️ Eliminar perfil"
        >
          <div className="space-y-3 text-sm">
            <p>
              ¿Eliminar el perfil{' '}
              <strong>
                {pendingDelete.icon} {pendingDelete.name}
              </strong>
              ?
            </p>
            <ul className="text-xs text-fg-muted space-y-1 list-disc pl-5">
              <li>Configuración del juego (games.json).</li>
              <li>
                <code className="font-mono">data_{pendingDelete.id}.json</code>{' '}
                (entidades, items, eventos).
              </li>
              <li>
                <code className="font-mono">rules_{pendingDelete.id}.json</code>{' '}
                (todas las reglas).
              </li>
            </ul>
            <p className="text-xs text-warning">
              Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingDelete(null)}
                disabled={busy}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void confirmDelete()}
                disabled={busy}
              >
                {busy ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
