# MARU Original — Schemas JSON reales

> Producido en G0.7 · 2026-04-27.
> Fuente: `LiveChaosEngine_Refactored/data/`. Cada JSON documentado
> con schema completo + ejemplos REALES del usuario soykoru.

---

## 1. `config.json` (155 líneas) — settings primitivos + ia + spotify + games básicos

```jsonc
{
  // TTS
  "tts_volume": 17,                  // int 0-100
  "tts_enabled": false,              // bool — leer chat
  "default_voice": "es_002",         // voice_id (de TTSEngine.VOICES, 74 voces)

  // Estado actual
  "current_game": "terraria",        // game_id activo
  "tiktok_username": "soykoru",      // sin @

  // Conexiones de juegos (formato simple por juego)
  "games": {
    "valheim":   { "host": "localhost", "port": 5000 },
    "terraria":  { "host": "localhost", "port": 5000 },
    "minecraft": { "host": "67.222.136.239", "port": 7030, "password": "234" },
    // Custom games: incluyen full config
    "repo": {
      "name": "R.E.P.O.",
      "host": "127.0.0.1",
      "port": 5000,
      "connection_type": "http",
      "spawn_endpoint": "/", "item_endpoint": "/", "event_endpoint": "/",
      "spawn_payload":  "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
      "item_payload":   "{\"entity_name\": \"{entity}\", \"amount\": {amount}, \"type\": \"item\"}",
      "event_payload":  "{\"command\": \"{command}\", \"value\": \"{value}\"}",
      "http_method": "POST",
      "rcon_password": "",
      "rcon_spawn_cmd": "summon {entity}",
      "rcon_item_cmd":  "give {user} {entity} {amount}",
      "rcon_event_cmd": "{command}",
      "has_entities": true,
      "has_items": true,
      "has_events": true
    },
    "7_days_to_die": { ... mismo schema ... },
    "ror2":          { ... },
    "hytale":        { ... }
  },

  // Tema (8 inválidos — solo midnight en G+)
  "theme": "dracula",                // hay 9 temas, en G se reduce a "midnight"

  // Sonidos
  "sound_volume": 16,

  // Fortuna
  "fortune_enabled": true,
  "fortune_gift": "Heart Me",        // gift_id que dispara fortuna
  "fortune_voice": "es_002",         // voice_id (default "en_female_madam_leota")
  "fortune_volume": 33,

  // Sistema social
  "social_enabled": true,
  "social_cooldown": 10,             // seg
  "social_timeout": 90,              // seg para responder duelos
  "social_volume": 30,               // 0-100
  "social_voice": "",                // voice_id o "" para usar es_mx_002 default
  "social_require_register": true,

  // Voces
  "use_global_voices": true,         // bool — true = global_voices, false = profile_voices

  // Spotify (toda la sección)
  "spotify": {
    "enabled": true,
    "client_id": "<32-char hex>",
    "client_secret": "<32-char hex>",
    "device_id": "",
    "max_queue": 8,
    "priority_users": ["gottina", "cristian_rivasxd"],
    "priority_users_data": [
      { "user": "gottina",          "playfan_uses": 2 },
      { "user": "cristian_rivasxd", "playfan_uses": 3 }
    ],
    "tts_enabled": true,
    "enabled_commands": ["play", "skip", "playfan"]   // subset de [play,skip,cola,pause,playfan]
  },

  // IA (toda la sección)
  "ia": {
    "ia_enabled": true,
    "ia_provider": "claude",         // claude | groq | gemini | openai
    "ia_api_key": "<key activa del provider seleccionado>",
    "ia_api_keys": {                 // ⭐ keys por proveedor (preserva al cambiar)
      "gemini": "<key>",
      "claude": "<key>",
      "groq":   "<key>"
    },
    "ia_model": "claude-opus-4-6",
    "ia_max_length": 400,            // chars 100-800
    "ia_cooldown": 31,               // seg
    "ia_system_prompt": "<prompt custom multilínea>"
  }
}
```

> Nota: existe `config.json.PRE_SPLIT_BACKUP` — backup automático que
> creó `config_store.migrate_from_monolithic` cuando dividió el config.

