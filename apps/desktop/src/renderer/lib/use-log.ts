/**
 * `useLog` (G11) — hook con snapshot inicial + push events + filtros.
 *
 * El push real lo cablea `event-wire.ts` (`log:entry` event listener).
 * Este hook solo expone state + helpers + clear/export.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { LogCategory, LogEntry, LogGroup } from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';
import { groupConsecutive, type LogItem } from './log-grouping.js';

const GROUP_TO_CATEGORIES: Record<LogGroup, LogCategory[]> = {
  // 1:1 granular — el user pidió que cada tipo de evento tenga su propio
  // toggle (gifts separado de likes, follows, shares, etc.).
  comments: ['comment'],
  commands: ['command'],
  gifts: ['gift'],
  emotes: ['emote'],
  follows: ['follow'],
  likes: ['like'],
  shares: ['share'],
  subs: ['subscribe'],
  // 'rules' incluye 'action' porque la ejecución de reglas se loguea
  // como rule_dispatcher con cat="rule"; no hay categoría 'action'
  // separada en producción (sería un pill huérfano).
  rules: ['rule', 'action'],
  social: ['social'],
  music: ['music'],
  ia: ['ia'],
  audio: ['tts', 'sound'],
  sistema: ['system', 'tiktok', 'profile'],
  errores: ['error', 'warn'],
};

export function useLog(options?: { autoLoad?: boolean }) {
  const autoLoad = options?.autoLoad ?? true;

  const entries = useAppStore((s) => s.logEntries);
  const stats = useAppStore((s) => s.logStats);
  const statsTotal = useAppStore((s) => s.logStatsTotal);
  const activeGroups = useAppStore((s) => s.logActiveGroups);
  const search = useAppStore((s) => s.logSearch);
  const autoScroll = useAppStore((s) => s.logAutoScroll);
  const unreadCount = useAppStore((s) => s.logUnreadCount);
  const showTimestamps = useAppStore((s) => s.logShowTimestamps);

  const setEntries = useAppStore((s) => s.setLogEntries);
  const setStats = useAppStore((s) => s.setLogStats);
  const clearLog = useAppStore((s) => s.clearLog);
  const toggleGroup = useAppStore((s) => s.toggleLogGroup);
  const setSearch = useAppStore((s) => s.setLogSearch);
  const setAutoScroll = useAppStore((s) => s.setLogAutoScroll);
  const resetUnread = useAppStore((s) => s.resetLogUnread);
  const setShowTimestamps = useAppStore((s) => s.setShowTimestamps);

  const loadInitial = useCallback(async () => {
    try {
      // Hidratar buffer del archivo si está vacío.
      await rpcCall('logs.hydrate-from-file', { lines: 200 }).catch(() => undefined);
      const [list, stats] = await Promise.all([
        rpcCall('logs.list', { limit: 500 }),
        rpcCall('logs.stats', {}),
      ]);
      setEntries(list.entries);
      setStats(stats.byCategory as Record<string, number>, stats.total);
    } catch {
      /* swallow */
    }
  }, [setEntries, setStats]);

  useEffect(() => {
    if (!autoLoad) return;
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  const clearRemote = useCallback(async () => {
    if (!confirm('¿Limpiar el log? Borra el buffer en memoria del sidecar y el del cliente.')) {
      return;
    }
    await rpcCall('logs.clear', {}).catch(() => undefined);
    clearLog();
  }, [clearLog]);

  const resetStatsRemote = useCallback(async () => {
    await rpcCall('logs.reset-stats', {}).catch(() => undefined);
    setStats({}, 0);
  }, [setStats]);

  const exportLog = useCallback(() => {
    const lines = entries.map((e) => {
      const ts = new Date(e.ts).toISOString();
      return `${ts} [${e.level}] [${e.category}] ${e.source}: ${e.message}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `maru-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [entries]);

  // Filtrado en memoria.
  const visible = useMemo<LogEntry[]>(() => {
    const allowedCats = new Set<string>();
    for (const g of activeGroups) {
      for (const c of GROUP_TO_CATEGORIES[g]) {
        allowedCats.add(c);
      }
    }
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!allowedCats.has(e.category)) return false;
      if (q && !e.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, activeGroups, search]);

  // Agrupado: colapsa rachas consecutivas (likes/gifts/shares del mismo
  // user dentro de 60s) en buckets expandibles. Mantiene el orden y la
  // identidad del bucket es estable mientras los entries no cambien,
  // así el estado de expand/collapse en LogPanel no se resetea con el
  // próximo render.
  const visibleItems = useMemo<LogItem[]>(
    () => groupConsecutive(visible),
    [visible],
  );

  return {
    entries,
    visible,
    visibleItems,
    stats,
    statsTotal,
    activeGroups,
    search,
    autoScroll,
    unreadCount,
    showTimestamps,
    loadInitial,
    clearRemote,
    resetStatsRemote,
    exportLog,
    toggleGroup,
    setSearch,
    setAutoScroll,
    resetUnread,
    setShowTimestamps,
  };
}
