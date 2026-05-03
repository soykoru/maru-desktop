import { useEffect, useId, useState } from 'react';
import {
  Heart,
  HeartCrack,
  Plus,
  RefreshCw,
  Search,
  Star,
  Sword,
  Trash2,
  UserMinus,
  UserPlus,
  Zap,
} from 'lucide-react';
import {
  Button,
  Empty,
  Input,
  Spinner,
} from '@maru/ui';
import type { SocialUser } from '@maru/shared';
import { AutoRachaModal } from './AutoRachaModal.js';

/**
 * `UsersTab` — TAB 3 del SocialConfigDialog.
 *
 * Réplica de la tabla de usuarios + acciones del MARU original:
 *   - Search debounced (a través del slice).
 *   - Tabla con columnas: Usuario | Reg | Racha | Récord | Casado |
 *     Novio | Mejor Amigo | Rival | Victorias.
 *   - Edit en celda de Racha (input number) + relaciones (input text;
 *     vacío/`-` elimina la relación).
 *   - Acciones por usuario seleccionado: registrar/des-registrar,
 *     reset racha/relaciones, AutoRacha modal, eliminar.
 *   - Add usuario manual.
 */
export interface UsersTabProps {
  users: SocialUser[];
  visibleUsers: SocialUser[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  search: string;
  selectedUsername: string | null;
  selectedUser: SocialUser | null;
  onSearchChange: (q: string) => void;
  onSelect: (username: string | null) => void;
  onRefresh: () => void | Promise<void>;
  onRegister: (username: string) => Promise<void>;
  onUnregister: (username: string) => Promise<void>;
  onDelete: (username: string) => Promise<void>;
  onSetRacha: (username: string, days: number) => Promise<void>;
  onResetRacha: (username: string) => Promise<void>;
  onResetRelaciones: (username: string) => Promise<void>;
  onRemoveMarriage: (username: string) => Promise<void>;
  onRemoveRelationship: (
    username: string,
    relType: 'novios' | 'amigo' | 'rival',
  ) => Promise<void>;
  onActivateAutoRacha: (
    username: string,
    days: number,
    kind?: 'manual' | 'super_fan',
  ) => Promise<string | undefined>;
  onDeactivateAutoRacha: (username: string) => Promise<string | undefined>;
  busy?: boolean;
}

const RELATION_REMOVE_VALUES = new Set(['', '-', 'ninguno', 'none']);

export function UsersTab({
  visibleUsers,
  status,
  error,
  search,
  selectedUsername,
  selectedUser,
  onSearchChange,
  onSelect,
  onRefresh,
  onRegister,
  onUnregister,
  onDelete,
  onSetRacha,
  onResetRacha,
  onResetRelaciones,
  onRemoveMarriage,
  onRemoveRelationship,
  onActivateAutoRacha,
  onDeactivateAutoRacha,
  busy = false,
}: UsersTabProps) {
  const idPrefix = useId();
  const [newUsername, setNewUsername] = useState('');
  const [autoRachaOpen, setAutoRachaOpen] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editingCells, setEditingCells] = useState<Record<string, string>>({});

  useEffect(() => {
    setOpError(null);
  }, [selectedUsername]);

  function cellKey(username: string, field: string): string {
    return `${username}::${field}`;
  }

