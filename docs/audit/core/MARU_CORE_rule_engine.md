# MARU Original — `core/rule_engine.py` (627 líneas)

> Motor de reglas: trigger → action(s). Soporta multi-action,
> random_action, allowed_users, cooldown, TTS por regla.

## Funciones top-level

```python
parse_entry(entry: str) → Tuple[str, str]   # "Nombre:Comando" → (nombre, cmd)
get_display_name(entry: str) → str
get_command(entry: str) → str
```

Si no hay `:` en el entry, asume `display_name == command`.

## `@dataclass Rule`

```python
id: str
name: str
enabled: bool
trigger_type: str             # gift, follow, share, command, subscribe, member, like, like_milestone
trigger_value: str
action_type: str              # spawn, give_item, trigger_event, spawn_valuable (legacy)
action_value: str             # display_name (legacy)
amount: int = 1
cooldown: int = 0
tts_enabled: bool = False
tts_message: str = ""
tts_voice: str = ""
commands: str = ""            # RCON commands (Minecraft) — multi-line
allowed_users: List[str] = []
actions: List[dict] = []      # ⭐ MODERN: multi-action
random_action: bool = False   # ⭐ MODERN: ejecutar UNA al azar
last_used: float = 0
```

### `to_dict()` / `from_dict(d)` con backward-compat
- `from_dict` rellena defaults si faltan keys.
- `id` se genera con `uuid.uuid4()[:8]` si no viene.

### `can_trigger(user) → bool`
- Cooldown: `time.time() - last_used < cooldown` → False.
- Allowed_users: `user.lower().strip().replace("@", "")` debe estar
  en la lista. Si la lista está vacía, allow all.

### `mark_used()`
`self.last_used = time.time()`.

## `GameProfile`

```python
GameProfile(game_id: str, data_dir: Path)
```

Atributos:
- `rules_file = data_dir / f"rules_{game_id}.json"`.
- `data_file = data_dir / f"data_{game_id}.json"`.
- `rules: List[Rule]`.
- `entities, items, events, valuables: List[str]`.
- `_extra_data: Dict[str, List[str]]` — categorías custom (data_keys
  que no están en las 4 fijas).

### `load()` y `save()`
- Lee/escribe ambos archivos JSON.
- `data_*.json` formato:
  ```json
  {
    "entities": [...],
    "items": [...],
    "events": [...],
    "valuables": [...],
    "<custom_key>": [...]   // categorías dinámicas
  }
  ```
- `rules_*.json`:
  ```json
  { "rules": [...] }
  ```

### `get_category_data(data_key)` / `set_category_data(data_key, data)`
Mapea `entities/items/events/valuables` a sus listas, resto a `_extra_data`.

### `get_display_*()` — listas con solo display_name (sin `:Cmd`).

### CRUD reglas
```python
add_rule(rule_data: dict)       # genera id
update_rule(rule_id, rule_data) # preserva id
delete_rule(rule_id)
toggle_rule(rule_id)
```

### Búsqueda fuzzy de comandos · `find_command(action_type, display_name)`

Mapea `action_type` a la lista (`spawn → entities`, etc) y llama
`_search_in_source`:

1. Match exacto `display_name.lower() == search.lower()`.
2. Match exacto del **comando** (ya viene como comando directo).
3. Match flexible (sin emojis):
   - Quita non-alfanumeric: `''.join(c for c in name if c.isalnum() or c.isspace())`.
   - `search_clean in name_clean or vice versa`.
   - Match palabra por palabra (palabras de 3+ chars).
4. Si no encuentra: retorna el `display_name` original (fallback).

> Esto permite que el usuario escriba "Troll" y matche "Troll Furioso".

### `find_command_in_category(data_key, display_name)`
Mismo algoritmo pero limitado a una categoría específica.

## `RuleEngine`

```python
RuleEngine(data_dir: Path, games: Dict, tts=None)
```

### Atributos
- `profiles: Dict[str, GameProfile]` — uno por juego.
- `custom_action_callback` — callback `(game_id, action_type, command,
  amount, user) → (bool, msg)` para juegos custom (lo provee la GUI).
