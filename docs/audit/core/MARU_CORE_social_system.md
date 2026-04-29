# MARU Original — `core/social_system.py` + `core/social/` (588 + 2188 líneas)

> Sistema social completo: registro, duelos, interacciones, relaciones,
> rachas, taps, comandos de música/IA. Implementado vía multi-mixin.

## `SocialSystem` (588 líneas) — la clase orquestadora

### Herencia
```python
class SocialSystem(
    CombatMixin,           # core/social/combat.py (119 líneas)
    InteractionsMixin,     # core/social/interactions.py (368 líneas)
    UtilitiesMixin,        # core/social/utilities.py (228 líneas)
    StreaksRankingsMixin,  # core/social/streaks_rankings.py (397 líneas)
    MusicIAMixin,          # core/social/music_ia.py (148 líneas)
    AdminMixin,            # core/social/admin.py (293 líneas)
):
```

`_tarot_data.py` (586 líneas) es data-only — cartas del tarot.

## `COMMANDS_INFO` — 35 comandos definidos

### Por categoría:

#### `sistema` (2): `register, perfil`
#### `duelo` (6 — DUEL_COMMANDS): `golpe, batalla, pelea, patada, cachetada, duelo`
#### `interaccion` (11 — ACCEPT): `beso, abrazo, caricia, saludo, morder, bailar, regalo, flor, cafe, pizza, palmada`
#### `relacion` (4 — ACCEPT, single per type): `novios, casarse, mejoresamigos, rival`
#### `respuesta` (3 — RESPONSE): `dado, aceptar, rechazar`
#### `utilidad` (12 — UTILITY): `tarot, decision, mesa, racha, divorciar, terminar, amistad, paz, ranking, top, likes`
#### `musica` (5 — MUSIC): `play, skip, cola, pause, playfan`
#### `ia` (1 — IA): `ia`

### Sets pre-calculados
```python
DUEL_COMMANDS = {golpe, batalla, pelea, patada, cachetada, duelo}
ACCEPT_COMMANDS = {beso, abrazo, caricia, saludo, morder, bailar, regalo,
                   flor, cafe, pizza, palmada, novios, casarse, mejoresamigos, rival}
RESPONSE_COMMANDS = {dado, aceptar, rechazar}
UTILITY_COMMANDS = {decision, mesa, racha, divorciar, terminar, perfil,
                    amistad, paz, ranking, top, likes, tarot}
MUSIC_COMMANDS = {play, skip, cola, pause, playfan}
IA_COMMANDS = {ia}
SYSTEM_COMMANDS = {register}
ALL_COMMANDS = unión de los 7 sets
```

### `CATEGORIES` (8) con icono + name + desc
sistema, duelo, interaccion, relacion, respuesta, utilidad, musica, ia.

## Estado interno

### Constructor
```python
SocialSystem(data_dir, tts_callback, log_callback,
             tts_duel_callback=None, tts_fortune_callback=None)
```

- `data_file = data_dir / "social_data.json"`.
- `narrations_file = data_dir / "social_narrations.json"`.
- `taps_file = data_dir / "taps_data.json"`.
- 4 callbacks TTS (chat default, duel boost, fortune exclusivo).
- `spotify = None` — se setea desde GUI.
- `spotify_tts = True`.
- `ia_engine = IAEngine(log)` — siempre se crea.
- `_ia_speak_lock` — serializa respuestas IA.
- `_lock = RLock()` (re-entrant).
- `_save_lock = Lock()`.
- `_cooldowns: Dict[user, last_use_time]`.
- `_timeout_timer: Timer` — para acciones pendientes.
- `_music_global_log = []`.
- `_music_cooldowns = {}`.

### Configuración (de `social_data.json["config"]`)
- `enabled = True`.
- `require_register = True`.
- `cooldown_seconds = 5`.
- `timeout_seconds = 90` (para responder duelos).
- `volume` (clamped 0–1).
- `voice = ""` (default fallback `"es_mx_002"`).
- `enabled_commands` (set).
- **Auto-add new commands**: si `enabled_commands` se guardó con menos
  comandos que `ALL_COMMANDS` actual, agrega los nuevos automáticamente
  (vía `known_commands` para tracking).