---

## 2. `gifts.json` (3139 líneas) — los 415-485 gifts de TikTok

```jsonc
{
  "custom_gifts": {
    "<gift_id>": {                   // ID = display name del gift original
      "name": "<nombre traducido>",  // ej "Cono de helado" para "Ice Cream Cone"
      "icon": "🍦",                  // emoji fallback
      "coins": 1,                    // valor en diamantes
      "icon_path": "<full path PNG>",// ruta absoluta o vacía
      "disabled": false              // opcional, default false
    }
  }
}
```

### Stats reales

- **Total**: 485 gifts (no 415 — la memoria decía 415 PNG, pero el JSON
  tiene 485 entries; algunos no tienen PNG aún).
- **Disabled**: 62.
- **Distribución de coins**: rangos extremos:
  - `1 coin` (más común): 34 gifts.
  - `1000+`: docenas (1500, 2199, 2999, 3999, 4888, 5000, 6000, 9999, 14999, 15000, 25999...).
  - **Top tier**: 999.999 coins (1 gift outlier).
  - **Picos típicos**: 99 (gorra), 199, 299, 399, 499, 999, 1500, 5000.

### Ejemplo real (gifts comunes)
```json
"TikTok":         { "name": "TikTok",       "icon": "🎵", "coins": 1, "icon_path": "...TikTok (2).png" }
"Heart Me":       { "name": "Corazóname",   "icon": "❤️", "coins": 1, "icon_path": "...Heart_Me.png" }
"Pumpkin":        { "name": "Calabaza",     "icon": "🎃", "coins": 1, "icon_path": "...Rose_black_white.png", "disabled": true }
```

### Notas
- El `icon_path` puede ser `Rose_black_white.png` (placeholder global).
- Los `gift_id` originales **mantienen el casing y espacios** del nombre
  TikTok: `"Heart Me"`, `"You're awesome"`, `"Cake Slice"`. NO snake_case.
- `disabled: true` se usa para gifts que el usuario no quiere ver en
  galería pero conserva metadata.

---

## 3. `games.json` (440 líneas) — custom_games + game_configs + entity_images

```jsonc
{
  "custom_games": {
    "<game_id>": {
      "id": "repo",
      "name": "R.E.P.O.",
      "icon": "👻",
      "host": "127.0.0.1",
      "port": 5000,
      "connection_type": "http",      // http | rcon
      "has_entities": true,
      "has_items": true,
      "has_events": true,

      // ⭐ Categorías declaradas (lo que diferencia custom de los 3 fijos)
      "categories": [
        {
          "id": "entities",            // key en data_<game>.json
          "name": "👹 Enemigos",       // título tab en UI
          "type": "entity",            // entity | item | event | valuable
          "icon": "👹",
          "data_key": "entities",      // key real en data_<game>.json
          "endpoint": "/",
          "payload": "{\"entity_name\": \"{entity}\", \"amount\": {amount}}",
          "rcon_cmd": "summon {entity}",
          "tutorial": "📝 R.E.P.O. ENEMIGOS\\n\\nFormato: NombreVisible:..."
        },
        // ...más categorías
      ],

      // Legacy (primera categoría de cada tipo, retrocompat)
      "spawn_endpoint": "/",
      "item_endpoint":  "/",
      "event_endpoint": "/",
      "spawn_payload":  "...",
      "item_payload":   "...",
      "event_payload":  "...",
      "rcon_spawn_cmd": "...",
      "rcon_item_cmd":  "...",
      "rcon_event_cmd": "..."
    }
  },

  // Configuración extendida de juegos (opcional, sobrescribe defaults)
  "game_configs": { ... },

  // Iconos personalizados por entidad
  "entity_images": {
    "<game_id>": {
      "<category>": {
        "<command>": "<full path PNG>"
      }
    }
  }
}
```

### Custom games en uso (5)
- `repo` (R.E.P.O. 👻) — 4 categorías incluyendo `valuables` (158 items).
- `7_days_to_die` (🧟) — 3 categorías estándar.
- `ror2` (Risk of Rain 2 ☄️) — 5 categorías incluyendo `equipment` (30 items).
- `hytale` (🎮) — 3 categorías.
- `7daystodie` (legacy alias — duplicado, ignorar en G).

