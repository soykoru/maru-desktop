import type { RuleTriggerType } from '@maru/shared';

/**
 * Metadata visual de los 7 trigger types MARU.
 *
 * Espejo de las opciones del `event` combo en `rule_dialog.py`.
 */
export const TRIGGER_META: Record<
  string,
  { label: string; emoji: string; color: string; hint: string }
> = {
  gift: {
    label: 'Regalo',
    emoji: '🎁',
    color: 'text-accent',
    hint: 'Se activa cuando un viewer envía el regalo seleccionado.',
  },
  command: {
    label: 'Comando',
    emoji: '💬',
    color: 'text-info',
    hint: 'Se activa cuando alguien escribe el comando en el chat.',
  },
  follow: {
    label: 'Follow',
    emoji: '➕',
    color: 'text-success',
    hint: 'Se activa cuando un viewer sigue el live.',
  },
  share: {
    label: 'Share',
    emoji: '📤',
    color: 'text-info',
    hint: 'Se activa cuando un viewer comparte el live.',
  },
  subscribe: {
    label: 'Super Fan',
    emoji: '⭐',
    color: 'text-warning',
    hint: 'Se activa cuando un viewer se suscribe.',
  },
  like: {
    label: 'Like (cada N)',
    emoji: '❤️',
    color: 'text-accent-red',
    hint: 'Se activa cada vez que se acumulan N likes.',
  },
  like_milestone: {
    label: 'Meta de Likes',
    emoji: '🎯',
    color: 'text-warning',
    hint: 'Se activa UNA VEZ al alcanzar la meta total.',
  },
  emote: {
    label: 'Emote / Sticker',
    emoji: '🎨',
    color: 'text-purple-400',
    hint: 'Se activa cuando un viewer envía el emote seleccionado del streamer.',
  },
  join: {
    label: 'Entrada al live',
    emoji: '👋',
    color: 'text-cyan-400',
    hint: 'Se activa cuando un viewer entra al live. Si dejás el campo vacío, vale para cualquier viewer.',
  },
  first_action: {
    label: 'Primera acción del viewer',
    emoji: '🌟',
    color: 'text-fuchsia-400',
    hint:
      'Se activa la PRIMERA vez que un viewer interactúa en la sesión (comment / gift / like / share / follow). Útil para mensajes de bienvenida únicos.',
  },
};

export const TRIGGER_KEYS: RuleTriggerType[] = [
  'gift',
  'command',
  'follow',
  'share',
  'subscribe',
  'like',
  'like_milestone',
  'emote',
  'join',
  'first_action',
];

export function triggerMeta(t: string) {
  return (
    TRIGGER_META[t] ?? {
      label: t,
      emoji: '⚙️',
      color: 'text-fg-muted',
      hint: '',
    }
  );
}
