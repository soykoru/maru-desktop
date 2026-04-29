import { useState } from 'react';
import {
  Copy,
  Download,
  Edit3,
  FileDown,
  FileUp,
  Layers,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button, Dialog, Empty, Input, Spinner } from '@maru/ui';
import type { ProfileSnapshot } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useProfiles } from '../../../lib/use-profiles.js';

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

  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [opMessage, setOpMessage] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ProfileSnapshot | null>(
    null,
  );
  const [saveDraft, setSaveDraft] = useState({ name: '', description: '' });
  const [showSaveForm, setShowSaveForm] = useState(false);

  if (!open) return null;

  const selected = profiles.profiles.find(
    (p) => p.id === profiles.selectedId,
  );

  function flash(msg: string, ok = true) {
    if (ok) setOpMessage(msg);
    else setOpError(msg);
    window.setTimeout(() => {
      setOpMessage(null);
      setOpError(null);
    }, 3000);
  }

  async function handleSave() {
    const name = saveDraft.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      await profiles.save(name, saveDraft.description.trim() || undefined);
      setSaveDraft({ name: '', description: '' });
      setShowSaveForm(false);
      flash(`✓ Perfil "${name}" guardado.`);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(p: ProfileSnapshot) {
    if (
      !confirm(
        `¿Cargar el perfil "${p.name}"?\n\n` +
          `Esto reemplazará:\n` +
          `· Juego activo: ${p.gameName ?? p.gameId ?? '?'}\n` +
          `· ${p.rulesCount ?? 0} reglas\n` +
          `· ${p.giftsCount ?? 0} regalos\n` +
          `· Sonidos, voces, IA y datos sociales\n\n` +
          `Se creará un backup automático antes de cargar.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await profiles.load(p.id);
      flash(`✓ Perfil "${p.name}" cargado. La app refleja el nuevo estado.`);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
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

  async function handleDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await profiles.remove(pendingDelete.id);
      flash(`✓ "${pendingDelete.name}" eliminado.`);
      setPendingDelete(null);
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
      description="Snapshots completos del estado: juego, reglas, gifts, sonidos, voces, IA, social."
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-5 py-3 bg-bg-elev/30">
        <p className="text-xs text-fg-muted flex-1">
          {profiles.profiles.length} perfiles guardados
        </p>
        <Button
          variant="secondary"
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
          disabled={busy}
        >
          <Save className="h-3.5 w-3.5" />
          Guardar actual
        </Button>
      </div>

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

      {(opMessage || opError) && (
        <div
          className={
            'px-5 py-2 text-xs border-b border-border ' +
            (opError
              ? 'bg-danger/10 text-danger'
              : 'bg-success/10 text-success')
          }
        >
          {opError || opMessage}
        </div>
      )}

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
        ) : (
          <ul className="space-y-2">
            {profiles.profiles.map((p) => {
              const icon = (p.gameId && GAME_ICONS[p.gameId]) || '🎮';
              const isSelected = p.id === profiles.selectedId;
              const isRenaming = p.id === renamingId;
              return (
                <li
                  key={p.id}
                  className={[
                    'flex items-center gap-3 rounded-xl border p-3 transition-all cursor-pointer',
                    isSelected
                      ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                      : 'border-border bg-bg-elev/40 hover:border-fg-muted',
                  ].join(' ')}
                  onClick={() => profiles.setSelectedId(p.id)}
                >
                  <span className="text-3xl font-emoji shrink-0" title={p.gameId ?? '?'}>
                    {icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <Input
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename();
                          if (e.key === 'Escape') {
                            setRenamingId(null);
                            setRenameDraft('');
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="text-sm font-medium"
                      />
                    ) : (
                      <p className="text-sm font-semibold truncate">{p.name}</p>
                    )}
                    <p className="text-[11px] text-fg-subtle truncate">
                      {p.gameName ?? p.gameId ?? 'Sin juego'}
                      {' · '}
                      {p.rulesEnabled ?? 0}/{p.rulesCount ?? 0} reglas
                      {' · '}
                      {p.giftsCount ?? 0} regalos
                      {p.customGamesCount ? ` · ${p.customGamesCount} custom` : ''}
                    </p>
                    {p.description && (
                      <p className="text-[10px] text-fg-muted italic mt-0.5 truncate">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[10px] text-fg-subtle font-mono shrink-0">
                    <p>{formatDate(p.createdAt)}</p>
                    <p>{formatBytes(p.sizeBytes ?? 0)}</p>
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isRenaming ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => void handleRename()}
                          disabled={busy || !renameDraft.trim()}
                        >
                          ✓
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRenamingId(null);
                            setRenameDraft('');
                          }}
                          disabled={busy}
                        >
                          ✕
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => void handleLoad(p)}
                          disabled={busy}
                          title="Cargar este perfil"
                        >
                          <FileDown className="h-3 w-3" />
                          Cargar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDuplicate(p)}
                          disabled={busy}
                          title="Duplicar"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRenamingId(p.id);
                            setRenameDraft(p.name);
                          }}
                          disabled={busy}
                          title="Renombrar"
                        >
                          <Edit3 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleExport(p)}
                          disabled={busy}
                          title="Exportar JSON"
                        >
                          <FileUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete(p)}
                          disabled={busy}
                          title="Eliminar"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
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

      {pendingDelete && (
        <Dialog
          open
          onClose={() => !busy && setPendingDelete(null)}
          size="sm"
          title="🗑️ Eliminar perfil"
        >
          <div className="space-y-3 text-sm">
            <p>
              ¿Eliminar permanentemente el perfil{' '}
              <strong>{pendingDelete.name}</strong>?
            </p>
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
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                Eliminar
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