### Variables disponibles en `payload` y `rcon_cmd`
```
{entity}    — nombre del entity/item
{amount}    — cantidad
{user}      — username sanitizado (alphanum + _- )
{username}  — alias de user
{command}   — para events
{value}     — valor del comando (si tiene formato cmd:val)
```

### Para R.E.P.O. (caso especial)
Los nombres pueden tener formato `"Tipo - Nombre"`, ej `"Enemy - Bowtie"`.
El código (`category_tabs.py:send_to_game_with_category`) extrae
`entity.split(" - ")[-1]` para obtener solo el nombre real.

---

## 4. `profiles.json` (77 líneas) — profile_sounds + profile_voices + global_voices

```jsonc
{
  "profile_sounds": {                 // por juego
    "<game_id>": {
      "library": [<audio paths>],     // pool de archivos disponibles
      "follow":   "<path>",
      "share":    "<path>",
      "superfan": "<path>",
      "gifts": {
        "<gift_id>": "<path>"         // sonido por gift específico
      }
    }
  },

  "profile_voices": {                 // por juego
    "<game_id>": {
      "<user_norm>": "<voice_id>"
    }
  },

  "global_voices": {                  // compartidas entre todos los perfiles
    "<user_norm>": "<voice_id>"
  }
}
```

### Ejemplo real (terraria)
```json
"terraria": {
  "gifts": { "Rose": "C:/Users/User/Downloads/veg.mp3" },
  "follow": "", "share": "", "superfan": "",
  "library": ["C:/Users/User/Downloads/veg.mp3"]
}
```

### Notas
- 3 sonidos por evento globales: `follow, share, superfan`.
- Sonido por gift indexado por `gift_id` (mismo de `custom_gifts`).
- `library` es solo el catálogo de archivos; los activos están en
  `gifts/follow/share/superfan`.
- Voces: `<user_norm>` = lower + sin `@` + sin espacios.
- Si `config.use_global_voices == true`, el TTS engine usa
  `global_voices`; sino usa `profile_voices[current_game]`.

---

## 5. `data_<juego>.json` × 8 — catálogos de entidades/items/eventos

### Schema

```jsonc
{
  "entities":  ["NombreVisible:Comando", ...],
  "items":     ["NombreVisible:Comando", ...],
  "events":    ["NombreVisible:Comando", ...],
  "valuables": [...],          // solo en R.E.P.O.
  "equipment": [...],          // solo en RoR2
  // Cualquier otra category_id se admite como _extra_data
}
```

### Cuentas reales por juego

| Juego           | entities | items | events | valuables | equipment |
|-----------------|---------:|------:|-------:|----------:|----------:|
| valheim         |       52 |   114 |     26 |         0 |         — |
| terraria        |      130 |   470 |     26 |         0 |         — |
| minecraft       |        1 |     1 |      0 |         0 |         — |
| 7_days_to_die   |       59 |   181 |     44 |         0 |         — |
| 7daystodie      |       59 |   181 |     51 |         0 |         — |
| hytale          |       71 |    42 |     21 |         0 |         — |
| repo            |       30 |    52 |      4 |       158 |         — |
| ror2            |       51 |   128 |     10 |         0 |        30 |

> **`7daystodie` (sin underscores) es duplicado legacy** del `7_days_to_die`
> con 7 events extras (51 vs 44). En G se decide cuál mantener.
>
> **Minecraft tiene 1 entity / 1 item / 0 events** porque casi todo se
> hace por comandos RCON directos en las reglas, no por catálogo.

### Formato del entry
```
"NombreVisible:Comando"
```
Ejemplos:
- `"🐗 Jabalí:Boar"` — display = `🐗 Jabalí`, command = `Boar`.
- `"⭐ JEFE Eikthyr:Eikthyr"`.
- `"📋 Ver Enemigos:list"` (R.E.P.O., comando `list` para ver lista del mod).

Si no hay `:`, asume `display == command`.

---

## 6. `rules_<juego>.json` × 8 — reglas configuradas

