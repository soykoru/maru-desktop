import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../index.js';
import type { LogEntry } from '@maru/shared';

function makeEntry(i: number, category = 'tiktok'): LogEntry {
  return {
    id: `e-${i}`,
    ts: 1000 + i,
    level: 'INFO',
    source: 'test',
    category: category as never,
    message: `msg ${i}`,
  };
}

describe('log-slice (micro-batch 50ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.getState().clearLog();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushLogEntry coalesce 100 entries en un solo flush', () => {
    const { pushLogEntry } = useAppStore.getState();
    for (let i = 0; i < 100; i++) pushLogEntry(makeEntry(i));

    // Antes del flush, las entries siguen en buffer (no commiteadas).
    expect(useAppStore.getState().logEntries.length).toBe(0);

    vi.advanceTimersByTime(60);

    // Después del flush, las 100 entries están en una sola operación.
    expect(useAppStore.getState().logEntries.length).toBe(100);
    expect(useAppStore.getState().logStatsTotal).toBe(100);
  });

  it('respeta MAX_BUFFER=500 — descarta las más viejas', () => {
    const { pushLogEntry } = useAppStore.getState();
    for (let i = 0; i < 700; i++) pushLogEntry(makeEntry(i));
    vi.advanceTimersByTime(60);

    const state = useAppStore.getState();
    expect(state.logEntries.length).toBe(500);
    // Quedan las últimas 500 (200..699).
    expect(state.logEntries[0].id).toBe('e-200');
    expect(state.logEntries[499].id).toBe('e-699');
  });

  it('agrega stats por categoría correctamente', () => {
    const { pushLogEntry } = useAppStore.getState();
    pushLogEntry(makeEntry(1, 'gift'));
    pushLogEntry(makeEntry(2, 'gift'));
    pushLogEntry(makeEntry(3, 'follow'));
    vi.advanceTimersByTime(60);

    const stats = useAppStore.getState().logStats;
    expect(stats.gift).toBe(2);
    expect(stats.follow).toBe(1);
    expect(useAppStore.getState().logStatsTotal).toBe(3);
  });

  it('logUnreadCount aumenta cuando autoScroll=false', () => {
    const { setLogAutoScroll, pushLogEntry } = useAppStore.getState();
    setLogAutoScroll(false);
    pushLogEntry(makeEntry(1));
    pushLogEntry(makeEntry(2));
    vi.advanceTimersByTime(60);
    expect(useAppStore.getState().logUnreadCount).toBe(2);
  });

  it('clearLog deja el buffer en 0', () => {
    const { pushLogEntry, clearLog } = useAppStore.getState();
    for (let i = 0; i < 10; i++) pushLogEntry(makeEntry(i));
    vi.advanceTimersByTime(60);
    expect(useAppStore.getState().logEntries.length).toBe(10);
    clearLog();
    expect(useAppStore.getState().logEntries.length).toBe(0);
    expect(useAppStore.getState().logStatsTotal).toBe(0);
  });
});