## `process_command(user, text) → bool`

Returns `True` si el comando era social (consume el evento).

1. Skip si `not enabled` o no empieza con `!`.
2. Split en `parts = text[1:].split()`.
3. `cmd = parts[0].lower()` (verificar en `ALL_COMMANDS`).
4. Verificar `cmd in enabled_commands` (excepto `register` siempre activo).
5. Normaliza `user` y `target`.
6. **Lanza `_process_async` en thread daemon** (NO bloquea).

## `_process_async(cmd, user, target, raw_args)` — el dispatcher

Orden de evaluación:

1. **`register`** → `_cmd_register(user)`.
2. **Sin registro requerido**: `tarot, top, likes`.
3. **IA commands**: requiere registered. → `_cmd_ia(user, raw_args)`.
4. **Music commands**: requiere registered. → `_cmd_music(cmd, user, raw_args)`.
5. **Si no registered**: log silencioso (NO TTS — para no saturar).
6. **Sin target**: `decision, mesa, racha, perfil, divorciar, terminar,
   amistad/paz (con target), ranking`.
7. **Responses (sin cooldown)**: `dado, aceptar, rechazar`.
8. **Necesitan target**: si target no registered → log silencioso.
9. **Cooldown** por user (5s default) — silencioso si en cooldown.
10. **Acción en curso**: silenciar.
11. **No auto-interacción** (`user == target`).
12. **DUEL_COMMANDS** → `_start_duel(cmd, user, target)`.
13. **ACCEPT_COMMANDS** → `_start_accept(cmd, user, target)`.
14. `_set_cooldown(user)`.

## Mixins

### `CombatMixin` (combat.py · 119 líneas)
```python
_start_duel(cmd, u1, u2)    # Anuncia duelo, espera 90s para !dado
_cmd_dado(user)             # Tira dado, registra tirada
_resolve_duel()             # Compara dados al expirar timeout
```

### `InteractionsMixin` (interactions.py · 368 líneas)
```python
_start_accept(cmd, u1, u2)         # Pide a u2 !aceptar o !rechazar
_cmd_aceptar(user)
_cmd_rechazar(user)
_set_casados(u1, u2)               # Establece marriage (single per user)
_set_novios(u1, u2)                # Establece dating
_add_amigos(u1, u2)                # Best friends
_add_rivales(u1, u2)               # Rivals
_cmd_divorciar(user)
_cmd_terminar(user)                # Terminar noviazgo
_cmd_romper_amistad(user, target)
_cmd_hacer_paz(user, target)
```

### `UtilitiesMixin` (utilities.py · 228 líneas)
```python
_cmd_mesa(user)         # Tirar dados (1d6 o varios)
_cmd_tarot(user)        # Carta random de _tarot_data
_cmd_decision(user)     # Sí/No/Quizás/etc random
_cmd_perfil(user, target)
```

### `StreaksRankingsMixin` (streaks_rankings.py · 397 líneas)

**Rachas diarias**:
```python
_cmd_racha(user)         # Marca racha si no la marcó hoy. Incrementa o resetea.
get_auto_racha_status(user)  # ¿Tiene racha automática?
process_auto_rachas() → list  # Auto-mark al boot/cada hora
```

**Auto-racha**: el admin puede activar "rachar" automáticamente al
usuario por N días sin que tenga que escribir `!racha`. Se procesa
una vez por día (cuando el timer del MainWindow ejecuta cada 1h).

**Rankings**:
```python
_cmd_ranking()   # Top usuarios por racha
_cmd_top(user)   # Top 1 likes y top 1 racha
_cmd_likes(user) # Mis taps acumulados
```

**Taps (likes)**:
```python
record_tap(user, count)            # Llamado desde MainWindow.on_event
get_taps_ranking(periodo) → list   # "total" / "semanal" (7d) / "mensual" (30d)
get_user_taps(user) → dict
cleanup_inactive_taps() → int      # >7 días sin actividad, excepto top 3
cleanup_old_history()
get_taps_stats() → dict            # total_taps, total_users
```