### Schema completo

```jsonc
{
  "rules": [
    {
      "id": "8951859e",                    // 8 hex chars (uuid4[:8])
      "name": "JABALI",
      "enabled": true,

      // Trigger
      "trigger_type": "gift",              // gift|command|follow|share|subscribe|like|like_milestone
      "trigger_value": "rose",             // gift_id (lower) | comando | número (likes)

      // Acción legacy (compat hacia atrás — espejo de actions[0])
      "action_type": "spawn",              // spawn|give_item|trigger_event|spawn_valuable
      "action_value": "🐗 Jabalí",
      "amount": 1,

      // Configuración
      "cooldown": 0,                       // seg
      "tts_enabled": false,
      "tts_message": "",
      "tts_voice": "en_us_002",
      "commands": "",                      // RCON commands directos (multi-line)
      "allowed_users": [],                 // lista lower de usernames

      // ⭐ Acciones múltiples (formato moderno)
      "actions": [
        {
          "action_type": "entity",         // entity|item|event|valuable
          "action_type_name": "🐉 Entidad",// label para UI
          "action_value": "🐗 Jabalí",
          "amount": 1,
          "commands": ""                   // RCON cmds directos (sobrescribe action_value)
        }
        // ...más acciones
      ],
      "random_action": false               // ⭐ true = ejecutar UNA al azar
    }
  ]
}
```

### Stats reales por juego

| Juego           | rules | gift | command | like | like_milestone | follow | share | subscribe | multi-action | random | tts | cooldown | allowed_users |
|-----------------|------:|-----:|--------:|-----:|---------------:|-------:|------:|----------:|-------------:|-------:|----:|---------:|--------------:|
| valheim         |    27 |   22 |       3 |    1 |              0 |      0 |     1 |         0 |            5 |      0 |   0 |        0 |             0 |
| terraria        |    25 |   21 |       2 |    0 |              1 |      0 |     1 |         0 |            5 |      0 |   0 |        0 |             0 |
| minecraft       |     0 |    — |       — |    — |              — |      — |     — |         — |            — |      — |   — |        — |             — |
| 7_days_to_die   |     2 |    2 |       0 |    0 |              0 |      0 |     0 |         0 |            2 |      0 |   0 |        0 |             0 |
| 7daystodie      |     0 |    — |       — |    — |              — |      — |     — |         — |            — |      — |   — |        — |             — |
| hytale          |     1 |    0 |       0 |    1 |              0 |      0 |     0 |         0 |            0 |      0 |   0 |        0 |             0 |
| repo            |     0 |    — |       — |    — |              — |      — |     — |         — |            — |      — |   — |        — |             — |
| ror2            |     2 |    2 |       0 |    0 |              0 |      0 |     0 |         0 |            0 |      0 |   0 |        0 |             0 |

**Total**: 57 reglas configuradas. Mayoría triggers `gift` (47/57 = 82%).

### Ejemplo real de regla multi-action (Terraria, "Sin nombre")
```json
{
  "trigger_type": "gift",
  "trigger_value": "tiktok",
  "actions": [
    { "action_type": "item", "action_value": "⛏️ Pico Spectre",      "amount": 1 },
    { "action_type": "item", "action_value": "⚔️ Night's Edge",       "amount": 1 },
    { "action_type": "item", "action_value": "❤️ SET CARMESI Casco",  "amount": 1 },
    // 5 más → total 8 acciones
  ],
  "random_action": false
}
```

### Notas
- **Todas las reglas tienen tanto `actions[]` como campos legacy**
  (action_type/action_value/amount) — el RuleEngine lee `actions[]`
  primero, fallback a legacy si vacío.
- `trigger_value` para **gifts** se guarda en **lower** (ej `"rose"`,
  `"tiktok"`, `"hearts"`, `"palm breeze"`, `"coral"`, `"galaxy"`).
- **Solo 5 de 27** reglas en Valheim usan multi-action — bajo uso, pero
  el feature debe estar en el port.
- **0 reglas usan TTS**, **0 cooldown**, **0 allowed_users** en este config —
  son features disponibles pero no aprovechadas.