  async function handleEditCellRacha(username: string, raw: string) {
    const days = parseInt(raw, 10);
    if (Number.isNaN(days) || days < 0) return;
    try {
      await onSetRacha(username, days);
    } catch (ex) {
      setOpError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function handleEditRelationship(
    username: string,
    field: 'marriage' | 'partner' | 'best_friend' | 'rival',
    raw: string,
  ) {
    const trimmed = raw.trim().toLowerCase();
    if (RELATION_REMOVE_VALUES.has(trimmed)) {
      try {
        if (field === 'marriage') {
          await onRemoveMarriage(username);
        } else if (field === 'partner') {
          await onRemoveRelationship(username, 'novios');
        } else if (field === 'best_friend') {
          await onRemoveRelationship(username, 'amigo');
        } else if (field === 'rival') {
          await onRemoveRelationship(username, 'rival');
        }
      } catch (ex) {
        setOpError(ex instanceof Error ? ex.message : String(ex));
      }
    }
    // Para crear/cambiar relaciones desde admin no hay método directo en
    // el core — el MARU original tampoco lo permite. Solo borrar.
  }

  async function handleAddManual() {
    const u = newUsername.trim();
    if (!u) return;
    try {
      await onRegister(u);
      setNewUsername('');
    } catch (ex) {
      setOpError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  return (
    <div className="space-y-3">
      <AutoRachaModal
        open={autoRachaOpen}
        user={selectedUser}
        onClose={() => setAutoRachaOpen(false)}
        onActivate={(d, kind) =>
          selectedUser
            ? onActivateAutoRacha(selectedUser.username, d, kind)
            : Promise.resolve(undefined)
        }
        onDeactivate={() =>
          selectedUser
            ? onDeactivateAutoRacha(selectedUser.username)
            : Promise.resolve(undefined)
        }
        busy={busy}
      />

      {/* Search + add manual */}
      <div className="flex flex-wrap gap-2">
        <Input
          prefix={<Search className="h-3.5 w-3.5" />}
          placeholder="Buscar usuario..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 min-w-[200px]"
          disabled={busy}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void onRefresh()}
          disabled={busy || status === 'loading'}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refrescar
        </Button>
        <Input
          id={`${idPrefix}-add`}
          placeholder="Registrar usuario manualmente..."
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          className="flex-1 min-w-[200px]"
          disabled={busy}
        />
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void handleAddManual()}
          disabled={busy || !newUsername.trim()}
        >
          <Plus className="h-3.5 w-3.5" />
          Registrar
        </Button>
      </div>

      {opError && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger">
          {opError}
        </div>
      )}

      {/* Tabla */}
      <div className="rounded-xl border border-border bg-bg-elev/30 overflow-hidden">
        {status === 'loading' && visibleUsers.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : status === 'error' ? (
          <Empty
            icon={UserMinus}
            title="No se pudieron cargar los usuarios"
            description={error ?? 'Error desconocido'}
            action={
              <Button size="sm" onClick={() => void onRefresh()}>
                Reintentar
              </Button>
            }
          />
        ) : visibleUsers.length === 0 ? (
          <Empty
            icon={UserMinus}
            title={search ? 'Sin coincidencias' : 'Sin usuarios todavía'}
            description={
              search
                ? `No hay usuarios que matcheen "${search}".`
                : 'Cuando alguien escriba !register en chat, aparecerá acá.'
            }
          />
        ) : (
          // v1.0.53 — fix definitivo y robusto del header sticky:
          // 1. wrapper con overflow-y-auto explícito (scrollport propio).
          // 2. table.maru-sticky-table aplica bg sólido fuerte al thead/tr/th
          //    con !important para garantizar opacidad absoluta.
          // 3. isolation: isolate impide que z-index del thead "sangre"
          //    fuera del wrapper.
          <div className="overflow-y-auto overflow-x-auto max-h-[280px] relative isolate">
            <table className="maru-sticky-table w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-fg-subtle">
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium border-b border-border">Usuario</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium text-center w-10 border-b border-border">Reg</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium w-28 border-b border-border">Racha</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium text-center w-14 border-b border-border">Récord</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium border-b border-border">Casado/a</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium border-b border-border">Novio/a</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium border-b border-border">Mejor Amigo</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium border-b border-border">Rival</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium text-center w-14 border-b border-border">Victorias</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium text-center w-10 border-b border-border" title="Eliminar usuario"></th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => {
                  const isSelected = u.username === selectedUsername;
                  const rachaCellKey = cellKey(u.username, 'racha');
                  const isAutoSF = u.auto_racha?.kind === 'super_fan';
                  // v1.0.53: display compacto que NO se corta. Ya no
                  // metemos el "(N)" como sufijo string del input — el
                  // input solo lleva el número (lo que queremos que sea
                  // editable). El badge del estado auto-racha lo
                  // mostramos en una columna SEPARADA con su propio
                  // pill de color.
                  const rachaText =
                    editingCells[rachaCellKey] ?? String(u.racha);
                  const isSuperFan = !!u.is_super_fan;
                  return (
                    <tr
                      key={u.username}
                      onClick={() => onSelect(u.username)}
                      className={[
                        'cursor-pointer transition-colors',
                        isSelected
                          ? 'bg-accent/10'
                          : isSuperFan
                            ? 'maru-super-fan-row hover:bg-warning/8'
                            : 'hover:bg-fg/5',
                      ].join(' ')}
                    >
                      <td
                        className="px-2 py-1.5 font-medium border-b border-border/50"
                        title={u.username}
                      >
                        <div className="flex items-center gap-2 max-w-[160px]">
                          {u.avatar ? (
                            <img
                              src={u.avatar}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className={[
                                'h-6 w-6 rounded-full object-cover flex-shrink-0',
                                isSuperFan
                                  ? 'maru-super-fan-avatar-ring'
                                  : 'border border-border',
                              ].join(' ')}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <span
                              className={[
                                'h-6 w-6 rounded-full grid place-items-center text-[10px] font-bold flex-shrink-0',
                                isSuperFan
                                  ? 'maru-super-fan-avatar-ring bg-warning/15 text-warning'
                                  : 'bg-fg/10 text-fg-muted',
                              ].join(' ')}
                              aria-hidden="true"
                            >
                              {u.username.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="truncate flex items-center gap-1">
                            {u.username}
                            {isSuperFan && (
                              <span
                                className="maru-super-fan-gold inline-flex items-center gap-0.5 rounded px-1 text-[8.5px] tracking-wider leading-none"
                                title="Super Fan del live (rol activo)"
                              >
                                ⭐ FAN
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center border-b border-border/50">
                        {u.registered ? '✅' : '❌'}
                      </td>
                      <td
                        className="px-2 py-1.5 border-b border-border/50"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* v1.0.53: input + badge separado para que el
                            indicador de auto-racha no compita con el
                            número editable y NO se corte. */}
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={rachaText}
                            onChange={(e) =>
                              setEditingCells((s) => ({
                                ...s,
                                [rachaCellKey]: e.target.value,
                              }))
                            }
                            onBlur={(e) => {
                              const raw = e.target.value;
                              const numeric = raw.match(/\d+/)?.[0] ?? '';
                              if (numeric && parseInt(numeric, 10) !== u.racha) {
                                void handleEditCellRacha(u.username, numeric);
                              }
                              setEditingCells((s) => {
                                const next = { ...s };
                                delete next[rachaCellKey];
                                return next;
                              });
                            }}
                            className="min-w-0 flex-1 bg-transparent border-b border-transparent hover:border-border focus:border-accent text-xs font-mono outline-none"
                          />
                          {u.auto_racha?.active && (
                            isAutoSF ? (
                              <span
                                className="maru-super-fan-gold inline-flex items-center rounded px-1 py-0.5 text-[8px] font-bold tracking-wider leading-none flex-shrink-0"
                                title="Racha automática Super Fan — activa hasta finalizar suscripción"
                              >
                                AUTO
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center rounded px-1 py-0.5 text-[8px] font-bold tracking-wider leading-none flex-shrink-0 bg-accent/15 text-accent border border-accent/35"
                                title={`Racha automática manual — ${u.auto_racha.remaining_days}/${u.auto_racha.total_days} días restantes`}
                              >
                                {u.auto_racha.remaining_days}d
                              </span>
                            )
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center text-fg-muted border-b border-border/50">
                        {u.record_racha}
                      </td>
                      {(['marriage', 'partner', 'best_friend', 'rival'] as const).map(
                        (field) => {
                          const val = (u[field] ?? '') as string;
                          const ck = cellKey(u.username, field);
                          return (
                            <td
                              key={field}
                              className="px-2 py-1.5 border-b border-border/50"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                value={editingCells[ck] ?? val}
                                onChange={(e) =>
                                  setEditingCells((s) => ({
                                    ...s,
                                    [ck]: e.target.value,
                                  }))
                                }
                                onBlur={(e) => {
                                  const raw = e.target.value;
                                  if (raw !== val) {
                                    void handleEditRelationship(
                                      u.username,
                                      field,
                                      raw,
                                    );
                                  }
                                  setEditingCells((s) => {
                                    const next = { ...s };
                                    delete next[ck];
                                    return next;
                                  });
                                }}
                                placeholder="-"
                                className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-accent text-xs outline-none"
                              />
                            </td>
                          );
                        },
                      )}
                      <td className="px-2 py-1.5 text-center text-success font-mono border-b border-border/50">
                        {u.duelos_ganados}
                      </td>
                      <td
                        className="px-2 py-1.5 text-center border-b border-border/50"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setPendingDelete(u.username)}
                          disabled={busy}
                          title={`Eliminar a ${u.username}`}
                          aria-label={`Eliminar a ${u.username}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Acciones del usuario seleccionado */}
      {selectedUser && (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold flex-1 truncate">
              👤 {selectedUser.username}
            </p>
            <span className="text-xs text-fg-subtle">
              {selectedUser.registered ? '✅ Registrado' : '❌ No registrado'}
            </span>
          </div>
          <div className="text-[11px] text-fg-muted leading-relaxed">
            🔥 Racha: {selectedUser.racha} | Récord: {selectedUser.record_racha} ·
            ⚔️ Ganados: {selectedUser.duelos_ganados} | Perdidos: {selectedUser.duelos_perdidos}
            {selectedUser.auto_racha?.active && (
              <>
                <br />
                {selectedUser.auto_racha.kind === 'super_fan' ? (
                  <>
                    <span className="maru-super-fan-gold inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] tracking-wider leading-none mr-1">
                      ⭐ SUPER FAN
                    </span>
                    Racha automática vinculada al rol Super Fan — durará
                    hasta que termine la suscripción.
                  </>
                ) : (
                  <>
                    ⚡ Racha Automática activa: {selectedUser.auto_racha.remaining_days}/{selectedUser.auto_racha.total_days} días restantes.
                  </>
                )}
              </>
            )}
            {selectedUser.marriage && (
              <>
                <br />
                💍 Casado/a con: <strong>{selectedUser.marriage}</strong>
              </>
            )}
            {selectedUser.partner && (
              <>
                <br />
                💕 Novio/a de: <strong>{selectedUser.partner}</strong>
              </>
            )}
            {selectedUser.best_friend && (
              <>
                <br />
                🤝 Mejor amigo: <strong>{selectedUser.best_friend}</strong>
              </>
            )}
            {selectedUser.rival && (
              <>
                <br />
                😤 Rival: <strong>{selectedUser.rival}</strong>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedUser.registered ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void onUnregister(selectedUser.username).catch((ex) =>
                    setOpError(ex instanceof Error ? ex.message : String(ex)),
                  )
                }
                disabled={busy}
              >
                <UserMinus className="h-3 w-3" />
                Des-registrar
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void onRegister(selectedUser.username).catch((ex) =>
                    setOpError(ex instanceof Error ? ex.message : String(ex)),
                  )
                }
                disabled={busy}
              >
                <UserPlus className="h-3 w-3" />
                Registrar
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void onResetRacha(selectedUser.username).catch((ex) =>
                  setOpError(ex instanceof Error ? ex.message : String(ex)),
                )
              }
              disabled={busy}
            >
              <Sword className="h-3 w-3" />
              Reset Racha
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void onResetRelaciones(selectedUser.username).catch((ex) =>
                  setOpError(ex instanceof Error ? ex.message : String(ex)),
                )
              }
              disabled={busy}
            >
              <HeartCrack className="h-3 w-3" />
              Reset Relaciones
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAutoRachaOpen(true)}
              disabled={busy}
            >
              <Zap className="h-3 w-3" />
              Auto-Racha
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setPendingDelete(selectedUser.username)}
              disabled={busy}
            >
              <Trash2 className="h-3 w-3" />
              Eliminar
            </Button>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          ¿Eliminar permanentemente al usuario <strong>{pendingDelete}</strong>?
          Se borran todas sus relaciones, racha y stats.
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                void onDelete(pendingDelete)
                  .then(() => setPendingDelete(null))
                  .catch((ex) => setOpError(ex instanceof Error ? ex.message : String(ex)))
              }
              disabled={busy}
            >
              Sí, eliminar
            </Button>
          </div>
        </div>
      )}

      {/* Hint sobre relaciones */}
      <p className="text-[11px] text-fg-subtle">
        <Heart className="inline h-3 w-3 text-accent-red" /> Tip: en celdas de
        relación escribí <code>-</code>, vacío o <code>none</code> y blur para
        remover. <Star className="inline h-3 w-3 text-warning" /> Crear/cambiar
        una relación a otro usuario debe hacerse desde el chat con el comando
        correspondiente (no admin).
      </p>
    </div>
  );
}
