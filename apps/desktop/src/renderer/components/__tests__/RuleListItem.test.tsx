import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RuleListItem } from '../dialogs/rules/RuleListItem.js';
import type { Rule } from '@maru/shared';

const baseRule: Rule = {
  id: 'r1',
  name: 'Test rule',
  enabled: true,
  trigger_type: 'gift',
  trigger_value: 'rose',
  actions: [
    {
      action_type: 'entity',
      action_type_name: '🐉 Entidad',
      action_value: 'Boar',
      amount: 1,
      commands: '',
    },
  ],
  random_action: false,
  cooldown: 0,
  tts_enabled: false,
  tts_message: '',
  tts_voice: '',
  allowed_users: [],
  action_type: 'spawn',
  action_value: 'Boar',
  amount: 1,
  commands: '',
} as never;

function makeProps(overrides: Partial<React.ComponentProps<typeof RuleListItem>> = {}) {
  return {
    rule: baseRule,
    gameId: 'valheim' as never,
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onTest: vi.fn(),
    ...overrides,
  };
}

describe('RuleListItem', () => {
  it('muestra el nombre de la regla', () => {
    render(<RuleListItem {...makeProps()} />);
    expect(screen.getByText('Test rule')).toBeInTheDocument();
  });

  it('click en imagen de donación llama onQuickChangeGift', () => {
    const onQuickChangeGift = vi.fn();
    render(
      <RuleListItem
        {...makeProps({ onQuickChangeGift })}
      />,
    );
    const giftBtn = screen.getByTitle('Click para cambiar la donación');
    fireEvent.click(giftBtn);
    expect(onQuickChangeGift).toHaveBeenCalledWith('r1');
  });

  it('click en imagen de acción llama onQuickChangeAction', () => {
    const onQuickChangeAction = vi.fn();
    render(
      <RuleListItem
        {...makeProps({ onQuickChangeAction })}
      />,
    );
    const actionBtn = screen.getByTitle('Click para cambiar la acción');
    fireEvent.click(actionBtn);
    expect(onQuickChangeAction).toHaveBeenCalledWith('r1', 0);
  });
});