- **Hytale tiene 1 sola regla** trigger=`like` (probablemente
  decorativa).

---

## 7. `social_data.json` (1710 líneas) — usuarios + config + stats globales

### Schema

```jsonc
{
  "users": {
    "<user_norm>": {
      "registered": true,
      "registered_at": "2026-01-24T12:51:24.255430",
      "display_name": "<display original>",

      "racha": {
        "dias": 545,
        "ultimo": "2026-04-27",     // YYYY-MM-DD
        "record": 545
      },

      // Relaciones (single per type)
      "casado_con":       "<user>" | null,
      "casado_desde":     "<iso>"  | null,
      "novios_con":       "<user>" | null,
      "novios_desde":     "<iso>"  | null,
      "mejor_amigo":      "<user>" | null,
      "mejor_amigo_desde":"<iso>"  | null,

      // Listas legacy (mantener compat)
      "mejores_amigos": [<user>],   // legacy, usar mejor_amigo
      "rivales":        [<user>],   // legacy, usar rival
      "rival":      "<user>" | null,
      "rival_desde":"<iso>"  | null,

      "stats": {
        "duelos_ganados":  20,
        "duelos_perdidos": 6,
        "duelos_empatados": 0,
        "besos_dados": 0,
        "besos_recibidos": 1,
        "abrazos_dados": 0,
        "abrazos_recibidos": 0,
        "interacciones_aceptadas": 1,
        "interacciones_rechazadas": 0,
        "rechazos_recibidos": 1,
        "veces_rival": 0,
        "pizzas_recibidos": 1,
        "pizzas_dados": 1,
        "cafes_recibidos": 1
        // ...más stats por interacción (besos/abrazos/morder/bailar/regalo/flor/cafe/pizza/palmada × dados/recibidos)
      },

      "racha_automatica": {
        "activa": true,
        "dias_restantes": 26,
        "dias_totales": 40,
        "fecha_inicio": "2026-04-13T21:12:34.294797"
      }
    }
  },

  "config": {
    "enabled": true,
    "require_register": true,
    "cooldown_seconds": 10,
    "timeout_seconds": 90,
    "volume": 30,
    "voice": "",
    "enabled_commands": [<lista de comandos activos>],
    "known_commands":   [<comandos conocidos al guardar — para auto-add nuevos>]
  },

  "stats": {
    "total_duelos": 68,
    "total_interacciones": 30,
    "total_matrimonios": 3,
    "total_divorcios": 2,
    "total_noviazgos": 0,
    "total_rupturas": 0,
    "total_amistades": 7
  }
}
```

### Stats reales del config soykoru
- **44 usuarios registrados**.
- **68 duelos**, **30 interacciones** acumulados.
- **3 matrimonios totales** (2 divorcios → 1 activo).
- **7 amistades**.
- **0 noviazgos** (todos pasaron a casado o nunca tuvieron).

### Stats per-user observados (top racha)
- `gottina`: 545 días racha, casado con soykoru, racha auto activa 26/40.
- `cristian_rivasxd`: **685 días racha** (record).

---

## 8. `social_narrations.json` (499 líneas) — narraciones del bot

### Schema
```jsonc
{
  "_info": "Narraciones v5.0 - CON VIDA, EMOCIÓN Y CLARIDAD para TTS",
  "_version": "5.0",

  "<narration_key>": [
    "Variante 1 con {variables}",
    "Variante 2..."
  ]
}
```

### Stats
- **111 narration keys**.
- **238 variantes totales** (una key tiene 1-3 variantes).

### Sufijos comunes (categorías de narración)
- `inicio` (26): apertura de duelos/interacciones.
- `ganador` (7), `empate` (7): resultados de duelos.
- `aceptado` (14), `rechazado` (14): resultados de interacciones.
- `aceptada` (4), `rechazada` (4): para 4 tipos de relación
  (novios, casado, amigo, rival).
- `infidelidad` (1), `mismo` (1): casos especiales.
- `novio` (2), `si` (2): pendientes/respuestas.
- `rota` (2), `hecha` (1): rupturas.
- `matrimonio` (1), `soltero` (1): estado civil.
- `continua` (1), `hoy` (1): rachas.
- `no` (1), `talvez` (1): respuestas de !decision.

