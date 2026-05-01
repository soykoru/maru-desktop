import { useEffect, useMemo, useState } from 'react';
import { Heart, Play, Search, Send, Zap } from 'lucide-react';
import {
  Button,
  Dialog,
  Empty,
  Input,
  MaruImage,
  Select,
} from '@maru/ui';
import type { DonationGift } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useGifts } from '../../../lib/use-gifts.js';
import { rpcCall } from '../../../lib/rpc.js';

/**
 * `SimulatorDialog` (G11) — réplica de `simulator_dialog.py`.
 *
 * Tipos de evento (6, paridad MARU):
 *   gift · comment · follow · share · subscribe · like
 *
 * Mejoras vs MARU original:
 *   - Burst con stagger 200ms (paridad K6).
 *   - Status auto-clear 2s (paridad K9).
 *   - Galería gifts compacta 100×92 con search + sort + count.
 *   - 10 presets pre-configurados.
 *   - Single-source events vía sidecar EventBus → llegan al log y
 *     a las reglas como si fueran reales.
 */
type EventType = 'gift' | 'comment' | 'follow' | 'share' | 'subscribe' | 'like';

const EVENT_TYPES: { id: EventType; label: string; emoji: string }[] = [
  { id: 'gift', label: 'Regalo', emoji: '🎁' },
  { id: 'comment', label: 'Comentario', emoji: '💬' },
  { id: 'follow', label: 'Follow', emoji: '➕' },
  { id: 'share', label: 'Compartir', emoji: '📤' },
  { id: 'subscribe', label: 'Super Fan', emoji: '⭐' },
  { id: 'like', label: 'Like', emoji: '❤️' },
];

type Preset = {
  emoji: string;
  label: string;
  type: EventType;
  value: string;
};

const PRESETS: Preset[] = [
  { emoji: '🌹', label: 'Rosa', type: 'gift', value: 'Rose' },
  { emoji: '🌌', label: 'Galaxy', type: 'gift', value: 'Galaxy' },
  { emoji: '🦁', label: 'León', type: 'gift', value: 'Lion' },
  { emoji: '💎', label: 'Diamante', type: 'gift', value: 'Diamond' },
  { emoji: '➕', label: 'Follow', type: 'follow', value: '' },
  { emoji: '📤', label: 'Share', type: 'share', value: '' },
  { emoji: '⭐', label: 'SuperFan', type: 'subscribe', value: '' },
  { emoji: '❤️', label: '10 Likes', type: 'like', value: '10' },
  { emoji: '💬', label: '!spawn', type: 'comment', value: '!spawn' },
  { emoji: '💬', label: '!ia hola', type: 'comment', value: '!ia hola' },
];

interface UserRanks {
  isSuperFan?: boolean;
  isModerator?: boolean;
  isTopGifter?: boolean;
  isFollower?: boolean;
  memberLevel?: number;
  gifterLevel?: number;
}

function RankToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-md px-2 py-1 text-xs border transition-colors',
        active
          ? 'border-accent bg-accent/15 text-accent font-semibold'
          : 'border-border bg-bg-base text-fg-muted hover:border-fg-muted',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

async function dispatchEvent(
  type: EventType,
  user: string,
  value: string,
  gameId: string | null,
  ranks: UserRanks = {},
): Promise<void> {
  const u = user.trim() || 'TestUser';
  const target = gameId ? { gameId } : {};
  // Pasamos ranks a TODOS los tipos para que las reglas con
  // required_ranks/excluded_ranks puedan testearse contra cualquier
  // evento (gift de un super fan, like de un mod, etc.). El sidecar
  // ignora silenciosamente los flags que no necesite.
  switch (type) {
    case 'gift':
      await rpcCall('simulator.gift', {
        ...target,
        ...ranks,
        user: u,
        giftName: value || 'Rose',
        diamonds: 1,
        count: 1,
      });
      break;
    case 'comment':
      if (value.trim().startsWith('!')) {
        const cmd = value.trim().slice(1).split(/\s+/);
        await rpcCall('simulator.command', {
          ...target,
          ...ranks,
          user: u,
          command: cmd[0] ?? '',
          args: cmd.slice(1).join(' '),
        });
      } else {
        await rpcCall('simulator.comment', {
          ...target,
          ...ranks,
          user: u,
          text: value,
        });
      }
      break;
    case 'follow':
      await rpcCall('simulator.follow', { ...target, ...ranks, user: u });
      break;
    case 'share':
      await rpcCall('simulator.share', { ...target, ...ranks, user: u });
      break;
    case 'subscribe':
      await rpcCall('simulator.subscribe', { ...target, ...ranks, user: u });
      break;
    case 'like':
      await rpcCall('simulator.like', {
        ...target,
        ...ranks,
        user: u,
        count: parseInt(value || '1', 10) || 1,
      });
      break;
  }
}

