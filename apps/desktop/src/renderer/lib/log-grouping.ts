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
 * Suma de `count` (likes / gifts) — para likes el sidecar mete el count
 * real del batch del worker en `meta.count`. Para entries sin meta,
 * cada entry vale 1.
 */
export function entryCount(e: LogEntry): number {
  const meta = (e.meta ?? {}) as Record<string, unknown>;
  const c = typeof meta.count === 'number' ? meta.count : Number(meta.count);
  return Number.isFinite(c) && c > 0 ? Math.floor(c) : 1;
}

/**
 * Agrupa eventos `like|gift|share|...` del mismo (categoría, user) que
 * caigan dentro de una ventana sliding de 60s.
 *
 * Cambio v1.0.46 (bug raíz): la versión previa exigía CONSECUTIVOS
 * estrictos. Si en medio de una racha de 50 likes de @gottina llegaba
 * un comment de @otro, el bucket de gottina se rompía y los siguientes
 * likes de gottina aparecían como entries individuales — la app
 * mostraba "@gottina dio 2 likes" + "@gottina dio 15 likes" sin
 * agrupar. Ahora cada (categoría, user) tiene UN bucket activo dentro
 * de la ventana 60s; entries del mismo (cat, user) se SUMAN al bucket
 * existente aunque haya entries intercalados de otros users.
 *
 * El bucket se renderiza en la posición del PRIMER entry — los
 * siguientes "desaparecen" del flujo individual y solo aparecen
 * expandidos al click del chevron.
 *
 * `count` del bucket = Σ entryCount(e) — para likes con meta.count=N
 * agregamos N, no 1. Visualmente: "@gottina × 47 likes".
 *
 * Estable: dos llamadas con la misma `entries` producen IDs idénticos.
 */
export function groupConsecutive(entries: readonly LogEntry[]): LogItem[] {
  if (entries.length === 0) return [];

  // Pase 1: identificar buckets candidatos (multi-entry del mismo
  // (cat, user) dentro de la ventana). Anchor = índice del PRIMER
  // entry del bucket.
  const bucketByKey = new Map<string, number>(); // key → anchorIdx
  const memberToAnchor = new Map<number, number>(); // entryIdx → anchorIdx
  const anchorMembers = new Map<number, number[]>(); // anchorIdx → [entryIdx]

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (!GROUPABLE.has(e.category)) continue;
    const user = entryUser(e);
    if (!user) continue;
    const key = `${e.category}::${user}`;
    const anchorIdx = bucketByKey.get(key);
    if (anchorIdx !== undefined) {
      const anchor = entries[anchorIdx]!;
      // Ventana sliding desde el anchor (no desde el último para que la
      // racha no se "extienda" indefinidamente con goteo).
      if (e.ts - anchor.ts <= COHESION_WINDOW_MS) {
        memberToAnchor.set(i, anchorIdx);
        const list = anchorMembers.get(anchorIdx) ?? [anchorIdx];
        list.push(i);
        anchorMembers.set(anchorIdx, list);
        continue;
      }
      // Pasó la ventana — empieza nuevo bucket con este como anchor.
    }
    bucketByKey.set(key, i);
    anchorMembers.set(i, [i]);
  }

  // Pase 2: emitir output. Cada anchor con ≥ MIN_BUCKET_SIZE → bucket;
  // sino → entries individuales.
  const out: LogItem[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const anchorIdx = memberToAnchor.get(i);
    if (anchorIdx !== undefined && anchorIdx !== i) {
      // Este entry pertenece a un bucket cuyo anchor ya fue procesado
      // antes — lo absorbemos, no lo emitimos.
      continue;
    }
    const members = anchorMembers.get(i);
    if (!members || members.length < MIN_BUCKET_SIZE) {
      out.push(e);
      continue;
    }
    const bucketEntries = members.map((idx) => entries[idx]!);
    const last = bucketEntries[bucketEntries.length - 1]!;
    let total = 0;
    for (const be of bucketEntries) total += entryCount(be);
    out.push({
      id: `bucket::${e.category}::${entryUser(e)}::${e.id}`,
      type: 'bucket',
      category: e.category,
      user: entryUser(e),
      entries: bucketEntries,
      count: total,
      firstTs: e.ts,
      lastTs: last.ts,
    });
  }
  return out;
}