### Variables comunes en templates
- `{user}` — usuario que ejecuta.
- `{user1}, {user2}` — para duelos/interacciones.
- `{ganador}, {perdedor}` — duelos.
- `{numero}, {num_ganador}, {num_perdedor}` — dados.
- `{name}` — nombre limpio para fortuna.

### Ejemplo (chateda_inicio)
```
"CHATEDA ÉPICA! {user1} ha desafiado a {user2} a un duelo legendario! Ambos escriban el comando dado para tirar los dados y decidir quién es el mejor!"
```

---

## 9. `taps_data.json` (1773 líneas) — historial de likes por usuario

### Schema

```jsonc
{
  "users": {
    "<user_norm>": {
      "total": 1442794,                   // taps acumulados todo el tiempo
      "historial": {
        "2026-04-27": 4602,               // YYYY-MM-DD: count
        "2026-04-26": 54348,
        // ...
      },
      "ultima_actividad": "2026-04-27"
    }
  }
}
```

### Stats reales
- **205 usuarios**.
- **3.387.830 taps acumulados totales** del config soykoru.
- Top user: `army...jiminista...ot7` con **1.442.794 taps**.
- 2do: `honnie_008` con **1.066.000**.

### Notas
- Historial diario es la base para los rankings periodo `total/semanal/mensual`.
- `cleanup_inactive_taps()` elimina users >7 días sin tap (excepto top 3).
- `cleanup_old_history()` borra entradas antiguas del historial para
  ahorrar disco.

---

## 10. `fortunes.json` (880 líneas) — mensajes de fortuna

### Schema

```jsonc
{
  "intro_templates": [
    "La fortuna de {name} para hoy dice:",
    // ...
  ],
  "good": [...],
  "bad": [...],
  "neutral": [...],
  // ...18 categorías totales
}
```

### Stats reales

| Categoría | Mensajes |
|-----------|---------:|
| intro_templates | 25 |
| good | 104 |
| bad | 89 |
| neutral | 50 |
| specific | 75 |
| philosophical | 69 |
| love | 45 |
| money | 45 |
| health | 45 |
| work | 45 |
| gaming | 50 |
| social | 35 |
| creative | 35 |
| mystery | 35 |
| humor | 35 |
| stream | 20 |
| luck | 20 |
| wisdom | 20 |
| **TOTAL** | **842 mensajes** |

> Random uniforme entre TODOS los 842 mensajes (no por categoría).

### Notas
- Variables: `{name}` solo en `intro_templates`.
- Las 17 categorías (excluye `intro_templates`) se concatenan al
  generar fortuna random.

---

## 11. `minigame_stats.json` (16 líneas) — estadísticas de minijuegos

### Schema

```jsonc
{
  "<user_norm>": {
    "name": "<display>",
    "wordsearch_wins": 1,
    "wordbomb_wins": 0
  }
}
```

3 users registrados con wins en este config (`ezeror`, `boni0175`, `gottina`).

> **Estructura simple**: top-level es directamente el dict de users (no
> hay key `users` ni metadata).

---

## 12. `overlays.json` (16 líneas)

### Schema

```jsonc
{
  "user_id": "user-27fa20",            // anonymous ID generado del hostname
  "overlays": {
    "taps": {
      "enabled": true,
      "goal": 50000,                   // meta de likes
      "color": "#ffff7f",
      "message": "¡Lo logramos!",
      "reset_on_goal": true
    },
    "streak": {
      "enabled": true,
      "duration": 6000,                // ms en pantalla
      "label": "DÍAS DE RACHA"
    }
  }
}
```

> El `user_id` se genera anónimo SHA256 del hostname. Migración
> automática si era formato viejo `<os_user>-XXXX`.

---

## 13. `stream_profiles/<id>.json` × 2 — snapshots completos del stream

### Schema

