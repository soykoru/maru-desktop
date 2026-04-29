# MARU Original — `core/games.py` (696 líneas)

> Adaptadores de juegos. 3 predefinidos hardcoded + CustomGame configurable.

## Infraestructura compartida

```python
EX = ThreadPoolExecutor(max_workers=50)   # ⭐ Pool global async
_thread_local = threading.local()         # Session por thread
```

### `_get_session() → requests.Session` (thread-local)
```python
s = requests.Session()
s.trust_env = False     # Ignora env vars HTTP_PROXY etc
```

## `BaseGame` (interfaz)

Métodos:
- `test_connection() → (bool, msg)`.
- `spawn(entity, amount, user) → (bool, msg)`.
- `give_item(item, amount, user) → (bool, msg)`.
- `trigger_event(event, user) → (bool, msg)`.

## `ValheimGame(BaseGame)` (puerto 5000)

**Endpoints REALES**:
- `POST /spawn` — entidades + items (`{entity_name, amount}`).
- `POST /event` — eventos (`{event_name, value}`).
- `GET /status` — health check.

### Eventos disponibles (hardcoded en docstring)
- Gameplay: `kill_player, clear_inventory, set_day, set_night,
  kill_all_enemies, heal_player, reset_stats, max_stats,
  damage_player <value>, remove_stamina <value>, teleport_random`.
- Raids: `army_eikthyr, army_theelder, army_bonemass, army_moder,
  army_goblin, foresttrolls, blobs, skeletons, surtlings, wolves`.

### `test_connection()` (cascading)
1. `GET /status` (timeout 0.5s).
2. `POST /spawn {}` (timeout 0.5s).
3. `socket.connect_ex` al puerto.

### `spawn(entity, amount, user)` / `give_item(item, amount, user)`
Mismo endpoint `/spawn`. Submit a `EX` (fire-and-forget). Returns
`(True, msg)` SIN esperar respuesta del juego.

### `trigger_event(event, user)`
Parsea `event` con `split(" ", 1)`:
- `parts[0]` = `event_name`.
- `parts[1]` = value (int si parsea, sino 0).

Ejemplo: `"damage_player 50"` → `{event_name: "damage_player", value: 50}`.

## `TerrariaGame(BaseGame)` (puerto 5000)

**Endpoints**:
- `POST /spawn/` — entidades + items.
- `POST /command/` — comandos (`{command, value}`).

### Comandos disponibles
`kill, heal, clear, godmode, clearitems, clearnpcs, time day, time night, tp`.

### `trigger_event(event, user)`
Parsea con split:
- `command = parts[0]`
- `value = parts[1] if len > 1 else ""`.

Ejemplo: `"time day"` → `{command: "time", value: "day"}`.

## `MinecraftRCON` (cliente RCON puro)

Implementación de **protocolo RCON** sobre TCP:
- `connect()`: socket → send packet type `3` (auth) con password →
  verify response.
- `cmd(c) → str`: send packet type `2` (command) → returns body.
- `_send(t, b)`: pack `<ii` (rid, type) + UTF-8 bytes + `\x00\x00`.
- `_recv()`: read length (4 bytes), read packet, return `{id, body}`.
- Validación: packet size 10–4096 bytes (rechaza tamaños fuera de rango).

Timeout 10s para comandos largos.

## `MinecraftGame(BaseGame)` (puerto 25575 default)

Variables disponibles en comandos:
- `{user}`, `{username}` — sanitizados con
  `''.join(ch for ch in user if ch.isalnum() or ch in "_- ")`.

### `test_connection()`
- Si no hay password: `False, "Sin password RCON"`.
- Conecta + close (no ejecuta comando — ahorra RAM).

### `test_command(cmds, user) → (bool, msg)`
1. Split por `\n`.
2. Conecta RCON.
3. Por cada cmd: replace `{user}`/`{username}`, ejecuta, captura response.
4. **Detecta errores Minecraft** en response: `"Unknown" / "<--[HERE" /
   "error"`.
5. Returns first error o first success.

### `execute_commands(cmds, times, user)`
Submit a `EX`. Itera `times` × cada line del cmds. Fire-and-forget.

### `spawn(cmd, amt, user)` → `execute_commands(cmd, amt, user)`.
### `give_item(cmd, amt, user)` → `execute_commands(cmd, 1, user)` (cantidad va en el comando).
### `trigger_event(cmd, user)` → `execute_commands(cmd, 1, user)`.

## `CustomGame(BaseGame)` — el juego configurable

Constructor recibe `config dict` con TODA la config:
```python
{
  "host", "port", "name",
  "connection_type": "http" | "rcon",
  # HTTP:
  "spawn_endpoint", "item_endpoint", "event_endpoint",
  "spawn_payload", "item_payload", "event_payload",
  "http_method": "POST" | "GET",
  # RCON:
  "rcon_password",
  "rcon_spawn_cmd", "rcon_item_cmd", "rcon_event_cmd",
  # Features:
  "has_entities", "has_items", "has_events"
}
```

### Variables del payload templating
- `{entity}` — nombre del entity/item.
- `{amount}` — cantidad.
- `{user}` / `{username}` — sanitizado (alphanum + `_- `).
- `{command}` — para events.
- `{value}` — para events con valor.

### `_build_payload(template, ...)` → dict
Reemplaza variables en template, intenta `json.loads`. Si falla, retorna
`{entity_name: entity, amount: amount}` como fallback.

### `_build_rcon_cmd(template, ...)` → str
Reemplaza variables en template (sanitizando user).

### `_send_http(endpoint, payload)`
Submit a `EX`. Si `http_method == "GET"`: `requests.get(url, params=...)`.
Sino: `requests.post(url, json=...)`. Timeout 0.5s.

### `_send_rcon(cmd, times)`
Submit a `EX`. Crea `MinecraftRCON`, ejecuta el cmd `times` veces, close.

### `spawn / give_item / trigger_event`
- Verifican `has_entities/has_items/has_events`.
- Construyen payload o cmd.
- Llaman `_send_http` o `_send_rcon`.

### `test_connection()`
- HTTP: cascading (GET / → POST spawn_endpoint → socket).
- RCON: `MinecraftRCON.connect() + close()`.

## Notas para el port

- **Pool global `EX = ThreadPoolExecutor(max_workers=50)`** — todos los
  juegos lo comparten. En el sidecar Python: replicar idéntico para
  consistencia.
- **Fire-and-forget** es CRÍTICO — el juego retorna `True` antes de
  que el HTTP llegue al server. Esto permite que el `_execute()` del
  rule_engine sea instantáneo.
- **Templating de payload** soporta JSON con variables embebidas — el
  template se reemplaza COMO STRING antes de `json.loads`. Esto permite
  payloads complejos: `'{"items": [{"name": "{entity}", "qty": {amount}}]}'`.
- **MinecraftRCON** es implementación pura del protocolo. Replicar en
  Node.js con `rcon-client` o equivalente, o mantener Python en sidecar.
- **Eventos hardcoded de Valheim/Terraria**: están en docstrings. El
  port debe documentar la misma lista para que el usuario sepa qué
  eventos puede triggerear.
