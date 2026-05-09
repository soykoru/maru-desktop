import { useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import {
  ArrowUpDown,
  Camera,
  CheckCircle2,
  Copy,
  Edit3,
  FileDown,
  FileUp,
  ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X as XIcon,
} from 'lucide-react';
import { Button, Dialog, Empty, Input, MaruImage, Select, Spinner, toast } from '@maru/ui';
import type { ProfileSnapshot } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useProfiles } from '../../../lib/use-profiles.js';
import { useConfirm } from '../../../lib/use-notify.js';

/**
 * `StreamProfilesDialog` (G10) — réplica de `profiles_dialog.py`.
 *
 * Snapshots completos del estado: juego activo, reglas, gifts, sonidos,
 * voces, IA, social. Operaciones save/load/duplicate/rename/delete +
 * export/import como `.lce_profile.json`.
 *
 * Mejoras vs MARU original:
 *   - Counts por card (rules enabled/total · gifts · custom games).
 *   - Size en human-friendly (B/KB/MB).
 *   - Confirm de load con resumen del backup automático.
 *   - Export/import como JSON portable (no zip).
 */
const GAME_ICONS: Record<string, string> = {
  valheim: '🐉',
  terraria: '🌳',
  minecraft: '⛏️',
  '7_days_to_die': '🧟',
  ror2: '☄️',
  hytale: '🎮',
  repo: '📦',
};

function formatBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(ms: number | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString();
}