export function SimulatorDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'simulator'));
  const closeModal = useAppStore((s) => s.closeModal);
  // El simulador respeta el juego activo del sidebar — el sidecar
  // procesará las reglas de ESE juego (no el activeGame stale).
  const selectedGameId = useAppStore((s) => s.selectedGameId);

  const { allGifts } = useGifts({ autoLoad: open });

  const [eventType, setEventType] = useState<EventType>('gift');
  const [user, setUser] = useState('TestUser');
  const [giftSearch, setGiftSearch] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedGift, setSelectedGift] = useState<DonationGift | null>(null);
  const [commentText, setCommentText] = useState('');
  const [likeCount, setLikeCount] = useState(10);
  const [repeat, setRepeat] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('Listo para simular');
  // Rangos del usuario simulado (se aplican solo a comment/command).
  const [ranks, setRanks] = useState<UserRanks>({});
  function toggleRank(key: keyof UserRanks) {
    setRanks((r) => ({ ...r, [key]: !r[key] }));
  }
  function setMemberLevel(level: number) {
    setRanks((r) => ({ ...r, memberLevel: level || undefined }));
  }

  // Reset al abrir.
  useEffect(() => {
    if (!open) {
      setBusy(false);
      setStatus('Listo para simular');
    }
  }, [open]);

  if (!open) return null;

  const visibleGifts = useMemo(() => {
    const q = giftSearch.trim().toLowerCase();
    let arr = allGifts.filter((g) => !g.disabled);
    if (q) {
      arr = arr.filter(
        (g) =>
          g.id.toLowerCase().includes(q) || g.name.toLowerCase().includes(q),
      );
    }
    arr.sort((a, b) => (sortDesc ? b.coins - a.coins : a.coins - b.coins));
    return arr;
  }, [allGifts, giftSearch, sortDesc]);

  function flash(text: string) {
    setStatus(text);
    window.setTimeout(() => setStatus('Listo para simular'), 2000);
  }

  function buildValue(): string {
    if (eventType === 'gift') return selectedGift?.id ?? '';
    if (eventType === 'comment') return commentText;
    if (eventType === 'like') return String(likeCount);
    return '';
  }

  async function simulate(): Promise<void> {
    const value = buildValue();
    setBusy(true);
    try {
      await dispatchEvent(eventType, user, value, selectedGameId, ranks);
      flash(
        `${EVENT_TYPES.find((e) => e.id === eventType)?.emoji} ${user || 'TestUser'} → ${value || '(sin valor)'}`,
      );
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`);
    } finally {
      setBusy(false);
    }
  }

  async function burst(): Promise<void> {
    const value = buildValue();
    const n = Math.max(1, Math.min(100, repeat));
    setBusy(true);
    setStatus(`Enviando ráfaga de ${n} eventos...`);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < n; i += 1) {
      try {
        await dispatchEvent(eventType, user, value, selectedGameId, ranks);
        ok += 1;
      } catch {
        fail += 1;
      }
      // Stagger 200ms (paridad K6).
      if (i < n - 1) {
        await new Promise((r) => window.setTimeout(r, 200));
      }
    }
    setBusy(false);
    flash(`Ráfaga completa: ${ok}/${n}${fail ? ` (${fail} fallidos)` : ''}`);
  }

  async function fireQuick(p: Preset): Promise<void> {
    setEventType(p.type);
    if (p.type === 'gift') {
      setSelectedGift({ id: p.value, name: p.value, icon: '🎁', coins: 1, iconPath: '' });
    } else if (p.type === 'comment') {
      setCommentText(p.value);
    } else if (p.type === 'like') {
      setLikeCount(parseInt(p.value, 10) || 1);
    }
    setBusy(true);
    try {
      await dispatchEvent(p.type, user, p.value, selectedGameId, ranks);
      flash(`⚡ Preset: ${p.emoji} ${p.label}`);
    } catch (ex) {
      flash(`✗ ${ex instanceof Error ? ex.message : String(ex)}`);
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
      title="🎭 Simulador de Eventos"
      description="Inyectá eventos al EventBus como si vinieran de TikTok real — los recibe el rule engine + log."
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        {/* Form base */}
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
              Evento
            </label>
            <Select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
              disabled={busy}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.emoji} {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
              Usuario
            </label>
            <Input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="TestUser"
              disabled={busy}
            />
          </div>
        </div>

        {/* Rangos del usuario — aplican a TODOS los tipos de evento.
            Permite testear reglas con required_ranks/excluded_ranks
            simulando un super fan que dona, un mod que da likes, etc. */}
        <fieldset className="rounded-xl border border-warning/30 bg-warning/[0.04] p-3 space-y-2">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-warning">
            🏷️ Rango del TestUser
          </legend>
          <div className="flex flex-wrap gap-2 items-center">
            <RankToggle
              label="⭐ Super Fan"
              active={!!ranks.isSuperFan}
              onClick={() => toggleRank('isSuperFan')}
            />
            <RankToggle
              label="🛡️ Moderador"
              active={!!ranks.isModerator}
              onClick={() => toggleRank('isModerator')}
            />
            <RankToggle
              label="🏆 Top Gifter"
              active={!!ranks.isTopGifter}
              onClick={() => toggleRank('isTopGifter')}
            />
            <RankToggle
              label="➕ Seguidor"
              active={!!ranks.isFollower}
              onClick={() => toggleRank('isFollower')}
            />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-fg-muted">Nivel fan L:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={ranks.memberLevel ?? ''}
                onChange={(e) =>
                  setMemberLevel(parseInt(e.target.value || '0', 10) || 0)
                }
                className="maru-input w-16 text-xs h-7"
                placeholder="0"
                title="Nivel del fans club (badge L1-L50)"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-fg-muted">Gifter G:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={ranks.gifterLevel ?? ''}
                onChange={(e) =>
                  setRanks((r) => ({
                    ...r,
                    gifterLevel: parseInt(e.target.value || '0', 10) || undefined,
                  }))
                }
                className="maru-input w-16 text-xs h-7"
                placeholder="0"
                title="Nivel de gifter (G1-G50)"
              />
            </div>
            {(ranks.isSuperFan || ranks.isModerator || ranks.isTopGifter ||
              ranks.isFollower || ranks.memberLevel || ranks.gifterLevel) && (
              <button
                type="button"
                onClick={() => setRanks({})}
                className="ml-auto text-[10px] text-fg-subtle hover:text-fg underline"
              >
                Limpiar
              </button>
            )}
          </div>
          <p className="text-[10px] text-fg-subtle">
            Estos flags se aplican a CUALQUIER tipo de evento del simulador:
            podés probar reglas con <code>required_ranks=[super_fan]</code>{' '}
            simulando un gift, like, comment, etc. del rango elegido.
          </p>
        </fieldset>

        {/* Sección condicional: gifts */}
        {eventType === 'gift' && (
          <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              🎁 Galería de regalos
            </legend>

            <div className="flex gap-2">
              <Input
                prefix={<Search className="h-3.5 w-3.5" />}
                placeholder="Buscar regalo..."
                value={giftSearch}
                onChange={(e) => setGiftSearch(e.target.value)}
                disabled={busy}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSortDesc((v) => !v)}
                disabled={busy}
                title="Cambiar orden"
              >
                {sortDesc ? '⬇ Mayor' : '⬆ Menor'}
              </Button>
              <span className="text-[11px] text-fg-subtle self-center">
                {visibleGifts.length}
              </span>
            </div>

            {selectedGift && (
              <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs">
                <span className="font-mono">Selección:</span>
                <strong>{selectedGift.name}</strong>
                <span className="text-warning">💎 {selectedGift.coins}</span>
              </div>
            )}

            {visibleGifts.length === 0 ? (
              <Empty
                icon={Heart}
                title={giftSearch ? 'Sin resultados' : 'Sin gifts disponibles'}
                description={
                  giftSearch
                    ? `Probá otra búsqueda.`
                    : 'Configurá gifts en el GiftsDialog primero.'
                }
              />
            ) : (
              <div
                className="grid gap-2 max-h-[220px] overflow-y-auto p-1"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                }}
              >
                {visibleGifts.map((g) => {
                  const sel = selectedGift?.id === g.id;
                  const iconPath = g.iconPath?.startsWith('donaciones/')
                    ? g.iconPath.slice('donaciones/'.length)
                    : g.iconPath;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGift(g)}
                      disabled={busy}
                      className={[
                        'flex flex-col items-center justify-center gap-1 p-1.5 rounded-lg border text-[10px]',
                        'h-[92px] transition-colors',
                        sel
                          ? 'border-accent ring-1 ring-accent/40 bg-accent/10'
                          : 'border-border bg-bg-surface hover:border-fg-muted',
                      ].join(' ')}
                    >
                      <MaruImage
                        scope="donaciones"
                        path={iconPath || 'Rose_black_white.png'}
                        size={40}
                        fallback={g.icon || '🎁'}
                        loadingStrategy="intersect"
                      />
                      <span className="truncate w-full text-center" title={g.name}>
                        {g.name.slice(0, 12)}
                      </span>
                      <span className="text-warning font-bold">
                        {g.coins} 💎
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
        )}

        {/* Sección condicional: comment */}
        {eventType === 'comment' && (
          <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              💬 Texto del comentario
            </legend>
            <Input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Comentario o comando (ej: !spawn, !ia hola)"
              disabled={busy}
            />
            <p className="text-[11px] text-fg-subtle">
              Si empieza con <code>!</code>, se envía como command (ej:
              <code className="font-mono">!spawn</code>); si no, como
              comentario libre.
            </p>
          </fieldset>
        )}

        {/* Sección condicional: like */}
        {eventType === 'like' && (
          <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              ❤️ Cantidad de likes
            </legend>
            <Input
              type="number"
              min={1}
              max={10000}
              value={String(likeCount)}
              onChange={(e) =>
                setLikeCount(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
              disabled={busy}
            />
          </fieldset>
        )}

        {/* Action row + burst */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void simulate()}
            disabled={busy}
            className="flex-1"
          >
            <Play className="h-3.5 w-3.5" />
            Simular Evento
          </Button>
          <span className="text-[11px] text-fg-subtle">Repetir:</span>
          <Input
            type="number"
            min={1}
            max={100}
            value={String(repeat)}
            onChange={(e) =>
              setRepeat(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))
            }
            disabled={busy}
            className="w-[80px]"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void burst()}
            disabled={busy || repeat < 2}
            title="Enviar N eventos con stagger 200ms"
          >
            <Send className="h-3.5 w-3.5" />
            Enviar
          </Button>
        </div>

        {/* Presets */}
        <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-1">
            <Zap className="h-3 w-3" /> Atajos rápidos
          </legend>
          <div className="grid grid-cols-5 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={`${p.type}::${p.value}`}
                type="button"
                onClick={() => void fireQuick(p)}
                disabled={busy}
                className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-bg-surface px-1 py-1.5 text-[10px] hover:border-accent/40 hover:bg-accent/10 transition-colors h-[68px]"
                title={`${p.type}: ${p.value || '(sin valor)'}`}
              >
                <span className="text-lg font-emoji">{p.emoji}</span>
                <span className="font-medium">{p.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <p className="text-[11px] text-fg-subtle truncate" aria-live="polite">
          {status}
        </p>
        <Button variant="ghost" size="sm" onClick={closeModal} disabled={busy}>
          Cerrar
        </Button>
      </footer>
    </Dialog>
  );
}
