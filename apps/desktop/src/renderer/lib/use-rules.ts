/**
 * `useRules` — hook que cablea el slice `rules` con el sidecar.
 *
 * Bucket-aware (por gameId). Auto-load. CRUD optimista con rollback
 * vía refresh en error. Helpers derivados: visible/all, byId, count.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { GameId, Rule, RuleInput } from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

export interface UseRulesResult {
  allRules: Rule[];
  visibleRules: Rule[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  search: string;
  triggerFilter: string | 'all';
  selectedRuleId: string | null;
  selectedRule: Rule | null;

  setSearch: (q: string) => void;
  setTriggerFilter: (t: string | 'all') => void;
  setSelectedRuleId: (id: string | null) => void;

  refresh: () => Promise<void>;
  upsert: (rule: RuleInput) => Promise<Rule>;
  remove: (id: string) => Promise<void>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
  duplicate: (id: string) => Promise<Rule>;
  reorder: (orderedIds: string[]) => Promise<void>;
  test: (id: string) => Promise<{ ok: boolean; messages: string[] }>;
}

export function useRules(
  gameId: GameId | null,
  options?: { autoLoad?: boolean },
): UseRulesResult {
  const autoLoad = options?.autoLoad ?? true;

  const bucket = useAppStore((s) =>
    gameId ? s.rulesBuckets[gameId] : undefined,
  );
  const setBucket = useAppStore((s) => s.setRulesBucket);
  const setRules = useAppStore((s) => s.setRules);
  const upsertLocal = useAppStore((s) => s.upsertRuleLocal);
  const removeLocal = useAppStore((s) => s.removeRuleLocal);
  const setEnabledLocal = useAppStore((s) => s.setRuleEnabledLocal);
  const reorderLocal = useAppStore((s) => s.reorderRulesLocal);

  const allRules = bucket?.rules ?? [];
  const status = bucket?.status ?? 'idle';
  const error = bucket?.error ?? null;
  const search = bucket?.search ?? '';
  const triggerFilter = bucket?.triggerFilter ?? 'all';
  const selectedRuleId = bucket?.selectedRuleId ?? null;

  const refresh = useCallback(async () => {
    if (!gameId) return;
    setBucket(gameId, { status: 'loading' });
    try {
      const res = await rpcCall('rules.list', { gameId });
      setRules(gameId, res.rules);
    } catch (ex) {
      setBucket(gameId, {
        status: 'error',
        error: ex instanceof Error ? ex.message : String(ex),
      });
    }
  }, [gameId, setBucket, setRules]);

  const upsert = useCallback(
    async (rule: RuleInput) => {
      if (!gameId) throw new Error('gameId requerido');
      const res = await rpcCall('rules.upsert', { gameId, rule });
      upsertLocal(gameId, res.rule);
      return res.rule;
    },
    [gameId, upsertLocal],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!gameId) return;
      removeLocal(gameId, id);
      try {
        await rpcCall('rules.delete', { gameId, ruleId: id });
      } catch (ex) {
        await refresh();
        throw ex;
      }
    },
    [gameId, removeLocal, refresh],
  );

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      if (!gameId) return;
      setEnabledLocal(gameId, id, enabled);
      try {
        await rpcCall('rules.toggle', { gameId, ruleId: id, enabled });
      } catch (ex) {
        setEnabledLocal(gameId, id, !enabled);
        throw ex;
      }
    },
    [gameId, setEnabledLocal],
  );

  const duplicate = useCallback(
    async (id: string) => {
      if (!gameId) throw new Error('gameId requerido');
      const res = await rpcCall('rules.duplicate', { gameId, ruleId: id });
      upsertLocal(gameId, res.rule);
      return res.rule;
    },
    [gameId, upsertLocal],
  );

  const reorder = useCallback(
    async (orderedIds: string[]) => {
      if (!gameId) return;
      reorderLocal(gameId, orderedIds);
      try {
        await rpcCall('rules.reorder', { gameId, orderedIds });
      } catch (ex) {
        await refresh();
        throw ex;
      }
    },
    [gameId, reorderLocal, refresh],
  );

  const test = useCallback(
    async (id: string) => {
      if (!gameId) {
        return { ok: false, messages: ['gameId requerido'] };
      }
      return rpcCall('rules.test', { gameId, ruleId: id });
    },
    [gameId],
  );

  const setSearch = useCallback(
    (q: string) => gameId && setBucket(gameId, { search: q }),
    [gameId, setBucket],
  );
  const setTriggerFilter = useCallback(
    (t: string | 'all') =>
      gameId && setBucket(gameId, { triggerFilter: t }),
    [gameId, setBucket],
  );
  const setSelectedRuleId = useCallback(
    (id: string | null) =>
      gameId && setBucket(gameId, { selectedRuleId: id }),
    [gameId, setBucket],
  );

  useEffect(() => {
    if (!autoLoad || !gameId) return;
    if (status === 'idle') void refresh();
  }, [autoLoad, gameId, status, refresh]);

  const visibleRules = useMemo(() => {
    let out = allRules;
    if (triggerFilter !== 'all') {
      out = out.filter((r) => r.trigger_type === triggerFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.trigger_value.toLowerCase().includes(q) ||
          r.actions.some((a) =>
            a.action_value.toLowerCase().includes(q),
          ),
      );
    }
    return out;
  }, [allRules, triggerFilter, search]);

  const selectedRule = useMemo(
    () => allRules.find((r) => r.id === selectedRuleId) ?? null,
    [allRules, selectedRuleId],
  );

  return {
    allRules,
    visibleRules,
    status,
    error,
    search,
    triggerFilter,
    selectedRuleId,
    selectedRule,
    setSearch,
    setTriggerFilter,
    setSelectedRuleId,
    refresh,
    upsert,
    remove,
    toggle,
    duplicate,
    reorder,
    test,
  };
}
