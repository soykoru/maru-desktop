/**
 * Agrupador de eventos consecutivos del log (FASE 3).
 *
 * Problema que resuelve:
 *   En vivo, un viewer puede mandar 30 likes seguidos o un streak de gift
 *   con repeat_count=20. Antes generaba 30/20 filas idénticas que solo se
 *   diferenciaban por timestamp, inundando el panel y enterrando el resto
 *   de eventos.
 *
 * Diseño:
 *   - Categorías agrupables: like, gift, share. Estas son las únicas
 *     donde un mismo user típicamente repite N veces en segundos.
 *   - Comments / commands NO se agrupan: cada uno tiene contenido único.
 *   - Ventana de cohesión: 60s. Si pasa >60s entre evento y evento del
 *     mismo user, se inicia un bucket nuevo (separa "racha actual" de
 *     "racha distinta más tarde").
 *   - Identidad del bucket: hash estable de
 *     `category::user::firstEntryId` — sobrevive a re-renders y mantiene
 *     el estado de expanded/collapsed en el store sin glitches.
 *   - Pure function — sin side effects, sin dependencias del store. Esto
 *     mantiene el cálculo memoizable y testeable.
 */

import type { LogCategory, LogEntry } from '@maru/shared';

// Categorías agrupables — eventos que típicamente llegan en ráfaga del
// MISMO usuario. Comments y commands del mismo user en menos de 60s
// también colapsan (caso real: spam de "hola" o ráfaga de !ia).
const GROUPABLE: ReadonlySet<LogCategory> = new Set<LogCategory>([
  'like',
  'gift',
  'share',
  'follow',
  'comment',
  'command',
  'sound',
]);

/** Distancia máxima entre eventos consecutivos para seguir en el mismo bucket. */
const COHESION_WINDOW_MS = 60_000;

/** Tamaño mínimo para colapsar (un evento solo no es bucket). */
const MIN_BUCKET_SIZE = 2;

export interface LogBucket {
  /** Identidad estable. Sobrevive a re-renders mientras el bucket exista. */
  id: string;
  /** Discriminador de tipo en la unión `LogEntry | LogBucket`. */
  type: 'bucket';
  category: LogCategory;
  /** Usuario común a todas las entradas del bucket. */
  user: string;
  /** Eventos contenidos en orden cronológico. */
  entries: LogEntry[];
  count: number;
  firstTs: number;
  lastTs: number;
}

export type LogItem = LogEntry | LogBucket;

export function isBucket(item: LogItem): item is LogBucket {
  return (item as LogBucket).type === 'bucket';
}

/**
 * Extrae el usuario asociado al evento. Prioridad: `meta.user` (lo setea
 * tiktok.py al loguear), luego un parser tolerante del prefijo `@user`.
 *
 * Retorna `''` si no hay usuario identificable — esos eventos NO se
 * agrupan (un like sin user no debe colapsarse con likes de otros).
 */
function entryUser(e: LogEntry): string {
  const meta = (e.meta ?? {}) as Record<string, unknown>;
  const u = typeof meta.user === 'string' ? meta.user : '';
  if (u) return u.toLowerCase();
  // Fallback 1: primer @user que aparezca en el mensaje.
  const m = /@([a-z0-9._]{2,30})/i.exec(e.message);
  if (m && m[1]) return m[1].toLowerCase();
  // Fallback 2: para categorías sin user (ej. sounds), usamos un
  // "discriminator" derivado del gift/event que disparó el sonido —
  // así dos rosas seguidas se agrupan en un bucket "rosa × N".
  const giftId = typeof meta.gift_id === 'string' ? meta.gift_id : '';
  if (giftId) return `gift:${giftId.toLowerCase()}`;
  const eventId = typeof meta.event_id === 'string' ? meta.event_id : '';
  if (eventId) return `event:${eventId.toLowerCase()}`;
  return '';
}

/**
 * Agrupa eventos consecutivos `like|gift|share` del mismo user que estén
 * dentro de la ventana de cohesión. Devuelve la lista mezclada de
 * `LogEntry` (eventos sueltos o categorías no agrupables) + `LogBucket`.
 *
 * Estable: dos llamadas con la misma `entries` producen IDs idénticos.
 * Memoizable a nivel React via `useMemo([entries])`.
 */
export function groupConsecutive(entries: readonly LogEntry[]): LogItem[] {
  if (entries.length === 0) return [];
  const out: LogItem[] = [];
  let bucket: LogEntry[] | null = null;

  const flushBucket = () => {
    if (!bucket || bucket.length === 0) return;
    if (bucket.length < MIN_BUCKET_SIZE) {
      // No vale la pena colapsar — push individual.
      for (const e of bucket) out.push(e);
    } else {
      const first = bucket[0]!;
      const last = bucket[bucket.length - 1]!;
      out.push({
        id: `bucket::${first.category}::${entryUser(first)}::${first.id}`,
        type: 'bucket',
        category: first.category,
        user: entryUser(first),
        entries: bucket.slice(),
        count: bucket.length,
        firstTs: first.ts,
        lastTs: last.ts,
      });
    }
    bucket = null;
  };

  for (const e of entries) {
    const cat = e.category;
    const user = entryUser(e);
    const groupable = GROUPABLE.has(cat) && Boolean(user);

    if (!groupable) {
      flushBucket();
      out.push(e);
      continue;
    }

    if (bucket) {
      const head = bucket[0]!;
      const prev = bucket[bucket.length - 1]!;
      const sameStream =
        head.category === cat &&
        entryUser(head) === user &&
        e.ts - prev.ts <= COHESION_WINDOW_MS;
      if (sameStream) {
        bucket.push(e);
        continue;
      }
      flushBucket();
    }
    bucket = [e];
  }
  flushBucket();
  return out;
}