```jsonc
{
  // Identidad
  "name": "Stream Terraria 01-01",
  "profile_id": "stream_terraria_01_01",
  "game": "terraria",
  "created": "2026-01-01T18:07:45.691757",
  "imported_at": "<iso>"?,             // si fue importado

  // TikTok
  "tiktok_username": "miguelin20130",

  // Snapshot de gifts (puede tener cientos)
  "custom_gifts": { ... 321 items ... },

  // Snapshot de sonidos (4 keys)
  "sounds": { "library", "follow", "share", "superfan", "gifts" },

  // Snapshot de voces (3 user→voice)
  "voices": { "<user>": "<voice_id>" },

  // TTS config
  "tts_enabled": true,
  "tts_volume": 13,
  "tts_voice": "es_002",

  // Tema
  "theme": "dracula",

  // Reglas y catálogos snapshots
  "rules":    [ ... 20 reglas completas ... ],
  "entities": [ ... 47 strings "Nombre:Cmd" ... ],
  "items":    [ ... 104 strings ... ],
  "events":   [ ... 9 strings ... ]
  // valuables/equipment opcionales si el juego los tiene
}
```

### Profiles existentes
- `stream_minecraft_01_01.json`.
- `stream_terraria_01_01.json` (con 20 reglas, 47 entities, 104 items).

### Notas
- **Profile = snapshot completo** del estado de la app en ese momento.
- Cargar un profile reemplaza: `current_game, custom_gifts, sounds,
  voices, tts.*, theme, profile.rules/entities/items/events`.
- Backup automático antes de cargar (`pre_load`).

---

## 14. `config.json.PRE_SPLIT_BACKUP`

Backup automático del config monolítico legacy creado por
`config_store.migrate_from_monolithic()`. Se mantiene como safety net
cuando se hace la migración al esquema particionado.

---

## Estructura de runtime (no JSON pero tracked)

```
data/
├── backups/<backup_<timestamp>_<reason>>/   # 7 max, FIFO
├── tts_cache/<md5>.mp3                      # cache MP3 generado
├── donaciones/<gift_id>.png                 # 415 PNGs de gifts
├── game_images/<game_id>/<category>/*.png   # icons por entidad
├── icons_triggers/trigger_<type>.png        # 7 PNGs de triggers
└── stream_profiles/<id>.json
```

Y en `secrets/spotify/`:
- `account` (cuenta seleccionada).
- `accounts.json` (cuentas guardadas).
- `cache` (token OAuth).
- `rate_limit` (estado del rate limit persistido).

---

## Notas para el port

### Schemas inmutables (1:1)
Estos JSON NO cambian de estructura — el sidecar Python sigue
leyendo/escribiendo igual:
- `config.json + gifts.json + games.json + profiles.json`
  (particionado existente).
- `data_<game>.json` × N.
- `rules_<game>.json` × N.
- `social_data.json + social_narrations.json + taps_data.json + fortunes.json`.
- `minigame_stats.json + overlays.json`.
- `stream_profiles/*.json`.

### Compat de migración
- **Particionado config**: `migrate_from_monolithic()` se ejecuta
  automáticamente al boot — replicar.
- **Anonymous user_id**: si overlays.json tiene ID viejo
  (`<os_user>-XXXX`), se regenera anónimo — replicar.
- **`known_commands` en social config**: tracking de comandos para
  auto-añadir los nuevos al `enabled_commands` set.
- **Gifts con `disabled: true`** — preservar (no borrar).

### IDs reales reservados
- gift_id: case + spaces como vienen de TikTok (`"Heart Me"`, `"You're awesome"`).
- user_norm: `lower + sin @ + sin espacios + sin guiones bajos→a underscore`.
  Reglas exactas en `_normalize_username()` del TTS y `_normalize()` del social.

### Validaciones críticas
- `theme` debe estar en `THEMES` (en G solo `"midnight"` válido).
- `voice_id` debe estar en las **74 voces** de `TTSEngine.VOICES`.
- `current_game` debe estar en `games.json:custom_games` o ser uno
  de los 3 predefinidos.

### Path absolutos en `icon_path`
Los PNGs de gifts se guardan con **path absoluto** (`C:/Users/User/...`).
En el port a sidecar Python: convertir a relativos al `data/donaciones/`
para portabilidad entre máquinas.