export function StreamProfilesDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'profiles'));
  const closeModal = useAppStore((s) => s.closeModal);

  const profiles = useProfiles({ autoLoad: open });
  const confirm = useConfirm();

  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [saveDraft, setSaveDraft] = useState({ name: '', description: '' });
  const [showSaveForm, setShowSaveForm] = useState(false);

  // v1.0.94+ — UX visual del rediseño:
  //   - `loadingOverlay`: animación full-modal cuando se carga un perfil.
  //     phase=loading muestra spinner; phase=success muestra ✓ con bounce;
  //     auto-dismiss 1.5s después del success.
  //   - `coverBusy`: id del perfil cuyo cover se está actualizando.
  //   - `coverBust`: cache-bust counter para forzar reload de la imagen.
  //   - `dragOverId`: id del perfil sobre el que se está arrastrando un
  //     archivo (para pintar el highlight de drop zone).
  const [loadingOverlay, setLoadingOverlay] = useState<{
    profile: ProfileSnapshot;
    phase: 'loading' | 'success';
  } | null>(null);
  const [coverBusy, setCoverBusy] = useState<string | null>(null);
  const [coverBust, setCoverBust] = useState(0);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // v1.0.85 — search + sort UI mejoras
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'newest' | 'oldest' | 'name' | 'size'>('newest');
  // v1.0.86 — filtro por juego activo (default ON cuando hay juego activo).
  // El user pidió: "los perfiles son individuales entre juegos para poder
  // tener multiples perfiles en un juego".
  const activeGameId = useAppStore((s) => s.selectedGameId);
  const activeGameProfile = useAppStore((s) =>
    s.selectedGameId ? s.games[s.selectedGameId] : null,
  );
  const activeGameName = activeGameProfile?.name || activeGameId || null;
  const [showAllGames, setShowAllGames] = useState(false);

  // Stats agregados sobre TODOS los perfiles
  const stats = useMemo(() => {
    const total = profiles.profiles.length;
    const totalSize = profiles.profiles.reduce((sum, p) => sum + (p.sizeBytes || 0), 0);
    const byGame: Record<string, number> = {};
    for (const p of profiles.profiles) {
      const key = p.gameId || 'sin-juego';
      byGame[key] = (byGame[key] || 0) + 1;
    }
    return { total, totalSize, byGame };
  }, [profiles.profiles]);

  // Aplicar filtro juego activo + search + sort
  const visible = useMemo(() => {
    let out = profiles.profiles;
    // v1.0.86: filtrar por juego activo a menos que el user pida ver todos.
    // Los perfiles legacy (isPerGame=false) o sin gameId se muestran SIEMPRE
    // (no son por juego, son globales).
    if (!showAllGames && activeGameId) {
      out = out.filter((p) => {
        // Mostrar si: es del juego activo, o es legacy/sin-gameId.
        if (p.gameId === activeGameId) return true;
        if (!p.gameId) return true;
        if (!p.isPerGame) return true;  // legacy se muestra siempre
        return false;
      });
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter((p) => {
        const haystack = [
          p.name,
          p.description || '',
          p.gameName || '',
          p.gameId || '',
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    out = out.slice().sort((a, b) => {
      switch (sortMode) {
        case 'newest': return (b.createdAt || 0) - (a.createdAt || 0);
        case 'oldest': return (a.createdAt || 0) - (b.createdAt || 0);
        case 'name': return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
        case 'size': return (b.sizeBytes || 0) - (a.sizeBytes || 0);
      }
    });
    return out;
  }, [profiles.profiles, searchQuery, sortMode, showAllGames, activeGameId]);

  if (!open) return null;

  const selected = profiles.profiles.find(
    (p) => p.id === profiles.selectedId,
  );

  /**
   * v1.0.94+: `flash()` ahora despacha al sistema de toasts global
   * (`@maru/ui` toast singleton) para que las notificaciones aparezcan
   * en bottom-right con animación + icon. Antes era un banner discreto
   * en el header del modal que se veía "anticuado".
   */
  function flash(msg: string, ok = true) {
    // Strippeamos el ✓ / ✗ del prefijo viejo si vino — el toast ya
    // pinta su propio icon según el variant.
    const stripped = msg.replace(/^[✓✗⚠️]\s*/, '').trim();
    if (ok) toast.success(stripped);
    else toast.error(stripped);
  }

  async function handleSave() {
    const name = saveDraft.name.trim();
    if (!name) return;
    if (!activeGameId) {
      flash('✗ No hay juego activo. Seleccioná uno antes de guardar el perfil.', false);
      return;
    }
    setBusy(true);
    try {
      // v1.0.86: pasamos el gameId activo para que sea perfil per-game.
      await profiles.save(
        name,
        saveDraft.description.trim() || undefined,
        activeGameId,
      );
      setSaveDraft({ name: '', description: '' });
      setShowSaveForm(false);
      flash(`✓ Perfil "${name}" guardado para ${activeGameName}.`);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(p: ProfileSnapshot) {
    const gameLabel = p.gameName ?? p.gameId ?? 'el juego';
    const ok = p.isPerGame
      ? await confirm({
          icon: '💾',
          title: `Cargar perfil "${p.name}"`,
          message: `Se reemplazarán SOLO los archivos de ${gameLabel}:`,
          bullets: [
            `${p.rulesCount ?? 0} regla${p.rulesCount === 1 ? '' : 's'}`,
            'Entries del catálogo (entidades, items, eventos)',
            'Sonidos asignados a triggers de este juego',
            'Boosts (multiplicadores) de este juego',
          ],
          footnote:
            'NO se tocan: Spotify, IA, voces TTS por usuario, datos sociales, ' +
            'regalos personalizados ni la config de otros juegos. ' +
            'Se creará un backup automático antes.',
          variant: 'default',
          confirmLabel: 'Cargar',
        })
      : await confirm({
          icon: '⚠️',
          title: `Cargar perfil "${p.name}" (legacy)`,
          message: 'Modo legacy — snapshot completo. Reemplazará:',
          bullets: [
            `${p.rulesCount ?? 0} reglas`,
            `${p.giftsCount ?? 0} regalos personalizados`,
            'Sonidos, voces, IA y datos sociales (TODO global)',
          ],
          footnote: 'Se creará un backup automático antes.',
          variant: 'warning',
          confirmLabel: 'Cargar de todos modos',
        });
    if (!ok) return;
    setBusy(true);
    setLoadingOverlay({ profile: p, phase: 'loading' });
    try {
      await profiles.load(p.id);
      // Transición a éxito — la animación se ejecuta y luego auto-dismiss.
      setLoadingOverlay({ profile: p, phase: 'success' });
      window.setTimeout(() => setLoadingOverlay(null), 1600);
    } catch (ex) {
      setLoadingOverlay(null);
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  /** v1.0.95+: actualizar perfil existente con el estado actual del juego.
   *  Confirm dialog explica qué se reemplaza. Toast de éxito al final. */
  async function handleUpdate(p: ProfileSnapshot) {
    if (!p.isPerGame) {
      toast.warn(
        'Perfil legacy no actualizable',
        'Solo se pueden actualizar perfiles per-game (modo recomendado).',
      );
      return;
    }
    const gameLabel = p.gameName ?? p.gameId ?? 'el juego';
    const ok = await confirm({
      icon: '🔄',
      title: `Actualizar "${p.name}"`,
      message: `Reemplazar el contenido del perfil con el estado actual de ${gameLabel}.`,
      bullets: [
        'Reglas actuales del juego',
        'Entries del catálogo (entidades, items, eventos)',
        'Sonidos asignados al juego',
        'Boosts (multiplicadores) del juego',
      ],
      footnote:
        'Mantiene el nombre, descripción, portada y fecha de creación. ' +
        'Solo se actualiza el snapshot. NO crea un perfil nuevo.',
      variant: 'default',
      confirmLabel: 'Actualizar',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await profiles.update(p.id);
      flash(`✓ "${p.name}" actualizado.`);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  /** v1.0.94+: file picker → set-cover RPC. */
  async function handleChangeCover(p: ProfileSnapshot) {
    if (coverBusy) return;
    setCoverBusy(p.id);
    try {
      const picked = await window.maruApi.dialog.openFile({
        title: `Cambiar portada de "${p.name}"`,
        filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
      });
      if (!picked.ok || !picked.path) return;
      await profiles.setCover(p.id, picked.path);
      setCoverBust((b) => b + 1);
      flash(`✓ Portada actualizada en "${p.name}".`);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setCoverBusy(null);
    }
  }

  /** v1.0.94+: drag-drop file → resolver path nativo (preload) → set-cover. */
  async function handleDropCover(p: ProfileSnapshot, file: File) {
    if (coverBusy) return;
    if (!file.type.startsWith('image/')) {
      flash('✗ El archivo no es una imagen.', false);
      return;
    }
    setCoverBusy(p.id);
    try {
      const path = window.maruApi.getPathForFile?.(file);
      if (!path) {
        flash('✗ No se pudo resolver el path del archivo. Usá "Cambiar portada".', false);
        return;
      }
      await profiles.setCover(p.id, path);
      setCoverBust((b) => b + 1);
      flash(`✓ Portada actualizada en "${p.name}".`);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setCoverBusy(null);
    }
  }

  async function handleDeleteCover(p: ProfileSnapshot) {
    if (coverBusy) return;
    const ok = await confirm({
      icon: '🗑️',
      title: 'Quitar portada',
      message: `¿Quitar la portada custom de "${p.name}"?`,
      footnote: 'Volverá al fallback con emoji del juego. Podés subir otra cuando quieras.',
      variant: 'warning',
      confirmLabel: 'Quitar',
    });
    if (!ok) return;
    setCoverBusy(p.id);
    try {
      await profiles.deleteCover(p.id);
      setCoverBust((b) => b + 1);
      flash(`✓ Portada removida de "${p.name}".`);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setCoverBusy(null);
    }
  }

  async function handleDuplicate(p: ProfileSnapshot) {
    const name = window.prompt(
      `Nombre para la copia de "${p.name}":`,
      `${p.name} (copia)`,
    );
    if (!name) return;
    setBusy(true);
    try {
      await profiles.duplicate(p.id, name);
      flash('✓ Duplicado.');
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function handleRename() {
    if (!renamingId) return;
    const name = renameDraft.trim();
    if (!name) return;
    setBusy(true);
    try {
      await profiles.rename(renamingId, name);
      setRenamingId(null);
      setRenameDraft('');
      flash('✓ Renombrado.');
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(p: ProfileSnapshot) {
    const ok = await confirm({
      icon: '🗑️',
      title: `Eliminar "${p.name}"`,
      message: '¿Eliminar permanentemente este perfil?',
      footnote: 'Esta acción no se puede deshacer. La portada custom (si tiene) también se elimina.',
      variant: 'danger',
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await profiles.remove(p.id);
      flash(`✓ "${p.name}" eliminado.`);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(p: ProfileSnapshot) {
    setBusy(true);
    try {
      const json = await profiles.exportProfile(p.id);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${p.name.replace(/[^\w\s.-]/g, '_')}.lce_profile.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      flash('✓ Perfil exportado.');
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.lce_profile.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const txt = await file.text();
        const name =
          window.prompt('Nombre del perfil importado:', file.name.replace(/\.json$/, '')) ??
          undefined;
        await profiles.importProfile(txt, name);
        flash('✓ Perfil importado.');
      } catch (ex) {
        flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }

  return (
    <Dialog
      open
      onClose={() => !busy && closeModal()}
      size="lg"
      bodyFlush
      title="💾 Perfiles de Stream"
      description="Cada perfil guarda las reglas, entries del catálogo, sonidos y boosts de UN juego. Spotify, IA, voces, social y otros juegos NO se tocan."
    >
      {/* v1.0.85 — Toolbar con stats + acciones principales */}
      <div className="flex items-center gap-2 border-b border-border px-5 py-3 bg-bg-elev/30">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-accent" />
          <span className="text-xs font-semibold text-fg">{stats.total}</span>
          <span className="text-[11px] text-fg-muted">perfiles</span>
        </div>
        {stats.totalSize > 0 && (
          <>
            <span className="text-fg-subtle">·</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-fg">{formatBytes(stats.totalSize)}</span>
              <span className="text-[11px] text-fg-muted">total</span>
            </div>
          </>
        )}
        {Object.entries(stats.byGame).length > 1 && (
          <>
            <span className="text-fg-subtle">·</span>
            <div className="flex items-center gap-1 flex-wrap">
              {Object.entries(stats.byGame)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([gid, count]) => {
                  const icon = GAME_ICONS[gid] || '🎮';
                  return (
                    <span
                      key={gid}
                      title={`${count} perfil${count !== 1 ? 'es' : ''} para ${gid}`}
                      className="inline-flex items-center gap-1 text-[10.5px] text-fg-muted px-1.5 py-0.5 rounded-md bg-fg/[0.04] border border-border"
                    >
                      <span className="font-emoji">{icon}</span>
                      <span className="font-mono font-semibold">{count}</span>
                    </span>
                  );
                })}
            </div>
          </>
        )}
        <div className="flex-1" />
        <Button
          variant="glass"
          size="sm"
          onClick={() => void handleImport()}
          disabled={busy}
          title="Importar perfil desde archivo .lce_profile.json"
        >
          <Upload className="h-3.5 w-3.5" />
          Importar
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowSaveForm((v) => !v)}
          disabled={busy || !activeGameId}
          title={
            activeGameId
              ? `Guardar reglas actuales como perfil de ${activeGameName}`
              : 'Seleccioná un juego activo antes de guardar'
          }
        >
          <Save className="h-3.5 w-3.5" />
          Guardar {activeGameId ? `${GAME_ICONS[activeGameId] || '🎮'}` : 'actual'}
        </Button>
      </div>

      {/* v1.0.85 — Search + sort row + v1.0.86 toggle juego activo */}
      {profiles.profiles.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-5 py-2 bg-bg-elev/10">
          {/* v1.0.86: toggle "ver solo perfiles del juego activo" / "ver todos" */}
          {activeGameId && (
            <button
              type="button"
              onClick={() => setShowAllGames((v) => !v)}
              disabled={busy}
              className={[
                'inline-flex items-center gap-1.5 px-2 h-7 text-[11px] rounded-md border transition-colors',
                showAllGames
                  ? 'border-border bg-fg/[0.04] text-fg-muted hover:bg-fg/[0.08]'
                  : 'border-accent/40 bg-accent/15 text-fg ring-1 ring-accent/30',
              ].join(' ')}
              title={
                showAllGames
                  ? 'Mostrando perfiles de TODOS los juegos. Click para filtrar al activo.'
                  : `Mostrando solo perfiles de ${activeGameName}. Click para ver todos.`
              }
            >
              <span className="font-emoji text-[13px]">
                {GAME_ICONS[activeGameId] || '🎮'}
              </span>
              <span className="font-semibold">
                {showAllGames ? 'Todos' : activeGameName}
              </span>
            </button>
          )}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-fg-subtle pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre, descripción, juego…"
              className="pl-7 h-7 text-[11.5px]"
              disabled={busy}
            />
          </div>
          <ArrowUpDown className="h-3 w-3 text-fg-subtle shrink-0" />
          <Select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
            className="w-[160px] h-7 text-[11.5px]"
            disabled={busy}
          >
            <option value="newest">Más recientes primero</option>
            <option value="oldest">Más antiguos primero</option>
            <option value="name">Nombre A-Z</option>
            <option value="size">Más grandes primero</option>
          </Select>
        </div>
      )}

      {showSaveForm && (
        <div className="border-b border-border px-5 py-3 bg-bg-elev/20 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Nombre del perfil..."
              value={saveDraft.name}
              onChange={(e) =>
                setSaveDraft((d) => ({ ...d, name: e.target.value }))
              }
              autoFocus
            />
            <Input
              placeholder="Descripción opcional..."
              value={saveDraft.description}
              onChange={(e) =>
                setSaveDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSaveForm(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSave()}
              disabled={busy || !saveDraft.name.trim()}
            >
              💾 Guardar snapshot
            </Button>
          </div>
        </div>
      )}

      {/* v1.0.94+: el banner verde/rojo del header fue removido — ahora
          las notificaciones aparecen en bottom-right via toast singleton
          (más visible, no ocupa espacio del modal). */}

      {/* Cuerpo */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {profiles.status === 'loading' && profiles.profiles.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : profiles.status === 'error' ? (
          <Empty
            icon={Layers}
            title="No se pudieron cargar los perfiles"
            description={profiles.error ?? '—'}
            action={
              <Button size="sm" onClick={() => void profiles.refresh()}>
                Reintentar
              </Button>
            }
          />
        ) : profiles.profiles.length === 0 ? (
          <Empty
            icon={Layers}
            title="Sin perfiles todavía"
            description='Pulsá "Guardar actual" para crear el primero.'
          />
        ) : visible.length === 0 ? (
          <Empty
            icon={Search}
            title="Sin resultados"
            description='Probá con otro término de búsqueda.'
            action={
              <Button size="sm" variant="ghost" onClick={() => setSearchQuery('')}>
                Limpiar búsqueda
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {visible.map((p) => (
              <ProfileCard
                key={p.id}
                profile={p}
                isSelected={p.id === profiles.selectedId}
                isRenaming={p.id === renamingId}
                renameDraft={renameDraft}
                setRenameDraft={setRenameDraft}
                coverBust={coverBust}
                coverBusy={coverBusy === p.id}
                isDragOver={dragOverId === p.id}
                busy={busy}
                onSelect={() => profiles.setSelectedId(p.id)}
                onLoad={() => void handleLoad(p)}
                onUpdate={() => void handleUpdate(p)}
                onDuplicate={() => void handleDuplicate(p)}
                onStartRename={() => {
                  setRenamingId(p.id);
                  setRenameDraft(p.name);
                }}
                onConfirmRename={() => void handleRename()}
                onCancelRename={() => {
                  setRenamingId(null);
                  setRenameDraft('');
                }}
                onExport={() => void handleExport(p)}
                onDelete={() => void handleDelete(p)}
                onChangeCover={() => void handleChangeCover(p)}
                onDeleteCover={() => void handleDeleteCover(p)}
                onDragEnter={() => setDragOverId(p.id)}
                onDragLeaveCard={() => setDragOverId(null)}
                onDropFile={(file) => {
                  setDragOverId(null);
                  void handleDropCover(p, file);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <p className="text-[11px] text-fg-subtle">
          {selected
            ? `SHA256: ${selected.sha256.slice(0, 16)}…`
            : 'Tip: el load crea un backup automático antes de reemplazar.'}
        </p>
        <Button variant="ghost" size="sm" onClick={closeModal} disabled={busy}>
          Cerrar
        </Button>
      </footer>

      {/* v1.0.94+: el modal de confirmación viejo (pendingDelete) fue
          removido — ahora `handleDelete` usa `useConfirm()` que abre el
          ConfirmDialogHost global con design system unificado. */}

      {/* v1.0.94+: overlay full-modal cuando se carga un perfil. Tiene 2
          fases: 'loading' (spinner) y 'success' (✓ con bounce). Se muestra
          ENCIMA del contenido del Dialog principal con backdrop blur,
          bloqueando interacción durante ~1.6s. Mucho más explícito que el
          texto verde discreto del flash. */}
      {loadingOverlay && (
        <ProfileLoadOverlay
          profile={loadingOverlay.profile}
          phase={loadingOverlay.phase}
          coverBust={coverBust}
        />
      )}
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ProfileCard — card individual del grid (v1.0.94+)
// ──────────────────────────────────────────────────────────────────────────

interface ProfileCardProps {
  profile: ProfileSnapshot;
  isSelected: boolean;
  isRenaming: boolean;
  renameDraft: string;
  setRenameDraft: (s: string) => void;
  coverBust: number;
  coverBusy: boolean;
  isDragOver: boolean;
  busy: boolean;
  onSelect: () => void;
  onLoad: () => void;
  onUpdate: () => void;
  onDuplicate: () => void;
  onStartRename: () => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  onExport: () => void;
  onDelete: () => void;
  onChangeCover: () => void;
  onDeleteCover: () => void;
  onDragEnter: () => void;
  onDragLeaveCard: () => void;
  onDropFile: (file: File) => void;
}

function ProfileCard({
  profile: p,
  isSelected,
  isRenaming,
  renameDraft,
  setRenameDraft,
  coverBust,
  coverBusy,
  isDragOver,
  busy,
  onSelect,
  onLoad,
  onUpdate,
  onDuplicate,
  onStartRename,
  onConfirmRename,
  onCancelRename,
  onExport,
  onDelete,
  onChangeCover,
  onDeleteCover,
  onDragEnter,
  onDragLeaveCard,
  onDropFile,
}: ProfileCardProps) {
  const icon = (p.gameId && GAME_ICONS[p.gameId]) || '🎮';
  const dragCounter = useRef(0);

  function handleDragEnter(e: ReactDragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter.current += 1;
    if (dragCounter.current === 1) onDragEnter();
  }

  function handleDragOver(e: ReactDragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleDragLeave(e: ReactDragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) onDragLeaveCard();
  }

  function handleDrop(e: ReactDragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) onDropFile(file);
  }

  return (
    <article
      onClick={onSelect}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={[
        'group relative flex flex-col rounded-2xl border overflow-hidden',
        'transition-all cursor-pointer',
        isDragOver
          ? 'border-accent ring-2 ring-accent/60 scale-[1.01]'
          : isSelected
            ? 'border-accent ring-1 ring-accent/40 shadow-lg shadow-accent/10'
            : 'border-border bg-bg-elev/30 hover:border-fg-muted hover:shadow-md',
      ].join(' ')}
    >
      {/* COVER (16:9) — imagen custom o gradient + emoji fallback */}
      <div className="relative w-full aspect-[16/9] overflow-hidden bg-bg-base">
        {p.coverImage ? (
          <MaruImage
            key={`${p.coverImage}-${coverBust}`}
            scope="profile_covers"
            path={p.coverImage}
            size={320}
            className="!w-full !h-full !object-cover"
            fallback={icon}
          />
        ) : (
          // Fallback: gradient diagonal con un toque del color del juego.
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              background:
                'linear-gradient(135deg, rgb(var(--maru-accent) / 0.18), rgb(var(--maru-bg-elev) / 0.5))',
            }}
          >
            <span className="text-7xl font-emoji opacity-80 drop-shadow-lg">
              {icon}
            </span>
          </div>
        )}

        {/* Overlay gradient inferior para que el texto del badge se lea */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 via-black/30 to-transparent pointer-events-none" />

        {/* Badge per-game / legacy */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          {p.isPerGame ? (
            <span className="rounded-md bg-success/85 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-white shadow-md">
              per-game
            </span>
          ) : (
            <span className="rounded-md bg-warning/85 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-white shadow-md">
              legacy
            </span>
          )}
          {p.gameId && (
            <span
              className="rounded-md bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white/95 shadow-md inline-flex items-center gap-1"
              title={p.gameName ?? p.gameId}
            >
              <span className="font-emoji text-[12px]">{icon}</span>
              {p.gameName ?? p.gameId}
            </span>
          )}
        </div>

        {/* Acciones de cover (top-left) — change/remove */}
        <div
          className="absolute top-2 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onChangeCover}
            disabled={coverBusy || busy}
            className="rounded-md bg-black/65 backdrop-blur-sm hover:bg-black/85 px-2 py-1 text-[10px] text-white shadow-md inline-flex items-center gap-1.5 disabled:opacity-50"
            title={p.coverImage ? 'Cambiar portada' : 'Agregar portada'}
          >
            {coverBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : p.coverImage ? (
              <Camera className="h-3 w-3" />
            ) : (
              <ImageIcon className="h-3 w-3" />
            )}
            {p.coverImage ? 'Cambiar' : 'Portada'}
          </button>
          {p.coverImage && (
            <button
              type="button"
              onClick={onDeleteCover}
              disabled={coverBusy || busy}
              className="rounded-md bg-black/65 backdrop-blur-sm hover:bg-danger/85 px-1.5 py-1 text-white shadow-md disabled:opacity-50"
              title="Quitar portada"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Drop-zone hint cuando arrastrás un archivo */}
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-accent/30 border-2 border-dashed border-accent backdrop-blur-sm pointer-events-none">
            <div className="text-white text-sm font-bold drop-shadow-md">
              📥 Soltá la imagen para usar como portada
            </div>
          </div>
        )}

        {/* Indicador de carga del cover */}
        {coverBusy && !isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}
      </div>

      {/* INFO + ACCIONES */}
      <div className="flex flex-col gap-2 p-3">
        {/* Nombre + (rename) */}
        {isRenaming ? (
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirmRename();
                if (e.key === 'Escape') onCancelRename();
              }}
              autoFocus
              className="text-sm font-medium"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirmRename}
              disabled={busy || !renameDraft.trim()}
            >
              ✓
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelRename}
              disabled={busy}
            >
              ✕
            </Button>
          </div>
        ) : (
          <h3 className="text-sm font-bold leading-tight truncate" title={p.name}>
            {p.name}
          </h3>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 text-[11px] text-fg-subtle">
          <span title="Reglas habilitadas / total">
            🎯 <strong className="text-fg">{p.rulesEnabled ?? 0}</strong>
            <span className="text-fg-subtle">/{p.rulesCount ?? 0} reglas</span>
          </span>
          <span title="Tamaño en disco">
            💾 {formatBytes(p.sizeBytes ?? 0)}
          </span>
          <span title="Fecha de creación" className="ml-auto text-fg-muted">
            {formatDate(p.createdAt)}
          </span>
        </div>

        {/* Descripción opcional */}
        {p.description && (
          <p className="text-[11px] text-fg-muted italic line-clamp-2">
            {p.description}
          </p>
        )}

        {/* Acciones */}
        <div
          className="flex items-center gap-1 pt-1 border-t border-border/40"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="primary"
            size="sm"
            onClick={onLoad}
            disabled={busy}
            title="Cargar este perfil"
            className="flex-1"
          >
            <FileDown className="h-3 w-3" />
            Cargar
          </Button>
          {/* v1.0.95+: actualizar perfil con el estado actual sin
              crear duplicado. Solo aplica a per-game (legacy lo
              maneja con un toast.warn en el handler). */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onUpdate}
            disabled={busy || !p.isPerGame}
            title={
              p.isPerGame
                ? 'Actualizar este perfil con el estado actual del juego'
                : 'Los perfiles legacy no se pueden actualizar'
            }
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDuplicate} disabled={busy} title="Duplicar">
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onStartRename} disabled={busy} title="Renombrar">
            <Edit3 className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onExport} disabled={busy} title="Exportar JSON">
            <FileUp className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} disabled={busy} title="Eliminar">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </article>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ProfileLoadOverlay — feedback visual cuando se carga un perfil (v1.0.94+)
// ──────────────────────────────────────────────────────────────────────────

interface ProfileLoadOverlayProps {
  profile: ProfileSnapshot;
  phase: 'loading' | 'success';
  coverBust: number;
}

function ProfileLoadOverlay({ profile: p, phase, coverBust }: ProfileLoadOverlayProps) {
  const icon = (p.gameId && GAME_ICONS[p.gameId]) || '🎮';
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in"
      style={{ animation: 'mlo-fadein 200ms ease-out' }}
    >
      <style>{`
        @keyframes mlo-fadein {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes mlo-pop {
          0%   { transform: scale(0.5); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes mlo-pulse-ring {
          0%   { transform: scale(0.95); opacity: 0.7; }
          70%  { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1.4); opacity: 0; }
        }
      `}</style>

      <div className="flex flex-col items-center gap-5 text-white">
        {/* Cover grande con halo animado */}
        <div className="relative w-[260px] aspect-[16/9] rounded-2xl overflow-hidden shadow-2xl ring-2 ring-white/20">
          {/* Halo pulsing detrás (solo en loading) */}
          {phase === 'loading' && (
            <div
              className="absolute inset-0 rounded-2xl border-4 border-accent"
              style={{ animation: 'mlo-pulse-ring 1.4s ease-out infinite' }}
            />
          )}
          {p.coverImage ? (
            <MaruImage
              key={`${p.coverImage}-${coverBust}`}
              scope="profile_covers"
              path={p.coverImage}
              size={320}
              className="!w-full !h-full !object-cover"
              fallback={icon}
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                background:
                  'linear-gradient(135deg, rgb(var(--maru-accent) / 0.5), rgb(var(--maru-bg-elev) / 0.8))',
              }}
            >
              <span className="text-8xl font-emoji drop-shadow-2xl">{icon}</span>
            </div>
          )}
          {/* Status icon overlay (centro) */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            {phase === 'loading' ? (
              <Loader2 className="h-16 w-16 animate-spin text-white drop-shadow-2xl" />
            ) : (
              <CheckCircle2
                className="h-20 w-20 text-success drop-shadow-2xl"
                style={{ animation: 'mlo-pop 500ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
              />
            )}
          </div>
        </div>

        {/* Texto explícito */}
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/60 font-semibold">
            {phase === 'loading' ? 'Cargando perfil' : '✓ Perfil cargado'}
          </p>
          <h2 className="mt-1 text-2xl font-bold drop-shadow-lg">{p.name}</h2>
          <p className="mt-1 text-xs text-white/70">
            {p.gameName ?? p.gameId ?? '—'}
            {' · '}
            {p.rulesEnabled ?? 0}/{p.rulesCount ?? 0} reglas
          </p>
        </div>
      </div>
    </div>
  );
}
