import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button, Dialog } from '@maru/ui';
import type { SocialConfig } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useSocial } from '../../../lib/use-social.js';
import { CommandsTab } from './CommandsTab.js';
import { GeneralTab } from './GeneralTab.js';
import { StatsTab } from './StatsTab.js';
import { TapsTab } from './TapsTab.js';
import { UsersTab } from './UsersTab.js';

/**
 * `SocialConfigDialog` (G7) — réplica del `social_config.py` (2464 líneas).
 *
 * Tabs visibles:
 *   ⚙️ General · 📜 Comandos · 👥 Usuarios · ❤️ Taps · 📊 Estadísticas
 *
 * (Spotify e IA tienen sus propios diálogos — se portan en G8/G14.)
 *
 * Mejoras vs MARU original:
 *   - Tabs en vez de sub-windows: cambio instantáneo sin re-cargar.
 *   - Save aplica patch incremental + recarga config para asegurar
 *     consistencia.
 *   - Status indicator si hubo error al guardar (en vez de QMessageBox).
 */
type Tab = 'general' | 'commands' | 'users' | 'taps' | 'stats';

const TAB_META: { id: Tab; label: string; emoji: string }[] = [
  { id: 'general', label: 'General', emoji: '⚙️' },
  { id: 'commands', label: 'Comandos', emoji: '📜' },
  { id: 'users', label: 'Usuarios', emoji: '👥' },
  { id: 'taps', label: 'Taps', emoji: '❤️' },
  { id: 'stats', label: 'Estadísticas', emoji: '📊' },
];

export function SocialConfigDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'social-config'));
  const closeModal = useAppStore((s) => s.closeModal);

  const social = useSocial({ autoLoad: open });

  const [tab, setTab] = useState<Tab>('general');
  const [draft, setDraft] = useState<SocialConfig>(social.config);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sincronizar draft cuando se carga / re-carga la config.
  useEffect(() => {
    setDraft(social.config);
  }, [social.config]);

  // Reset al cerrar.
  useEffect(() => {
    if (!open) {
      setTab('general');
      setSaveError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  function patchDraft(p: Partial<SocialConfig>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(social.config);

  async function handleSave() {
    setBusy(true);
    setSaveError(null);
    try {
      await social.saveConfig(draft);
      closeModal();
    } catch (ex) {
      setSaveError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => !busy && closeModal()}
      size="xl"
      bodyFlush
      title="💬 Sistema Social"
      description="Configurá comandos, usuarios, racha automática, taps y estadísticas globales."
    >
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Secciones del sistema social"
        className="flex border-b border-border bg-bg-elev/30 overflow-x-auto"
      >
        {TAB_META.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={[
                'px-4 py-2.5 text-xs font-medium uppercase tracking-wider whitespace-nowrap',
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

      {/* Cuerpo */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {tab === 'general' && (
          <GeneralTab config={draft} patch={patchDraft} disabled={busy} />
        )}
        {tab === 'commands' && (
          <CommandsTab
            config={draft}
            meta={social.commandsMeta}
            patch={patchDraft}
            disabled={busy}
          />
        )}
        {tab === 'users' && (
          <UsersTab
            users={social.users}
            visibleUsers={social.visibleUsers}
            status={social.usersStatus}
            error={social.usersError}
            search={social.search}
            selectedUsername={social.selectedUsername}
            selectedUser={social.selectedUser}
            onSearchChange={social.setSearch}
            onSelect={social.setSelectedUsername}
            onRefresh={() => void social.loadUsers()}
            onRegister={social.registerUser}
            onUnregister={social.unregisterUser}
            onDelete={social.deleteUser}
            onSetRacha={social.setRacha}
            onResetRacha={social.resetRacha}
            onResetRelaciones={social.resetRelaciones}
            onRemoveMarriage={social.removeMarriage}
            onRemoveRelationship={social.removeRelationship}
            onActivateAutoRacha={social.activateAutoRacha}
            onDeactivateAutoRacha={social.deactivateAutoRacha}
            busy={busy}
          />
        )}
        {tab === 'taps' && (
          <TapsTab
            period={social.tapsPeriod}
            totalTaps={social.tapsTotal}
            totalUsers={social.tapsRanking.length}
            ranking={social.tapsRanking}
            onPeriodChange={(p) => void social.loadTaps(p)}
            onCleanup={social.cleanupTaps}
            onRefresh={() => void social.loadTaps(social.tapsPeriod)}
            busy={busy}
          />
        )}
        {tab === 'stats' && (
          <StatsTab
            stats={social.stats}
            onRefresh={() => void social.loadStats()}
            onResetAll={social.resetAll}
            busy={busy}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <div className="text-xs text-fg-subtle">
          {saveError && (
            <span className="text-danger">⚠ {saveError}</span>
          )}
          {!saveError && dirty && (
            <span className="text-warning">● Cambios sin guardar</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={closeModal} disabled={busy}>
            Cerrar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={busy || !dirty}
          >
            <Save className="h-3.5 w-3.5" />
            Guardar Configuración
          </Button>
        </div>
      </footer>
    </Dialog>
  );
}