### `MusicIAMixin` (music_ia.py · 148 líneas)
```python
_cmd_music(cmd, user, raw_args)  # Dispatcher de music commands
_music_speak(text)               # Habla con check de spotify_tts flag
_cmd_play(user, nombre, query)
_cmd_playfan(user, nombre, query)
_cmd_skip(nombre)
_cmd_cola(nombre)
_cmd_pause(nombre)
_cmd_ia(user, question)          # Llama ia_engine.ask + speak
_ia_speak(text)                  # Lock para serializar respuestas
```

### `AdminMixin` (admin.py · 293 líneas) — todos los métodos para SocialConfigDialog
```python
admin_get_user_data(user) → dict
admin_get_all_users() → list      # Lista completa para tabla del config
admin_get_registered_users() → list
admin_get_stats() → dict
admin_reset_racha(user)
admin_set_racha(user, dias)
admin_activate_auto_racha(user, dias) → (bool, msg)
admin_deactivate_auto_racha(user) → (bool, msg)
admin_remove_marriage(user)
admin_remove_relationship(user, rel_type)  # novios | amigo | rival
admin_reset_relaciones(user)
admin_register_user(user)
admin_unregister_user(user)
admin_delete_user(user)
admin_reset_all()                # ⚠️ Borra TODO con doble confirm en GUI
```

## Esquema de `social_data.json`

```json
{
  "users": {
    "<user_norm>": {
      "registered": bool,
      "registered_at": "<iso>",
      "display_name": "<original>",
      "racha": {"dias": int, "record": int, "last_marked": "<iso>"},
      "casado_con": "<user>"|null,
      "casado_desde": "<iso>",
      "novios_con": "<user>"|null,
      "novios_desde": "<iso>",
      "mejor_amigo": "<user>"|null,
      "mejor_amigo_desde": "<iso>",
      "rival": "<user>"|null,
      "rival_desde": "<iso>",
      "stats": {"duelos_ganados": int, "duelos_perdidos": int},
      "auto_racha": {"activa": bool, "dias_totales": int, "dias_restantes": int}
    }
  },
  "config": { ... },
  "stats": {
    "total_duelos": int,
    "total_interacciones": int,
    "total_matrimonios": int,
    "total_divorcios": int,
    "total_noviazgos": int,
    "total_rupturas": int
  }
}
```

## Esquema de `taps_data.json`

```json
{
  "users": {
    "<user_norm>": {
      "username": "<display>",
      "total_taps": int,
      "history": [{"date": "<YYYY-MM-DD>", "count": int}, ...]
    }
  }
}
```

## Esquema de `social_narrations.json`

Diccionario `{narration_key: [template1, template2, ...]}` con variables
`{user}, {target}, {value}, {gane}, {pierde}` etc. Los métodos llaman
`_narrate(key, **vars)` que elige random uno y formatea.

## Notas para el port

- **6 mixins en core/social/** — replicar como módulos similares en el
  sidecar Python. NO mezclar todo en un solo archivo.
- **35 comandos** son CRÍTICOS — no perder ninguno. Cada uno con su
  emoji + categoría + tipo (utility/duel/accept/response).
- **Auto-add new commands**: el `enabled_commands` set se actualiza
  automáticamente cuando agregamos comandos nuevos (vía `known_commands`).
- **Race conditions**:
  - `_lock = RLock()` para acciones pendientes.
  - `_save_lock` para escribir social_data.json.
  - `_ia_speak_lock` para serializar respuestas IA TTS.
- **Acciones pendientes** (duelos, accepts) tienen `timeout_seconds`
  default 90s. Si nadie responde, se cancelan.
- **`require_register` silenciado**: NO da TTS al user no registrado, solo
  log. Esto evita saturar el TTS en streams concurridos.
- **`process_auto_rachas()`** se llama desde el MainWindow cada 1h
  (`_auto_racha_timer`). Procesa users con auto-racha activa.
- **Tarot data en `_tarot_data.py`** (586 líneas) — replicar el JSON
  data del tarot (cartas + interpretación) en el port.
- **Narraciones en JSON** — permite editar mensajes sin tocar código.
