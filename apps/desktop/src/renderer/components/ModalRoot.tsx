import { lazy, Suspense, type ReactNode } from 'react';
import { Dialog, Button } from '@maru/ui';
import type { DataEntry, DonationGift, GameId } from '@maru/shared';
import { useAppStore } from '../lib/store/index.js';
import type { MultiSelection } from './dialogs/data/index.js';

// ── Lazy imports — cada dialog vive en su propio chunk JS ─────────────
// El bundle inicial NO incluye estos dialogs. Solo se descargan cuando
// el user los abre por primera vez. Ahorro estimado en boot: ~150-250KB
// de JS parseado + ~20-40 MB de RAM en el renderer.
//
// Suspense fallback: una versión mínima del Dialog con spinner — el
// usuario nota un flash de ~50-150ms la primera vez que abre cada dialog
// y luego es instantáneo (chunk en cache).
const GiftsDialog = lazy(() =>
  import('./dialogs/gifts/index.js').then((m) => ({ default: m.GiftsDialog })),
);
const GiftSelectorDialog = lazy(() =>
  import('./dialogs/gifts/index.js').then((m) => ({ default: m.GiftSelectorDialog })),
);
const CustomGameDialog = lazy(() =>
  import('./dialogs/games/index.js').then((m) => ({ default: m.CustomGameDialog })),
);
const EditPredefinedDialog = lazy(() =>
  import('./dialogs/games/index.js').then((m) => ({ default: m.EditPredefinedDialog })),
);
const ManageGamesDialog = lazy(() =>
  import('./dialogs/games/index.js').then((m) => ({ default: m.ManageGamesDialog })),
);
const NewProfileDialog = lazy(() =>
  import('./dialogs/games/index.js').then((m) => ({ default: m.NewProfileDialog })),
);
const DataDialog = lazy(() =>
  import('./dialogs/data/index.js').then((m) => ({ default: m.DataDialog })),
);
const EntitySelectorDialog = lazy(() =>
  import('./dialogs/data/index.js').then((m) => ({ default: m.EntitySelectorDialog })),
);
const BackupDialog = lazy(() =>
  import('./dialogs/backup/BackupDialog.js').then((m) => ({ default: m.BackupDialog })),
);
const IaConfigDialog = lazy(() =>
  import('./dialogs/ia/IaConfigDialog.js').then((m) => ({ default: m.IaConfigDialog })),
);
const SpotifyConfigDialog = lazy(() =>
  import('./dialogs/spotify/SpotifyConfigDialog.js').then((m) => ({ default: m.SpotifyConfigDialog })),
);
const MinigamesDialog = lazy(() =>
  import('./dialogs/minigames/MinigamesDialog.js').then((m) => ({ default: m.MinigamesDialog })),
);
const StreamProfilesDialog = lazy(() =>
  import('./dialogs/profiles/StreamProfilesDialog.js').then((m) => ({ default: m.StreamProfilesDialog })),
);
const EmotesDialog = lazy(() =>
  import('./dialogs/emotes/EmotesDialog.js').then((m) => ({ default: m.EmotesDialog })),
);
const TikTokSignKeyDialog = lazy(() =>
  import('./dialogs/tiktok/TikTokSignKeyDialog.js').then((m) => ({ default: m.TikTokSignKeyDialog })),
);
const RuleDialog = lazy(() =>
  import('./dialogs/rules/RuleDialog.js').then((m) => ({ default: m.RuleDialog })),
);
const SimulatorDialog = lazy(() =>
  import('./dialogs/simulator/SimulatorDialog.js').then((m) => ({ default: m.SimulatorDialog })),
);
const SocialConfigDialog = lazy(() =>
  import('./dialogs/social/SocialConfigDialog.js').then((m) => ({ default: m.SocialConfigDialog })),
);
const SoundsDialog = lazy(() =>
  import('./dialogs/sounds/SoundsDialog.js').then((m) => ({ default: m.SoundsDialog })),
);
const VoicesDialog = lazy(() =>
  import('./dialogs/tts/VoicesDialog.js').then((m) => ({ default: m.VoicesDialog })),
);

// Fallback discreto mientras se descarga el chunk del dialog.
function DialogLoader(): ReactNode {
  return (
    <div className="fixed inset-0 z-[5001] flex items-center justify-center pointer-events-none">
      <div className="rounded-xl bg-bg-surface/90 px-4 py-3 text-xs text-fg-muted shadow-lg">
        Cargando…
      </div>
    </div>
  );
}

