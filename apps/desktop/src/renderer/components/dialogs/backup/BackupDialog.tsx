import { useMemo, useState } from 'react';
import {
  Database,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  ArrowUpDown,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Input,
  Select,
  Spinner,
} from '@maru/ui';
import type {
  BackupEntry,
  BackupReason,
  BackupScope,
} from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useBackups } from '../../../lib/use-backups.js';

/**
 * `BackupDialog` (G12) — réplica de `backup_dialog.py`.
 *
 * Lista de cards (icon por reason + display + reason badge + sub: archivos
 * + age) + botones Crear/Restaurar/Eliminar. Restore con confirm que
 * advierte de reinicio + auto-pre-backup (defensa en profundidad).
 *
 * Mejoras vs MARU original:
 *   - Filtro por scope (rules/data/social/config/full).
 *   - Footer muestra `lastBackup` con su reason.
 *   - Confirm de restore con info del pre-backup creado.
 *   - Sort por createdAt desc.
 *   - Badge de tamaño humanizado.
 */

const REASON_META: Record<
  BackupReason,
  { display: string; emoji: string; variant: 'default' | 'success' | 'info' | 'warning' | 'accent' | 'danger' }
> = {
  manual: { display: 'Manual', emoji: '💾', variant: 'success' },
  pre_load: { display: 'Pre-load perfil', emoji: '📂', variant: 'info' },
  prerestore: { display: 'Pre-restore', emoji: '🛡️', variant: 'warning' },
  pre_import: { display: 'Pre-import', emoji: '📥', variant: 'accent' },
  auto: { display: 'Auto pre-edit', emoji: '⚙️', variant: 'default' },
};

const SCOPE_LABEL: Record<BackupScope, { emoji: string; label: string }> = {
  full: { emoji: '🗂️', label: 'Todo' },
  rules: { emoji: '📋', label: 'Reglas' },
  data: { emoji: '📦', label: 'Datos' },
  social: { emoji: '🤝', label: 'Social' },
  config: { emoji: '⚙️', label: 'Config' },
};

function reasonMeta(r: string | undefined): {
  display: string;
  emoji: string;
  variant: 'default' | 'success' | 'info' | 'warning' | 'accent' | 'danger';
} {
  if (!r) {
    const m = REASON_META.manual;
    if (!m) return { display: 'Manual', emoji: '💾', variant: 'success' };
    return m;
  }
  const known = REASON_META[r as BackupReason];
  if (known) return known;
  return { display: r, emoji: '📦', variant: 'default' };
}

function scopeMeta(s: BackupScope): { emoji: string; label: string } {
  const m = SCOPE_LABEL[s];
  if (!m) return { emoji: '🗂️', label: s };
  return m;
}

