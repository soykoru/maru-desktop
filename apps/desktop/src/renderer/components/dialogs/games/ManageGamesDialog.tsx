import { useEffect, useState } from 'react';
import { Edit3, FilePlus2, Package, Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Empty, Spinner } from '@maru/ui';
import { Gamepad2 } from 'lucide-react';
import type { DataKind, GameId, GameProfile } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useGames } from '../../../lib/use-games.js';

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
  } = useGames({ autoLoad: open });

  const [pendingDelete, setPendingDelete] = useState<GameProfile | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setPendingDelete(null);
      setBusy(false);
    }
  }, [open]);

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
        size="lg"
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
          <div className="space-y-4">
            {/* 📦 Predefinidos */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-success mb-2">
                📦 Perfiles Predefinidos
              </h3>
              <div className="space-y-1.5">
                {predefined.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-2 rounded-md border border-border/50 bg-bg-elev/40 px-2 py-1.5"
                  >
                    <span className="font-emoji text-lg">{g.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{g.name}</p>
                      <p className="text-[10px] text-fg-subtle font-mono truncate">
                        {g.connectionType.toUpperCase()} ·{' '}
                        {g.connection.host}:{g.connection.port}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openData(g)}
                      title="Editar entidades / items / eventos"
                    >
                      <Package className="h-3.5 w-3.5" />
                      Datos
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editPredefined(g.id)}
                      title={`Editar conexión de ${g.name}`}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-fg-subtle">
                Solo se pueden editar host, puerto y (Minecraft) password RCON.
              </p>
            </section>

            {/* 🎯 Custom */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-accent mb-2">
                🎯 Perfiles Personalizados
              </h3>

              <div className="rounded-xl border border-border bg-bg-elev min-h-[150px] max-h-[260px] overflow-y-auto p-1">
                {custom.length === 0 ? (
                  <p className="text-xs text-fg-subtle italic px-3 py-6 text-center">
                    Sin perfiles custom todavía.
                  </p>
                ) : (
                  custom.map((g) => (
                    <div
                      key={g.id}
                      className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-fg/5 transition-colors"
                    >
                      <span className="font-emoji text-lg">{g.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {g.name}
                        </p>
                        <p className="text-[10px] text-fg-subtle font-mono truncate">
                          {g.connectionType.toUpperCase()} ·{' '}
                          {g.connection.host}:{g.connection.port} · id={g.id}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openData(g)}
                        title="Editar entidades / items / eventos"
                      >
                        <Package className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => editCustom(g.id)}
                        title="Editar"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(g)}
                        title="Eliminar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
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
