import type { StateCreator } from 'zustand';
import type { GameId, Rule } from '@maru/shared';

/**
 * Slice de reglas (G6) — buckets por `gameId`.
 *
 * Cada juego tiene su propia lista de reglas; el slice las cachea en
 * memoria y guarda search/filter UI state.
 */
export type RulesBucket = {
  rules: Rule[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  search: string;
  triggerFilter: string | 'all';
  selectedRuleId: string | null;
};

const EMPTY_BUCKET: RulesBucket = {
  rules: [],
  status: 'idle',
  error: null,
  search: '',
  triggerFilter: 'all',
  selectedRuleId: null,
};

export interface RulesSlice {
  rulesBuckets: Record<GameId, RulesBucket>;

  setRulesBucket: (gid: GameId, patch: Partial<RulesBucket>) => void;
  setRules: (gid: GameId, rules: Rule[]) => void;
  upsertRuleLocal: (gid: GameId, rule: Rule) => void;
  removeRuleLocal: (gid: GameId, ruleId: string) => void;
  setRuleEnabledLocal: (gid: GameId, ruleId: string, enabled: boolean) => void;
  reorderRulesLocal: (gid: GameId, orderedIds: string[]) => void;
}

function ensure(buckets: Record<string, RulesBucket>, gid: GameId): RulesBucket {
  return buckets[gid] ?? EMPTY_BUCKET;
}

export const createRulesSlice: StateCreator<RulesSlice, [], [], RulesSlice> = (
  set,
) => ({
  rulesBuckets: {},

  setRulesBucket: (gid, patch) =>
    set((s) => ({
      rulesBuckets: {
        ...s.rulesBuckets,
        [gid]: { ...ensure(s.rulesBuckets, gid), ...patch },
      },
    })),

  setRules: (gid, rules) =>
    set((s) => ({
      rulesBuckets: {
        ...s.rulesBuckets,
        [gid]: {
          ...ensure(s.rulesBuckets, gid),
          rules,
          status: 'ready',
          error: null,
        },
      },
    })),

  upsertRuleLocal: (gid, rule) =>
    set((s) => {
      const bucket = ensure(s.rulesBuckets, gid);
      const idx = bucket.rules.findIndex((r) => r.id === rule.id);
      const next =
        idx === -1
          ? [...bucket.rules, rule]
          : bucket.rules.map((r, i) => (i === idx ? rule : r));
      return {
        rulesBuckets: {
          ...s.rulesBuckets,
          [gid]: { ...bucket, rules: next },
        },
      };
    }),

  removeRuleLocal: (gid, ruleId) =>
    set((s) => {
      const bucket = ensure(s.rulesBuckets, gid);
      return {
        rulesBuckets: {
          ...s.rulesBuckets,
          [gid]: {
            ...bucket,
            rules: bucket.rules.filter((r) => r.id !== ruleId),
            selectedRuleId:
              bucket.selectedRuleId === ruleId ? null : bucket.selectedRuleId,
          },
        },
      };
    }),

  setRuleEnabledLocal: (gid, ruleId, enabled) =>
    set((s) => {
      const bucket = ensure(s.rulesBuckets, gid);
      return {
        rulesBuckets: {
          ...s.rulesBuckets,
          [gid]: {
            ...bucket,
            rules: bucket.rules.map((r) =>
              r.id === ruleId ? { ...r, enabled } : r,
            ),
          },
        },
      };
    }),

  reorderRulesLocal: (gid, orderedIds) =>
    set((s) => {
      const bucket = ensure(s.rulesBuckets, gid);
      const byId = new Map(bucket.rules.map((r) => [r.id, r]));
      const ordered: Rule[] = [];
      for (const id of orderedIds) {
        const r = byId.get(id);
        if (r) ordered.push(r);
      }
      // Conservar las que no estaban en orderedIds al final.
      for (const r of bucket.rules) {
        if (!orderedIds.includes(r.id)) ordered.push(r);
      }
      return {
        rulesBuckets: {
          ...s.rulesBuckets,
          [gid]: { ...bucket, rules: ordered },
        },
      };
    }),
});
