import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button, Dialog } from '@maru/ui';
import type { TtsConfig } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useTts } from '../../../lib/use-tts.js';
import { TtsConfigPanel } from './TtsConfigPanel.js';
import { UserVoicesList } from './UserVoicesList.js';

/**
 * `VoicesDialog` (G9) — réplica del `voices_dialog.py` MARU + bonus.
 *
 * Original: solo gestionaba `user_voices` (asignaciones @user → voz).
 *
 * G9 amplía: incluye TtsConfigPanel arriba con el config global TTS
 * (master enable, canales chat/social/fortune, volúmenes, default
 * voice, voice_mode global/perfil, clear cache). Antes el config TTS
 * estaba disperso en sidebar + social_config.
 *
 * Footer Save aplica config; las user_voices ya se persisten al añadir/
 * editar/quitar.
 */
type Tab = 'config' | 'users';

const TAB_META: { id: Tab; label: string; emoji: string }[] = [
  { id: 'config', label: 'Configuración', emoji: '⚙️' },
  { id: 'users', label: 'Voces por usuario', emoji: '🎤' },
];

export function VoicesDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'voices'));
  const closeModal = useAppStore((s) => s.closeModal);

  const tts = useTts({ autoLoad: open });

  const [tab, setTab] = useState<Tab>('users');
  const [draftConfig, setDraftConfig] = useState<TtsConfig>(tts.config);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraftConfig(tts.config);
  }, [tts.config]);

  useEffect(() => {
    if (!open) {
      setTab('users');
      setBusy(false);
      setSaveError(null);
    }
  }, [open]);

  if (!open) return null;

  function patchDraft(p: Partial<TtsConfig>) {
    setDraftConfig((d) => ({ ...d, ...p }));
  }

  const dirty =
    JSON.stringify(draftConfig) !== JSON.stringify(tts.config);

  async function handleSave() {
    if (!dirty) {
      closeModal();
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      await tts.saveConfig(draftConfig);
      closeModal();
    } catch (ex) {
      setSaveError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignTest(username: string, voice: string) {
    return tts.test({ username, voice });
  }

  return (
    <Dialog
      open
      onClose={() => !busy && closeModal()}
      size="lg"
      bodyFlush
      title="🎤 Voces por Usuario + Configuración TTS"
      description={`${tts.voices.length} voces disponibles · ${tts.userVoices.length} usuarios con voz custom`}
    >
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Secciones de voces"
        className="flex border-b border-border bg-bg-elev/30"
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
        {tab === 'config' && (
          <TtsConfigPanel
            config={draftConfig}
            voices={tts.voices}
            families={tts.families}
            patch={patchDraft}
            onClearCache={tts.clearCache}
            disabled={busy}
          />
        )}
        {tab === 'users' && (
          <UserVoicesList
            userVoices={tts.userVoices}
            voices={tts.voices}
            families={tts.families}
            defaultVoice={draftConfig.default_voice}
            onAssign={tts.assignUserVoice}
            onRemove={tts.removeUserVoice}
            onTest={handleAssignTest}
            onClearAll={tts.clearAllUserVoices}
            busy={busy}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <div className="text-xs">
          {saveError && <span className="text-danger">⚠ {saveError}</span>}
          {!saveError && dirty && (
            <span className="text-warning">● Cambios sin guardar</span>
          )}
          {!saveError && !dirty && (
            <span className="text-fg-subtle">
              Las voces por usuario se guardan al añadir/editar.
            </span>
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
            title={dirty ? 'Guardar config TTS' : 'Sin cambios'}
          >
            <Save className="h-3.5 w-3.5" />
            Guardar config
          </Button>
        </div>
      </footer>
    </Dialog>
  );
}