/**
 * ModalRoot — stack global de modales (single open at a time).
 *
 * En MARU original cada botón del sidebar abre un `QDialog` modal:
 *   "Probar" / "Config" / "Añadir Juego" / "🎁 Regalos" / etc.
 *
 * Replicamos el patrón con un único `<Dialog>` cuyo contenido cambia
 * según `useAppStore.activeModal`. Las fases G3-G13 van llenando los
 * `case` con los componentes reales (`<GiftsDialog>`, `<RuleDialog>`,
 * `<SocialConfigDialog>`, etc.).
 *
 * En G1 todos los modales muestran un placeholder con la fase G donde
 * llegará la versión real, para que el usuario vea que el wiring está
 * en su lugar.
 */
function renderModalFrame(
  frame: { id: string; payload: unknown },
  closeModal: () => void,
): ReactNode {
  const { id, payload } = frame;
  switch (id) {
    case 'gifts':
      return <GiftsDialog key={id} />;
    case 'manage-games':
      return <ManageGamesDialog key={id} />;
    case 'edit-predefined': {
      const gid = (payload as { gameId?: GameId } | null)?.gameId ?? '';
      return (
        <EditPredefinedDialog
          key={id}
          open
          gameId={gid}
          onClose={closeModal}
        />
      );
    }
    case 'custom-game': {
      const gid = (payload as { gameId?: GameId } | null)?.gameId ?? null;
      return (
        <CustomGameDialog
          key={id}
          open
          editingId={gid}
          onClose={closeModal}
        />
      );
    }
    case 'new-profile':
      return <NewProfileDialog key={id} open onClose={closeModal} />;
    case 'gift-selector': {
      const p = (payload ?? {}) as {
        initialId?: string;
        excludeIds?: readonly string[];
        title?: string;
        showDisabled?: boolean;
        onSelect?: (gift: DonationGift) => void;
      };
      return (
        <GiftSelectorDialog
          key={id}
          open
          onClose={closeModal}
          initialId={p.initialId}
          excludeIds={p.excludeIds}
          title={p.title}
          showDisabled={p.showDisabled}
          onSelect={(gift) => {
            p.onSelect?.(gift);
            closeModal();
          }}
        />
      );
    }
    case 'data':
      return <DataDialog key={id} />;
    case 'social-config':
      return <SocialConfigDialog key={id} />;
    case 'ia-config':
      return <IaConfigDialog key={id} />;
    case 'voices':
      return <VoicesDialog key={id} />;
    case 'profiles':
      return <StreamProfilesDialog key={id} />;
    case 'sounds':
      return <SoundsDialog key={id} />;
    case 'minigames':
      return <MinigamesDialog key={id} />;
    case 'simulator':
      return <SimulatorDialog key={id} />;
    case 'backup':
      return <BackupDialog key={id} />;
    case 'spotify-config':
      return <SpotifyConfigDialog key={id} />;
    case 'emotes':
      return <EmotesDialog key={id} />;
    case 'tiktok-sign-key':
      return <TikTokSignKeyDialog key={id} />;
    case 'rule': {
      const p = (payload ?? {}) as {
        gameId?: GameId;
        ruleId?: string | null;
      };
      if (!p.gameId) return null;
      return (
        <RuleDialog
          key={id}
          open
          onClose={closeModal}
          gameId={p.gameId}
          ruleId={p.ruleId ?? null}
        />
      );
    }
    case 'entity-selector': {
      const p = (payload ?? {}) as {
        gameId?: GameId;
        initialCategory?: string;
        preselected?: string;
        multiSelect?: boolean;
        title?: string;
        onSelect?: (entry: DataEntry, category: string) => void;
        onConfirmMulti?: (selections: MultiSelection[]) => void;
      };
      if (!p.gameId) return null;
      return (
        <EntitySelectorDialog
          key={id}
          open
          onClose={closeModal}
          gameId={p.gameId}
          initialCategory={p.initialCategory}
          preselected={p.preselected}
          multiSelect={p.multiSelect}
          title={p.title}
          onSelect={(entry, category) => {
            p.onSelect?.(entry, category);
            closeModal();
          }}
          onConfirmMulti={(selections) => {
            p.onConfirmMulti?.(selections);
            closeModal();
          }}
        />
      );
    }
    default:
      return null;
  }
}

