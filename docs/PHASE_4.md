# Fase 4 — Migración pestaña por pestaña

**Objetivo**: reemplazar todos los stubs del sidecar por adapters reales y
poblar las 9 pantallas restantes con UIs conectadas a esos adapters.

## Adapters reales en sidecar

Reemplazos completos de `stubs.py`:

| Dominio | Archivo | Persistencia | Push events |
|---|---|---|---|
| `rules.*` | `backend/rules.py` | `data/rules_<game>.json` atómico + backup auto | `rules:fired` (F1 ya tipado) |
| `data.*` | `backend/data_catalog.py` | `data/data_<game>.json` con 3 kinds | — |
| `games.*` | `backend/games.py` | `data/games.json` config; instancias lazy | — |
| `social.*` | `backend/social.py` | core.SocialSystem (lazy) | `social:update` |
| `spotify.*` | `backend/spotify.py` | core.SpotifyClient (lazy) | `spotify:now-playing` |
| `ia.*` | `backend/ia.py` | core.IAEngine (lazy) | — |
| `tts.*` | `backend/tts.py` | core.TTSEngine (lazy) | — |
| `overlays.*` | `backend/overlays.py` | core.OverlayClient (lazy) | — |
| `profiles.*` | `backend/profiles.py` | `runtime/profiles/<id>/` con sha256 | — |
| `logs.*` | `backend/logs.py` | tail de `runtime/logs/sidecar.log` | — |

**Garantías de robustez**:
- **Escritura atómica** (`.tmp` + `os.replace`) en todo write — nunca dejas
  el archivo a medio escribir si crashea.
- **Backup automático** antes de mutar archivos existentes.
- **Validación** de shape (id, trigger.kind, action.kind) — la UI puede ser
  permisiva, pero el sidecar nunca persiste basura.
- **Lock por servicio** evita races en mutaciones concurrentes.
- **Lazy import del core** — cargas Qt/spotipy/etc solo cuando los usás.

## Nuevos métodos en el contrato

Sumados al existente:
- `rules.reorder(gameId, orderedIds)` — drag-and-drop server-side.
- `data.list/upsert/delete/import/export(gameId, kind, …)`.
- `profiles.save/load/duplicate/delete/export/import`.
- `logs.tail(lines, level)`.

## Páginas nuevas

### Reglas (`/rules`)
- Tabs por juego (Valheim/Terraria/Minecraft/Custom).
- Lista a la izquierda con toggle inline, reorder con flechas, eliminar.
- Editor a la derecha: nombre + trigger (con campos condicionales por kind:
  giftName/minDiamonds, minLikes, pattern, command name) + acciones
  múltiples (spawn/give_item/trigger_event/tts) con campos específicos.
- Switch "Aleatoria" para `randomPick`.
- Botones Test (dry-run vía RPC) y Guardar.
- Toasts en cada operación.

### Datos por juego (`/data`)
- Tabs por juego × tabs internas por kind (Entidades/Items/Eventos).
- Búsqueda con debounce 200ms (server-side, case-insensitive en name+command).
- Edit inline: click en una entry → form arriba con name/command, Save/Cancelar.
- Botón Añadir con form vacío.
- Eliminar con confirmación visual (toast de info).
- Import desde JSON file (modo append por default).
- Export a JSON file con nombre `<game>_<kind>.json`.

### Social, Spotify, IA, Overlays
- **Social**: lectura de config con fallback de Empty si SocialSystem no
  inicializa (no rompe la app si pygame no está).
- **Spotify**: now-playing con barra de progreso, botones play/pause/skip
  conectados al `SpotifyClient` real, refresh cada 5s.
- **IA**: status del engine (provider+model), input de prueba con user+pregunta,
  respuesta inline.
- **Overlays**: galería con cards (gradient banner), botones copy URL / test /
  reload. Cliente lazy.

### Stream Profiles (`/profiles`)
- Lista de cards con name + sha256 (truncado) + descripción + fecha.
- Botones Cargar (con confirm), Duplicar, Exportar.
- Diálogo "Guardar perfil actual" con name + description.
- Importar desde JSON file.
- Eliminar con confirm.

### Logs (`/logs`)
- Lectura de `runtime/logs/sidecar.log` (rotación 5MB×5) cada 2s.
- Filtro por contenido + segmented buttons por nivel
  (all/info/warning/error/debug).
- Auto-scroll al final.
- Botones Copiar (todo el contenido filtrado) y Limpiar vista.
- Cada línea con Badge color por nivel detectado en el formato.

## Mejoras estructurales

### Logger persistente
`logger.py` ahora monta un `RotatingFileHandler` además del StreamHandler.
Esto:
1. Habilita `logs.tail` real.
2. Sobrevive al cierre de la app — podés diagnosticar problemas posthoc.
3. Rotación automática para no llenar el disco.

### Stream Profiles vs. backup
Profiles **no son backups**: son snapshots **completos y portables**
(rules + data + games + config + social_narrations) con hash SHA-256 para
detectar drift. Pueden exportarse/importarse entre máquinas.

Backups (de F1) son automáticos por scope, viven en `runtime/backups/`,
tienen retención dual y son por-archivo, no por-snapshot.

## Tests

**32/32 pasan** (vs 14 al cierre F1):
- 4 — registry / handshake (F0).
- 5 — backups (F1).
- 2 — event bus (F1).
- 3 — registry expandido (F1, ahora con 50+ métodos).
- 6 — rules (CRUD + reorder + validación).
- 7 — data catalog (CRUD + búsqueda + import replace + export).
- 5 — profiles (save/load/duplicate/export-import roundtrip/delete).

```
cd apps/sidecar && python -m pytest tests -q
# 32 passed in 0.65s
```

## Decisiones tomadas en F4

1. **Reorder con flechas**, no drag-and-drop, en F4. dnd-kit
   añade ~30 KB y hace falta poco para ese impacto. Si más adelante
   querés DnD lo metemos en F6.
2. **Dialog HTML5 nativo (`confirm`/`prompt`)** para acciones destructivas
   de Profiles. Evita stack adicional; reemplazables por nuestro `Dialog`
   más adelante.
3. **Profiles guardan JSON puro, no ZIP**. Permite leer/diff entre dos
   profiles desde cualquier editor de texto. El export es JSON con
   `{meta, files: { "rules/rules_valheim.json": {...} }}`.
4. **Filtros server-side en Datos**. Mejor para listas grandes (>5k items
   en juegos custom) y mantiene el cliente liviano.
5. **`previousName` en `data.upsert`** permite rename atómico (cambiar el
   `name` que es la clave) sin generar duplicados.

## Pendiente para Fase 5

- Auto-update con `electron-updater` + GitHub Releases.
- Telemetría opcional (Sentry).
- Hardening de production (DevTools off, navegación bloqueada).