- `custom_games_config: Dict[str, dict]`.
- `_counters_lock = threading.Lock()`.
- `_like_counters: Dict[rule_id, Dict[user, count]]` — para `like` triggers.
- `_reached_milestones: Dict[rule_id, set]` — para `like_milestone`.
- `_total_likes` — total acumulado.

### Init
1. Carga 3 perfiles predefinidos: `valheim, terraria, minecraft`.
2. `load_custom_profiles()` — busca `data_*.json` y crea perfiles que
   no existan.

### `process_event(game_id, event_type, data) → List[result]`

Para cada regla habilitada del perfil:
1. `rule.can_trigger(user)` (cooldown + allowed_users).
2. `_matches(rule, event_type, data)`.
3. Lee `trigger_times` del rule (set por `_matches` para likes).
4. Ejecuta `_execute()` × `trigger_times`.
5. `rule.mark_used()`.
6. Si `tts_enabled`: replace `{user}/{username}` y llama `tts.speak()`.

### `_matches(rule, event_type, data)` por tipo

| event_type | Lógica |
|------------|--------|
| `gift` | `data.gift_name.lower() == trigger_value.lower()` (exact match — evita `cap` activar `capybara`) |
| `command` | Quita `!` inicial, exact match `cmd == trigger` |
| `like` | Acumulador por `(rule_id, user)`. Si `count >= likes_needed`, `_trigger_times = count // needed`, resetea remainder |
| `like_milestone` | Si `_total_likes >= target` y `target not in _reached_milestones[rule_id]`, marca y returns True |
| `follow / share / subscribe / member` | Always True |

### `_execute(game, profile, rule, data)` — ejecuta TODAS las acciones

Determina `count_multiplier`:
- `like / like_milestone` → 1 (ya se ejecuta múltiples veces).
- Otros → `data.count` (default 1).

Lista de acciones:
- Si `rule.actions`: usa esas (formato moderno).
- Si no: crea una sola desde campos legacy.

**`random_action` = True y len(actions) > 1**:
```python
selected = random.choice(actions_to_execute)
actions_to_execute = [selected]
```

Por cada acción:
1. Calcula `amt = action.amount * count_multiplier`.
2. Si `commands` está set: usa esos directos.
3. Si no: `profile.find_command(at_for_find, av)` (resolver display→cmd).
4. **Mapeo** `at` → `effective_at`:
   - `entity, entities, spawn` → `"spawn"`
   - `item, items, give_item` → `"give_item"`
   - `event, events, trigger_event` → `"trigger_event"`
   - `valuable, valuables, spawn_valuable` → `"spawn_valuable"`
5. **Ejecuta**:
   - Si `is_custom_game and custom_action_callback`: delega a GUI.
   - `spawn` → `game.spawn(command, amt, user)`.
   - `give_item` → `game.give_item(command, amt, user)`.
   - `trigger_event` → `game.trigger_event(command, user)`.
   - `spawn_valuable` → `game.spawn(command, amt, user)`.
6. Captura excepciones por acción (NO break — sigue con las demás).
7. Acumula mensajes y `all_ok`.

Retorna:
```python
{
  "rule": rule.name,
  "action": "<N> acciones" o action_type,
  "message": "msg1 | msg2 | ...",
  "success": all_ok
}
```

### `reset_like_counters()` — al conectar nuevo stream

## Notas para el port
- **Like trigger con counter por user**: el counter es por
  `(rule_id, user)` pero si user es `anon/anonymous/viewer/""` se mapea
  a `"global"`.
- **Like_milestone reached set**: persiste por sesión, no entre conexiones
  (se resetea con `reset_like_counters`).
- **Random_action** debe usarse `random.choice` (Python `random`) — en JS
  equivalente `arr[Math.floor(Math.random() * arr.length)]`.
- **Find_command fuzzy** es importante para que las reglas no se rompan
  cuando el usuario edita display names — replicar idéntico.
- **Multi-action ejecuta TODAS aunque alguna falle** — capturar
  excepciones por acción, NO abortar.
