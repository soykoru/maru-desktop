import { useState } from 'react';
import { Edit3, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { Button, Empty, Input, Label } from '@maru/ui';
import { Mic2 } from 'lucide-react';
import type { TtsUserVoice, TtsVoice } from '@maru/shared';
import { VoiceSelector } from './VoiceSelector.js';
import { EditVoiceModal } from './EditVoiceModal.js';

/**
 * `UserVoicesList` — bloque principal del VoicesDialog.
 *
 * Réplica del MARU original:
 *   - Form de añadir (user + voice + add).
 *   - Lista user→voice ordenada alfabéticamente.
 *   - Por fila: probar / editar / eliminar.
 *   - Sub-modal de edit.
 */
export interface UserVoicesListProps {
  userVoices: TtsUserVoice[];
  voices: TtsVoice[];
  families: Record<string, string>;
  defaultVoice: string;
  onAssign: (username: string, voice: string) => Promise<unknown>;
  onRemove: (username: string) => Promise<void>;
  onTest: (username: string, voice: string) => Promise<unknown>;
  onClearAll?: () => Promise<number>;
  busy?: boolean;
}

export function UserVoicesList({
  userVoices,
  voices,
  families,
  defaultVoice,
  onAssign,
  onRemove,
  onTest,
  onClearAll,
  busy = false,
}: UserVoicesListProps) {
  const [newUsername, setNewUsername] = useState('');
  const [newVoice, setNewVoice] = useState<string>(defaultVoice);
  const [editingUser, setEditingUser] = useState<TtsUserVoice | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [testingUser, setTestingUser] = useState<string | null>(null);

  async function handleAdd() {
    if (!newUsername.trim()) return;
    setWorking(true);
    setOpError(null);
    try {
      await onAssign(newUsername, newVoice);
      setNewUsername('');
    } catch (ex) {
      setOpError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setWorking(false);
    }
  }

  async function handleTest(u: TtsUserVoice) {
    setTestingUser(u.username);
    try {
      await onTest(u.username, u.voice);
    } finally {
      setTestingUser(null);
    }
  }

  async function handleRemove(username: string) {
    if (!confirm(`¿Quitar la voz custom de @${username}?`)) return;
    setWorking(true);
    setOpError(null);
    try {
      await onRemove(username);
    } catch (ex) {
      setOpError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setWorking(false);
    }
  }

  async function handleEdit(newVoice: string) {
    if (!editingUser) return;
    try {
      await onAssign(editingUser.username, newVoice);
    } catch (ex) {
      setOpError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  return (
    <div className="space-y-3">
      <EditVoiceModal
        open={!!editingUser}
        username={editingUser?.username ?? null}
        currentVoice={editingUser?.voice ?? ''}
        voices={voices}
        families={families}
        onClose={() => setEditingUser(null)}
        onSave={handleEdit}
        busy={busy || working}
      />

      {/* Form añadir */}
      <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          ➕ Asignar voz a @username
        </legend>
        <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-end">
          <div>
            <Label htmlFor="uv-user">Username</Label>
            <Input
              id="uv-user"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="soykoru, gottina (sin @)"
              disabled={busy || working}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newUsername.trim() && newVoice) {
                  void handleAdd();
                }
              }}
            />
          </div>
          <VoiceSelector
            voices={voices}
            families={families}
            value={newVoice}
            onChange={setNewVoice}
            label="Voz a asignar"
            disabled={busy || working}
            searchable
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void handleAdd()}
            disabled={busy || working || !newUsername.trim() || !newVoice}
            className="self-end mb-0.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar
          </Button>
        </div>
        <p className="text-[11px] text-fg-subtle">
          ⚠️ Usá el @USERNAME (case-insensitive) — NO el nombre de perfil.
          Se normaliza a lowercase, sin espacios ni @.
        </p>
      </fieldset>

      {opError && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger">
          {opError}
        </div>
      )}

      {/* Lista */}
      <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-2">
          🎤 Voces asignadas ({userVoices.length})
          {userVoices.length > 0 && onClearAll && (
            <button
              type="button"
              className="text-[10px] text-fg-subtle hover:text-danger normal-case tracking-normal"
              onClick={() => void onClearAll()}
              disabled={busy || working}
            >
              limpiar todas
            </button>
          )}
        </legend>

        {userVoices.length === 0 ? (
          <Empty
            icon={Mic2}
            title="Sin asignaciones todavía"
            description="Agregá una desde el formulario de arriba para empezar."
          />
        ) : (
          <ul className="divide-y divide-border max-h-[260px] overflow-y-auto">
            {userVoices.map((u) => {
              const meta = voices.find((v) => v.id === u.voice);
              return (
                <li
                  key={u.username}
                  className="flex items-center gap-2 px-2 py-1.5"
                >
                  <span className="font-mono text-sm flex-1 truncate" title={`@${u.username}`}>
                    @{u.username}
                  </span>
                  <span className="text-fg-subtle text-xs">→</span>
                  <span className="text-xs text-fg-muted truncate max-w-[220px]" title={u.voice}>
                    {meta?.name ?? u.voice}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleTest(u)}
                    disabled={busy || working || testingUser === u.username}
                    title="Probar esta voz"
                  >
                    {testingUser === u.username ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingUser(u)}
                    disabled={busy || working}
                    title="Editar"
                  >
                    <Edit3 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleRemove(u.username)}
                    disabled={busy || working}
                    title="Eliminar"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
    </div>
  );
}