function fmtSize(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtAge(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) return 'hace segundos';
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

export function BackupDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'backup'));
  const closeModal = useAppStore((s) => s.closeModal);

  const bk = useBackups({ autoLoad: open });
  const [busy, setBusy] = useState(false);
  const [opMessage, setOpMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupEntry | null>(null);
  const [pendingRestore, setPendingRestore] = useState<BackupEntry | null>(null);
  const [createScope, setCreateScope] = useState<BackupScope>('full');
  // v1.0.85: search + sort UI mejoras
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'newest' | 'oldest' | 'largest' | 'smallest'>('newest');

  // Stats agregados sobre TODOS los backups (no filtrados — info global).
  const stats = useMemo(() => {
    const total = bk.backups.length;
    const totalSize = bk.backups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);
    const byScope: Record<string, number> = {};
    for (const b of bk.backups) {
      byScope[b.scope] = (byScope[b.scope] || 0) + 1;
    }
    return { total, totalSize, byScope };
  }, [bk.backups]);

  // Aplicar search + sort sobre la visible (que ya viene filtrada por scope).
  const filteredAndSorted = useMemo(() => {
    let out = bk.visible;
    // Search por texto (id, label, reason, scope)
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter((b) => {
        const haystack = [
          b.id,
          b.label || '',
          b.reason || '',
          b.scope,
          new Date(b.createdAt).toLocaleString().toLowerCase(),
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    // Sort
    out = out.slice().sort((a, b) => {
      switch (sortMode) {
        case 'newest': return b.createdAt - a.createdAt;
        case 'oldest': return a.createdAt - b.createdAt;
        case 'largest': return (b.sizeBytes || 0) - (a.sizeBytes || 0);
        case 'smallest': return (a.sizeBytes || 0) - (b.sizeBytes || 0);
      }
    });
    return out;
  }, [bk.visible, searchQuery, sortMode]);

  if (!open) return null;

  function flash(text: string, ok = true) {
    setOpMessage({ ok, text });
    window.setTimeout(() => setOpMessage(null), 4000);
  }

  async function handleCreate() {
    setBusy(true);
    try {
      const b = await bk.create(createScope, undefined, 'manual');
      flash(
        `✓ Backup ${scopeMeta(createScope).label} creado · ${b.filesCount ?? '?'} archivos · ${fmtSize(b.sizeBytes)}.`,
      );
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!pendingRestore) return;
    setBusy(true);
    try {
      const res = await bk.restore(pendingRestore.id, true);
      const preNote = res.preBackup
        ? ` (pre-backup creado: ${res.preBackup.id.slice(0, 16)}…)`
        : '';
      flash(
        `✓ Restaurado scope ${res.restoredScope}.${preNote} ⚠ Reinicia la app para que los cambios surtan efecto.`,
      );
      setPendingRestore(null);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await bk.remove(pendingDelete.id);
      flash(`✓ Backup ${pendingDelete.id.slice(0, 16)}… eliminado.`);
      setPendingDelete(null);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`, false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => !busy && closeModal()}
      size="lg"
      bodyFlush
      title="🔄 Gestor de Respaldos"
      description={`${bk.backups.length} respaldos · max 7 por scope (rotación FIFO).`}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 bg-bg-elev/30">
        <span className="text-xs text-fg-muted">Filtrar scope:</span>
        <Select
          value={bk.scopeFilter}
          onChange={(e) =>
            bk.setScopeFilter(e.target.value as BackupScope | 'all')
          }
          className="w-[160px]"
          disabled={busy}
        >
          <option value="all">🗂️ Todos</option>
          {Object.entries(SCOPE_LABEL).map(([s, m]) => (
            <option key={s} value={s}>
              {m.emoji} {m.label}
            </option>
          ))}
        </Select>

        <span className="text-xs text-fg-muted ml-auto">Crear backup:</span>
        <Select
          value={createScope}
          onChange={(e) => setCreateScope(e.target.value as BackupScope)}
          className="w-[160px]"
          disabled={busy}
        >
          {Object.entries(SCOPE_LABEL).map(([s, m]) => (
            <option key={s} value={s}>
              {m.emoji} {m.label}
            </option>
          ))}
        </Select>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleCreate()}
          disabled={busy}
        >
          <Save className="h-3.5 w-3.5" />
          Crear
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void bk.refresh()}
          disabled={busy}
          title="Refrescar lista"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* v1.0.85 — Stats summary panel: muestra el total + breakdown por scope.
          Reemplaza el banner explicativo viejo, da info útil de un vistazo. */}
      <div className="px-5 py-2.5 border-b border-border bg-bg-elev/20 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-accent" />
          <span className="text-xs font-semibold text-fg">{stats.total}</span>
          <span className="text-[11px] text-fg-muted">respaldos</span>
        </div>
        <span className="text-fg-subtle">·</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-fg">{fmtSize(stats.totalSize)}</span>
          <span className="text-[11px] text-fg-muted">total</span>
        </div>
        {Object.entries(stats.byScope).length > 0 && (
          <>
            <span className="text-fg-subtle">·</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(Object.entries(stats.byScope) as Array<[BackupScope, number]>)
                .sort(([, a], [, b]) => b - a)
                .map(([scope, count]) => {
                  const m = scopeMeta(scope);
                  return (
                    <span
                      key={scope}
                      title={`${count} backup${count !== 1 ? 's' : ''} de ${m.label}`}
                      className="inline-flex items-center gap-1 text-[10.5px] text-fg-muted px-1.5 py-0.5 rounded-md bg-fg/[0.04] border border-border"
                    >
                      <span className="font-emoji">{m.emoji}</span>
                      <span className="font-mono font-semibold">{count}</span>
                    </span>
                  );
                })}
            </div>
          </>
        )}
        <span className="ml-auto text-[10px] text-fg-subtle">
          rotación FIFO max 7 por scope · auto-pre-backup en restore
        </span>
      </div>

      {/* v1.0.85 — Search + sort row (mejora UX cuando hay muchos backups) */}
      <div className="flex items-center gap-2 border-b border-border px-5 py-2 bg-bg-elev/10">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-fg-subtle pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por id, label, fecha…"
            className="pl-7 h-7 text-[11.5px]"
            disabled={busy}
          />
        </div>
        <ArrowUpDown className="h-3 w-3 text-fg-subtle shrink-0" />
        <Select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
          className="w-[140px] h-7 text-[11.5px]"
          disabled={busy}
        >
          <option value="newest">Más recientes primero</option>
          <option value="oldest">Más antiguos primero</option>
          <option value="largest">Más grandes primero</option>
          <option value="smallest">Más chicos primero</option>
        </Select>
      </div>

      {opMessage && (
        <div
          className={
            'px-5 py-2 text-xs border-b border-border ' +
            (opMessage.ok
              ? 'bg-success/10 text-success'
              : 'bg-danger/10 text-danger')
          }
        >
          {opMessage.text}
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {bk.status === 'loading' && bk.backups.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : bk.status === 'error' ? (
          <Empty
            icon={Database}
            title="No se pudieron cargar los respaldos"
            description={bk.error ?? '—'}
            action={
              <Button size="sm" onClick={() => void bk.refresh()}>
                Reintentar
              </Button>
            }
          />
        ) : filteredAndSorted.length === 0 ? (
          <Empty
            icon={Database}
            title={searchQuery ? 'Sin resultados de búsqueda' : 'No hay respaldos todavía'}
            description={
              searchQuery
                ? 'Probá con otro término o limpiá el filtro de scope.'
                : 'Pulsá "Crear" arriba para hacer el primero.'
            }
            action={
              searchQuery ? (
                <Button size="sm" variant="ghost" onClick={() => setSearchQuery('')}>
                  Limpiar búsqueda
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="space-y-2">
            {filteredAndSorted.map((b) => {
              const isSelected = b.id === bk.selectedId;
              const reason = reasonMeta(b.reason);
              const scope = scopeMeta(b.scope);
              return (
                <li
                  key={b.id}
                  onClick={() => bk.setSelectedId(b.id)}
                  className={[
                    'flex items-center gap-3 rounded-xl border p-3 transition-all cursor-pointer',
                    isSelected
                      ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                      : 'border-border bg-bg-elev/40 hover:border-fg-muted',
                  ].join(' ')}
                >
                  <span className="text-2xl font-emoji shrink-0" title={reason.display}>
                    {reason.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold">
                        {fmtDateTime(b.createdAt)}
                      </p>
                      <Badge variant={reason.variant}>{reason.display}</Badge>
                      <Badge variant="default">
                        {scope.emoji} {scope.label}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-fg-subtle mt-0.5">
                      {b.filesCount ?? '?'} archivos · {fmtSize(b.sizeBytes)} ·{' '}
                      {fmtAge(b.createdAt)}
                      {b.label ? ` · ${b.label}` : ''}
                    </p>
                    {b.sha256 && (
                      <p className="text-[10px] text-fg-subtle font-mono truncate mt-0.5">
                        sha256: {b.sha256.slice(0, 24)}…
                      </p>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setPendingRestore(b)}
                      disabled={busy}
                      title="Restaurar este backup"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      Restaurar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(b)}
                      disabled={busy}
                      title="Eliminar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer con last info */}
      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <p className="text-[11px] text-fg-subtle truncate">
          {bk.lastBackup ? (
            <>
              Último: <strong>{reasonMeta(bk.lastBackup.reason).display}</strong>{' '}
              · {scopeMeta(bk.lastBackup.scope).label} ·{' '}
              {fmtAge(bk.lastBackup.createdAt)}
            </>
          ) : (
            'Sin respaldos todavía.'
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={closeModal} disabled={busy}>
          Cerrar
        </Button>
      </footer>

      {/* Confirm restore */}
      {pendingRestore && (
        <Dialog
          open
          onClose={() => !busy && setPendingRestore(null)}
          size="sm"
          title="🛡️ Restaurar backup"
        >
          <div className="space-y-3 text-sm">
            <p>
              ¿Restaurar el backup del{' '}
              <strong>{fmtDateTime(pendingRestore.createdAt)}</strong>?
            </p>
            <ul className="text-xs text-fg-muted space-y-1 list-disc pl-5">
              <li>
                Scope:{' '}
                <strong>{scopeMeta(pendingRestore.scope).label}</strong> (
                {pendingRestore.filesCount ?? '?'} archivos)
              </li>
              <li>Se sobrescribirá tu configuración actual.</li>
              <li>
                Se creará un{' '}
                <strong>backup automático (prerestore)</strong> antes de
                aplicar (defensa en profundidad).
              </li>
            </ul>
            <p className="text-xs text-warning">
              ⚠ Reinicia la app después para que algunos cambios surtan
              efecto (ej: TTS engine, IA config).
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingRestore(null)}
                disabled={busy}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void confirmRestore()}
                disabled={busy}
              >
                {busy ? 'Restaurando…' : 'Sí, restaurar'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Confirm delete */}
      {pendingDelete && (
        <Dialog
          open
          onClose={() => !busy && setPendingDelete(null)}
          size="sm"
          title="🗑️ Eliminar backup"
        >
          <div className="space-y-3 text-sm">
            <p>
              ¿Eliminar permanentemente el backup del{' '}
              <strong>{fmtDateTime(pendingDelete.createdAt)}</strong>?
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
                onClick={() => void confirmDelete()}
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
