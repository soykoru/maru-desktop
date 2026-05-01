import type { LogCategory, LogGroup } from '@maru/shared';

/**
 * Metadata visual de las 19 categorías + 8 grupos del filtro UI.
 * Espejo del MARU original `_CATEGORY_COLORS / _GROUP_LABELS`.
 */
export const CATEGORY_META: Record<
  string,
  { emoji: string; color: string }
> = {
  system: { emoji: '⚙️', color: 'text-fg-muted' },
  tiktok: { emoji: '🎵', color: 'text-info' },
  gift: { emoji: '🎁', color: 'text-warning' },
  follow: { emoji: '➕', color: 'text-success' },
  share: { emoji: '📤', color: 'text-info' },
  like: { emoji: '❤️', color: 'text-accent-red' },
  subscribe: { emoji: '⭐', color: 'text-warning' },
  comment: { emoji: '💬', color: 'text-info' },
  command: { emoji: '⚡', color: 'text-info' },
  emote: { emoji: '🎨', color: 'text-info' },
  rule: { emoji: '📋', color: 'text-accent' },
  action: { emoji: '🎯', color: 'text-accent' },
  social: { emoji: '🤝', color: 'text-success' },
  music: { emoji: '🎶', color: 'text-success' },
  ia: { emoji: '🤖', color: 'text-info' },
  tts: { emoji: '🔊', color: 'text-info' },
  sound: { emoji: '🔔', color: 'text-info' },
  profile: { emoji: '💾', color: 'text-fg-muted' },
  error: { emoji: '✗', color: 'text-danger' },
  warn: { emoji: '⚠', color: 'text-warning' },
  debug: { emoji: '🔍', color: 'text-fg-subtle' },
};

export const LOG_GROUPS: { id: LogGroup; label: string; emoji: string }[] = [
  { id: 'comments', label: 'Comentarios', emoji: '💬' },
  { id: 'commands', label: 'Comandos', emoji: '⌨️' },
  { id: 'gifts', label: 'Regalos', emoji: '🎁' },
  { id: 'emotes', label: 'Emotes', emoji: '🎨' },
  { id: 'follows', label: 'Follows', emoji: '➕' },
  { id: 'likes', label: 'Likes', emoji: '❤️' },
  { id: 'shares', label: 'Shares', emoji: '📤' },
  { id: 'subs', label: 'Subs', emoji: '⭐' },
  { id: 'rules', label: 'Reglas', emoji: '📋' },
  { id: 'social', label: 'Social', emoji: '🤝' },
  { id: 'music', label: 'Música', emoji: '🎶' },
  { id: 'ia', label: 'IA', emoji: '🤖' },
  { id: 'audio', label: 'Audio', emoji: '🔊' },
  { id: 'sistema', label: 'Sistema', emoji: '⚙️' },
  { id: 'errores', label: 'Errores', emoji: '⚠' },
];

export function categoryMeta(c: LogCategory | string) {
  return CATEGORY_META[c] ?? { emoji: '•', color: 'text-fg-muted' };
}
