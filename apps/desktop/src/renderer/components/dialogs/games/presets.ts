/**
 * Presets de `CustomGameDialog` — espejo de los 4 botones del MARU
 * original (Valheim / Terraria / 7 Days / Rust RCON).
 *
 * Cada preset rellena: connectionType + port + categories.
 */
import type { GameCategory, GameConnectionType } from '@maru/shared';

export interface CustomGamePreset {
  label: string;
  description: string;
  connectionType: GameConnectionType;
  port: number;
  categories: GameCategory[];
}

const cat = (
  id: string,
  name: string,
  type: GameCategory['type'],
  icon: string,
  endpoint: string,
  payload: string,
  rconCmd = '',
): GameCategory => ({
  id,
  name,
  type,
  icon,
  dataKey: id,
  endpoint,
  payload,
  rconCmd,
  tutorial: '',
});

export const CUSTOM_GAME_PRESETS: CustomGamePreset[] = [
  {
    label: '🐉 Valheim',
    description: 'HTTP · puerto 5000 · entidades + items',
    connectionType: 'http',
    port: 5000,
    categories: [
      cat(
        'entities',
        '🐉 Entidades',
        'entity',
        '🐉',
        '/spawn',
        '{"entity_name": "{entity}", "amount": {amount}}',
      ),
      cat(
        'items',
        '📦 Items',
        'item',
        '📦',
        '/item',
        '{"item": "{entity}", "amount": {amount}}',
      ),
    ],
  },
  {
    label: '🌳 Terraria',
    description: 'HTTP · puerto 5000 · 3 categorías',
    connectionType: 'http',
    port: 5000,
    categories: [
      cat(
        'entities',
        '🐉 Entidades',
        'entity',
        '🐉',
        '/spawn/',
        '{"entity": "{entity}", "amount": {amount}}',
      ),
      cat(
        'items',
        '📦 Items',
        'item',
        '📦',
        '/item/',
        '{"item": "{entity}", "amount": {amount}}',
      ),
      cat(
        'events',
        '⚡ Eventos',
        'event',
        '⚡',
        '/event/',
        '{"event": "{entity}", "user": "{user}"}',
      ),
    ],
  },
  {
    label: '🧟 7 Days to Die',
    description: 'HTTP · puerto 8089 · 3 categorías',
    connectionType: 'http',
    port: 8089,
    categories: [
      cat(
        'entities',
        '🧟 Zombies',
        'entity',
        '🧟',
        '/spawn',
        '{"name": "{entity}", "count": {amount}}',
      ),
      cat(
        'items',
        '🔫 Items',
        'item',
        '🔫',
        '/give',
        '{"item": "{entity}", "qty": {amount}}',
      ),
      cat(
        'events',
        '⚡ Eventos',
        'event',
        '⚡',
        '/event',
        '{"event": "{entity}"}',
      ),
    ],
  },
  {
    label: '🔫 Rust (RCON)',
    description: 'RCON · puerto 28016 · 3 categorías',
    connectionType: 'rcon',
    port: 28016,
    categories: [
      cat(
        'entities',
        '🐺 Entidades',
        'entity',
        '🐺',
        '',
        '',
        'spawn {entity}',
      ),
      cat(
        'items',
        '🔫 Items',
        'item',
        '🔫',
        '',
        '',
        'inventory.giveto "{user}" {entity} {amount}',
      ),
      cat(
        'events',
        '⚡ Eventos',
        'event',
        '⚡',
        '',
        '',
        'event.invoke {entity}',
      ),
    ],
  },
];
