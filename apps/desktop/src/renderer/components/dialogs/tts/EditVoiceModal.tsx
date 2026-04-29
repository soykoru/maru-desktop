import { useEffect, useState } from 'react';
import { Button, Dialog } from '@maru/ui';
import type { TtsVoice } from '@maru/shared';
import { VoiceSelector } from './VoiceSelector.js';

/**
 * `EditVoiceModal` — sub-modal para cambiar la voz de un user específico.
 *
 * Réplica del subdialog `edit()` del MARU original `voices_dialog.py`.
 */
export interface EditVoiceModalProps {
  open: boolean;
  username: string | null;
  currentVoice: string;
  voices: TtsVoice[];
  families: Record<string, string>;
  onClose: () => void;
  onSave: (newVoice: string) => Promise<void> | void;
  busy?: boolean;
}

export function EditVoiceModal({
  open,
  username,
  currentVoice,
  voices,
  families,
  onClose,
  onSave,
  busy = false,
}: EditVoiceModalProps) {
  const [draft, setDraft] = useState<string>(currentVoice);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(currentVoice);
      setWorking(false);
    }
  }, [open, currentVoice]);

  if (!open || !username) return null;

  async function handleSave() {
    if (draft === currentVoice) {
      onClose();
      return;
    }
    setWorking(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => !working && onClose()}
      size="sm"
      title={`✏️ Editar voz de @${username}`}
      description="Esta voz override sobre la default y la del perfil del juego."
    >
      <div className="space-y-3">
        <VoiceSelector
          voices={voices}
          families={families}
          value={draft}
          onChange={setDraft}
          label={`Cambiar voz para @${username}`}
          disabled={busy || working}
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={busy || working}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={busy || working || draft === currentVoice}
          >
            💾 Guardar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
