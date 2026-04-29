import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Activity,
  ChevronDown,
  Clock,
  Download,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { Button, Card, CardBody, Empty, Input } from '@maru/ui';
import { useLog } from '../lib/use-log.js';
import {
  FilterPills,
  LogEntryRow,
  StatsCounters,
  SystemHealthWidget,
} from './log/index.js';

/**
 * `LogPanel` (G11) — log estructurado en tiempo real.
 *
 * Estructura:
 *   - Stats counters (6) compactos.
 *   - SystemHealthWidget (4 indicadores).
 *   - Log con auto-scroll inteligente + filter pills + toolbar.
 *
 * Auto-scroll: se desactiva si el usuario hace scroll-up; aparece un
 * floating "↓ N nuevos" para volver al final.
 *
 * Filtros: 8 pills (chat / gifts / social / rules / spotify / tts /
 * sistema / errores) que agrupan las 19 categorías granulares del sidecar.
 *
 * Trim a 500 entries (lo hace el slice). Lista renderizada simple
 * (sin virtualización) — con 500 entries de ~30px = ~15K px scroll
 * que el browser maneja sin lag.
 */
export function LogPanel(): ReactNode {
  const log = useLog({ autoLoad: true });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastEntryIdRef = useRef<string | null>(null);

  // Auto-scroll al fondo cuando llegan nuevas entries y autoScroll=true.
  useEffect(() => {
    if (!log.autoScroll) return;
    const last = log.visible[log.visible.length - 1];
    if (!last) return;
    if (last.id === lastEntryIdRef.current) return;
    lastEntryIdRef.current = last.id;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [log.visible, log.autoScroll]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (atBottom !== log.autoScroll) {
      log.setAutoScroll(atBottom);
    }
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      log.setAutoScroll(true);
    }
  }

  // Counts por grupo (para los pills) — alineado con GROUP_TO_CATEGORIES.
  const groupCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of log.entries) {
      switch (e.category) {
        case 'comment':
        case 'command':
          out.chat = (out.chat ?? 0) + 1;
          break;
        case 'gift':
          out.gifts = (out.gifts ?? 0) + 1;
          break;
        case 'emote':
          out.emotes = (out.emotes ?? 0) + 1;
          break;
        case 'follow':
        case 'share':
        case 'like':
        case 'subscribe':
          out.eventos = (out.eventos ?? 0) + 1;
          break;
        case 'rule':
        case 'action':
          out.rules = (out.rules ?? 0) + 1;
          break;
        case 'social':
          out.social = (out.social ?? 0) + 1;
          break;
        case 'music':
        case 'tts':
        case 'sound':
          out.audio = (out.audio ?? 0) + 1;
          break;
        case 'error':
        case 'warn':
          out.errores = (out.errores ?? 0) + 1;
          break;
        default:
          out.sistema = (out.sistema ?? 0) + 1;
      }
    }
    return out;
  }, [log.entries]);

  return (
    <>
      <Card className="shrink-0">
        <CardBody className="py-2 px-3">
          <StatsCounters stats={log.stats} />
        </CardBody>
      </Card>

      <Card className="shrink-0">
        <CardBody className="!py-1 !px-0">
          <SystemHealthWidget />
        </CardBody>
      </Card>

      <Card className="relative flex-1 flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 bg-bg-elev/30">
          <FilterPills
            active={log.activeGroups}
            onToggle={log.toggleGroup}
            onSetAll={(g) => {
              // Aplica el set objetivo: vacío = desactivar TODOS,
              // lleno = activar todos. Toggle individual donde difiere.
              for (const grp of [
                'chat',
                'gifts',
                'emotes',
                'eventos',
                'rules',
                'social',
                'audio',
                'sistema',
                'errores',
              ] as const) {
                const shouldHave = g.has(grp);
                const isHave = log.activeGroups.has(grp);
                if (shouldHave !== isHave) log.toggleGroup(grp);
              }
            }}
            counts={groupCounts}
          />
        </div>

        <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 bg-bg-elev/20">
          <Input
            prefix={<Search className="h-3 w-3" />}
            placeholder="Buscar en log..."
            value={log.search}
            onChange={(e) => log.setSearch(e.target.value)}
            className="flex-1 h-7 text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => log.setShowTimestamps(!log.showTimestamps)}
            title={log.showTimestamps ? 'Ocultar timestamps' : 'Mostrar timestamps'}
            className="!h-7 !px-2"
          >
            <Clock className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void log.exportLog()}
            disabled={log.entries.length === 0}
            title="Exportar log a TXT"
            className="!h-7 !px-2"
          >
            <Download className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void log.resetStatsRemote()}
            title="Resetear contadores"
            className="!h-7 !px-2"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void log.clearRemote()}
            title="Limpiar log"
            className="!h-7 !px-2"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 min-h-0 overflow-y-auto px-2 py-1 bg-bg-base/30"
        >
          {log.visible.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Empty
                icon={Activity}
                title={
                  log.entries.length === 0
                    ? 'Log vacío'
                    : 'Sin entradas que coincidan'
                }
                description={
                  log.entries.length === 0
                    ? 'Cuando lleguen eventos los vas a ver acá en tiempo real.'
                    : 'Probá ajustar los filtros o el texto de búsqueda.'
                }
              />
            </div>
          ) : (
            log.visible.map((e) => (
              <LogEntryRow
                key={e.id}
                entry={e}
                showTimestamp={log.showTimestamps}
              />
            ))
          )}
        </div>

        {!log.autoScroll && log.unreadCount > 0 && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="absolute bottom-8 right-3 z-10 flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-bg shadow-lg hover:scale-105 transition-transform"
          >
            <ChevronDown className="h-3 w-3" />
            {log.unreadCount} nuevos
          </button>
        )}

        <div className="border-t border-border px-3 py-1 text-[10px] text-fg-subtle bg-bg-elev/20 flex items-center justify-between">
          <span>
            {log.visible.length} de {log.entries.length} · max 500
          </span>
          <span>{log.autoScroll ? '🟢 auto-scroll' : '⏸ pausado'}</span>
        </div>
      </Card>
    </>
  );
}
