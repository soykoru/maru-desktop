import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
// `useState` aquí lo usamos sólo para el flash visual del copy. La
// lista del log NO mantiene state local — sigue saliendo del slice.
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
import { isBucket } from '../lib/log-grouping.js';
import {
  FilterPills,
  LogBucketRow,
  LogEntryRow,
  StatsCounters,
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
  // Flag interno: cuando hacemos scroll programático no debe interpretarse
  // como gesto del user (sino el onScroll desactivaría autoScroll).
  // Usamos `useRef` para no causar re-renders.
  const programmaticScrollRef = useRef(false);
  // rAF coalescer — bajo ráfaga de eventos llegamos hasta 50/s; en vez de
  // setear `scrollTop` en cada one, lo hacemos UNA vez por frame. Ahorra
  // jank y mantiene el scroll pegado al fondo.
  const rafIdRef = useRef<number | null>(null);

  // Doble click en una fila → COPIA su texto al portapapeles. Marcamos
  // el id como "flashed" durante 600ms para dar feedback visual sin
  // alterar el contenido. Estado local — no toca sidecar.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const copyEntry = useCallback((id: string, text: string) => {
    // Bug raíz v1.0.51: `navigator.clipboard.writeText` en Electron
    // falla silenciosamente si la ventana no está estrictamente focused
    // o si no hay user-gesture trackeada en el handler. El feedback
    // verde aparecía pero el clipboard quedaba vacío. Fix: pasar al
    // main process via IPC (`clipboard.writeText` nativa) y usar
    // navigator.clipboard solo como fallback. También un fallback
    // execCommand por si IPC falla en algún edge case.
    let didCopy = false;
    const tryIpc = window.maruApi?.clipboard?.write;
    if (typeof tryIpc === 'function') {
      void tryIpc(text)
        .then((ok) => {
          didCopy = ok;
        })
        .catch(() => {
          didCopy = false;
        });
    }
    // Doble fallback para garantizar copy aunque IPC todavía no
    // esté disponible (transición de versiones, etc).
    try {
      void navigator.clipboard?.writeText(text).catch(() => undefined);
    } catch {
      /* swallow */
    }
    if (!didCopy) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        /* swallow */
      }
    }
    setCopiedId(id);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedId(null);
      copyTimerRef.current = null;
    }, 700);
  }, []);

  // Auto-scroll al fondo cuando llegan nuevas entries y autoScroll=true.
  // Bug raíz v1.0.42: usábamos `scrollTop = scrollHeight` PERO el
  // contenedor del log usa `content-visibility: auto` por fila
  // (`data-cv-auto-row` en globals.css). Esto hace que `scrollHeight`
  // dé un valor SUBESTIMADO mientras los hijos fuera del viewport no
  // están "materializados". Resultado: el scroll quedaba 1-2 filas
  // por debajo del fondo real cada vez que llegaba un evento.
  // Fix: scrollIntoView en el último hijo del contenedor → fuerza al
  // browser a hacer layout del nodo y scrollearlo a la vista. Cero
  // dependencia del scrollHeight calculado.
  useEffect(() => {
    if (!log.autoScroll) return;
    const last = log.visible[log.visible.length - 1];
    if (!last) return;
    if (last.id === lastEntryIdRef.current) return;
    lastEntryIdRef.current = last.id;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      programmaticScrollRef.current = true;
      const lastChild = el.lastElementChild;
      if (lastChild) {
        lastChild.scrollIntoView({ block: 'end', inline: 'nearest' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      // Liberamos el flag tras 2 frames — el onScroll del scroll
      // programático suele dispararse 1 frame después del set.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
      });
    });
  }, [log.visible, log.autoScroll]);

  // Cleanup del rAF si el componente se desmonta.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // Cleanup del timer del copy flash al desmontar.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    if (programmaticScrollRef.current) return;
    const el = e.currentTarget;
    // Threshold más generoso (60px en vez de 20) — el user puede mover la
    // rueda 1 click sin que se le desactive el autoscroll.
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom !== log.autoScroll) {
      log.setAutoScroll(atBottom);
    }
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (el) {
      programmaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      log.setAutoScroll(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
      });
    }
  }

  // Counts por grupo (para los pills) — granular, 1:1 con LogGroup.
  // Mapping de category → group espejado en useLog (filter logic).
  const groupCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of log.entries) {
      switch (e.category) {
        case 'comment':
          out.comments = (out.comments ?? 0) + 1;
          break;
        case 'command':
          out.commands = (out.commands ?? 0) + 1;
          break;
        case 'gift':
          out.gifts = (out.gifts ?? 0) + 1;
          break;
        case 'emote':
          out.emotes = (out.emotes ?? 0) + 1;
          break;
        case 'follow':
          out.follows = (out.follows ?? 0) + 1;
          break;
        case 'like':
          out.likes = (out.likes ?? 0) + 1;
          break;
        case 'share':
          out.shares = (out.shares ?? 0) + 1;
          break;
        case 'subscribe':
          out.subs = (out.subs ?? 0) + 1;
          break;
        case 'rule':
        case 'action':
          out.rules = (out.rules ?? 0) + 1;
          break;
        case 'social':
          out.social = (out.social ?? 0) + 1;
          break;
        case 'music':
          out.music = (out.music ?? 0) + 1;
          break;
        case 'ia':
          out.ia = (out.ia ?? 0) + 1;
          break;
        case 'tts':
        case 'sound':
          out.audio = (out.audio ?? 0) + 1;
          break;
        case 'fortune':
          out.fortune = (out.fortune ?? 0) + 1;
          break;
        case 'join':
          out.joins = (out.joins ?? 0) + 1;
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
          <StatsCounters entries={log.entries} />
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
              // DEBE incluir TODOS los LogGroup (espejo de log-slice
              // ALL_GROUPS y log-meta LOG_GROUPS) — sino el botón
              // "todos" deja afuera grupos como fortune/joins.
              for (const grp of [
                'comments',
                'commands',
                'gifts',
                'emotes',
                'follows',
                'likes',
                'shares',
                'subs',
                'rules',
                'social',
                'music',
                'ia',
                'fortune',
                'joins',
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

        {/* Toolbar — search + 4 botones de acción.
            Bug fix v1.0.34: el Trash2 se cortaba porque los botones no
            tenían `shrink-0` y el Input con `flex-1` les robaba espacio.
            Ahora cada botón tiene shrink-0 + el Input min-w-0 explícito,
            container con px-2 (era px-3) y gap-1 (era 1.5) para que
            quepa todo aún en ventanas estrechas. */}
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 bg-bg-elev/20">
          <Input
            prefix={<Search className="h-3 w-3" />}
            placeholder="Buscar en log..."
            value={log.search}
            onChange={(e) => log.setSearch(e.target.value)}
            className="flex-1 min-w-0 h-7 text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => log.setShowTimestamps(!log.showTimestamps)}
            title={log.showTimestamps ? 'Ocultar timestamps' : 'Mostrar timestamps'}
            className="!h-7 !w-7 !p-0 shrink-0"
          >
            <Clock className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void log.exportLog()}
            disabled={log.entries.length === 0}
            title="Exportar log a TXT"
            className="!h-7 !w-7 !p-0 shrink-0"
          >
            <Download className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void log.resetStatsRemote()}
            title="Resetear contadores"
            className="!h-7 !w-7 !p-0 shrink-0"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void log.clearRemote()}
            title="Limpiar log"
            className="!h-7 !w-7 !p-0 shrink-0"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          data-scroll-area
          className="flex-1 min-h-0 overflow-y-auto px-2 py-2 bg-bg-base/30 flex flex-col gap-1.5"
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
            log.visibleItems.map((item) => {
              const isCopied = copiedId === item.id;
              if (isBucket(item)) {
                // Para un bucket copiamos un resumen multilinea con las
                // entradas internas (timestamp + mensaje) — útil para
                // pegar en un reporte o investigar una racha.
                const text = item.entries
                  .map(
                    (e) =>
                      `[${new Date(e.ts).toTimeString().slice(0, 8)}] ${e.message}`,
                  )
                  .join('\n');
                return (
                  <div
                    key={item.id}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      copyEntry(item.id, text);
                    }}
                    title="Doble click para copiar las entradas de esta racha"
                    className={isCopied ? 'maru-log-copied-flash' : undefined}
                  >
                    <LogBucketRow
                      bucket={item}
                      showTimestamp={log.showTimestamps}
                    />
                  </div>
                );
              }
              const text = `[${new Date(item.ts).toTimeString().slice(0, 8)}] ${item.message}`;
              return (
                <div
                  key={item.id}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    copyEntry(item.id, text);
                  }}
                  title="Doble click para copiar esta entrada"
                  className={isCopied ? 'maru-log-copied-flash' : undefined}
                >
                  <LogEntryRow
                    entry={item}
                    showTimestamp={log.showTimestamps}
                  />
                </div>
              );
            })
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