export function ModalRoot(): ReactNode {
  const stack = useAppStore((s) => s.modalStack);
  const closeModal = useAppStore((s) => s.closeModal);
  const activeModal = useAppStore((s) => s.activeModal);
  const modalPayload = useAppStore((s) => s.modalPayload);

  if (stack.length === 0) return null;

  // Renderiza TODO el stack en orden — el último encima del anterior.
  // Esto permite abrir gift-selector / entity-selector ENCIMA del
  // RuleDialog sin destruirlo (paridad MARU `QDialog.exec_()` apilado).
  // <Suspense> envolvente por si algún dialog lazy todavía está
  // descargándose — muestra el loader hasta que el chunk llegue.
  const rendered = stack.map((frame) => renderModalFrame(frame, closeModal));

  // Si el top no tiene componente conocido, fallback al placeholder.
  const topId = activeModal;
  if (topId && !rendered[rendered.length - 1]) {
    const meta = MODAL_META[topId] ?? FALLBACK_META;
    return (
      <Suspense fallback={<DialogLoader />}>
        {rendered}
        <Dialog open onClose={closeModal} title={meta.title} size="md">
          <div className="space-y-4 py-4">
            <p className="text-sm text-fg-muted">
              Placeholder.{' '}
              <span className="text-accent">
                La versión real llega en {meta.phase}
              </span>{' '}
              con paridad 100% al original (
              <code className="text-fg-subtle">{meta.source}</code>).
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={closeModal}>
                Cerrar
              </Button>
            </div>
          </div>
        </Dialog>
      </Suspense>
    );
  }

  return <Suspense fallback={<DialogLoader />}>{rendered}</Suspense>;
}

interface ModalMeta {
  title: string;
  phase: string;
  source: string;
}

const FALLBACK_META: ModalMeta = {
  title: 'Modal',
  phase: 'G+',
  source: '—',
};

const MODAL_META: Record<string, ModalMeta> = {
  gifts: {
    title: '🎁 Gestionar Donaciones',
    phase: 'G3',
    source: 'gui/dialogs/gifts_dialog.py',
  },
  'gift-selector': {
    title: '🎁 Seleccionar Donación',
    phase: 'G3',
    source: 'gui/dialogs/gift_selector.py',
  },
  'manage-games': {
    title: '🎮 Gestionar Perfiles de Juegos',
    phase: 'G4',
    source: 'gui/dialogs/manage_games_dialog.py',
  },
  'custom-game': {
    title: '🛠️ Editar Juego Personalizado',
    phase: 'G4',
    source: 'gui/dialogs/custom_game_dialog.py',
  },
  'edit-predefined': {
    title: '⚙️ Configurar Juego',
    phase: 'G4',
    source: 'gui/dialogs/manage_games_dialog.py:EditPredefinedDialog',
  },
  'new-profile': {
    title: '➕ Crear Nuevo Perfil',
    phase: 'G4',
    source: 'gui/dialogs/profile_dialog.py',
  },
  data: {
    title: '📦 Catálogo de Datos',
    phase: 'G5',
    source: 'gui/dialogs/data_dialog.py',
  },
  'entity-selector': {
    title: '🐉 Seleccionar Entidad / Item / Evento',
    phase: 'G5',
    source: 'gui/dialogs/entity_selector.py',
  },
  rule: {
    title: '✏️ Editar Regla',
    phase: 'G6',
    source: 'gui/dialogs/rule_dialog.py',
  },
  'social-config': {
    title: '💬 Sistema Social',
    phase: 'G7',
    source: 'gui/dialogs/social_config.py',
  },
  voices: {
    title: '🎤 Voces por Usuario',
    phase: 'G9',
    source: 'gui/dialogs/voices_dialog.py',
  },
  sounds: {
    title: '🔔 Gestor de Sonidos',
    phase: 'G10',
    source: 'gui/dialogs/sounds_dialog.py',
  },
  profiles: {
    title: '💾 Perfiles de Stream',
    phase: 'G10',
    source: 'gui/dialogs/profiles_dialog.py',
  },
  minigames: {
    title: '🎲 Minijuegos',
    phase: 'G10',
    source: 'gui/dialogs/minigames_dialog.py',
  },
  simulator: {
    title: '🎭 Simulador de Eventos',
    phase: 'G11',
    source: 'gui/dialogs/simulator_dialog.py',
  },
  backup: {
    title: '🔄 Gestor de Respaldos',
    phase: 'G12',
    source: 'gui/dialogs/backup_dialog.py',
  },
  // G13 (overlays-manager) deshabilitado en esta build.
};
