# MARU Original — Inventario crudo de archivos

> Fuente: `C:/Users/User/Desktop/MARU PRO/LiveChaosEngine/LiveChaosEngine_Refactored`
> Producido en G0.2 · 2026-04-27.
>
> Este documento es el **checklist** que asegura que ningún archivo
> queda sin auditar en G0.3-G0.8.

---

## 1. Top-level del repo

```
LiveChaosEngine_Refactored/
├── .gitignore
├── CLAUDE.md
├── CREAR_EXE_COMPLETO.bat
├── ESTRUCTURA.md
├── MaruLive.spec        (PyInstaller)
├── icon.ico
├── logo.png             (1.1 MB)
├── main.py              (4 líneas — entry)
├── requirements.txt
├── run_refactored.bat
├── assets/
├── core/
├── data/
├── gui/
├── logs/
├── scripts/
├── secrets/
└── tests/
```

## 2. Python — total: 75 archivos

### 2.1 Entry point
- `main.py` (4 líneas)

### 2.2 `gui/` — 33 archivos

| Archivo                                | Líneas |
|----------------------------------------|-------:|
| `gui/__init__.py`                      |     74 |
| `gui/main_window.py`                   | **3345** |
| `gui/constants.py`                     |    181 |
| `gui/themes.py`                        |    297 |

**`gui/dialogs/` — 17 archivos:**

| Archivo                                | Líneas |
|----------------------------------------|-------:|
| `gui/dialogs/__init__.py`              |     16 |
| `gui/dialogs/backup_dialog.py`         |    342 |
| `gui/dialogs/custom_game_dialog.py`    |    837 |
| `gui/dialogs/data_dialog.py`           |    625 |
| `gui/dialogs/entity_selector.py`       |    614 |
| `gui/dialogs/gift_selector.py`         |    275 |
| `gui/dialogs/gifts_dialog.py`          |    652 |
| `gui/dialogs/manage_games_dialog.py`   |    427 |
| `gui/dialogs/minigames_dialog.py`      |    254 |
| `gui/dialogs/overlays_manager.py`      |    197 |
| `gui/dialogs/profile_dialog.py`        |    114 |
| `gui/dialogs/profiles_dialog.py`       |    762 |
| `gui/dialogs/rule_dialog.py`           |   1259 |
| `gui/dialogs/simulator_dialog.py`      |    688 |
| `gui/dialogs/social_config.py`         |   2464 |
| `gui/dialogs/sounds_dialog.py`         |    650 |
| `gui/dialogs/voices_dialog.py`         |    146 |

**`gui/views/` — 6 archivos:**

| Archivo                                | Líneas |
|----------------------------------------|-------:|
| `gui/views/__init__.py`                |     24 |
| `gui/views/audio.py`                   |    425 |
| `gui/views/category_tabs.py`           |    450 |
| `gui/views/images.py`                  |    298 |
| `gui/views/simulator.py`               |    263 |
| `gui/views/stream_profiles.py`         |    669 |

**`gui/widgets/` — 14 archivos:**

| Archivo                                | Líneas |
|----------------------------------------|-------:|
| `gui/widgets/__init__.py`              |     13 |
| `gui/widgets/animated.py`              |    103 |
| `gui/widgets/backup_manager.py`        |    135 |
| `gui/widgets/default_images.py`        |    209 |
| `gui/widgets/game_sounds.py`           |     81 |
| `gui/widgets/health.py`                |    116 |
| `gui/widgets/image_cache.py`           |    143 |
| `gui/widgets/log_widget.py`            |    362 |
| `gui/widgets/overlay_card.py`          |    429 |
| `gui/widgets/rule_validator.py`        |    200 |
| `gui/widgets/searchable.py`            |    111 |
| `gui/widgets/splash.py`                |    123 |
| `gui/widgets/wordbomb_widget.py`       |    871 |
| `gui/widgets/wordsearch_lite_widget.py`|    575 |
| `gui/widgets/wordsearch_widget.py`     |    592 |

**`gui/controllers/` — 2 archivos:**

| Archivo                                | Líneas |
|----------------------------------------|-------:|
| `gui/controllers/__init__.py`          |      1 |
| `gui/controllers/connection.py`        |     17 |

### 2.3 `core/` — 22 archivos

| Archivo                                | Líneas |
|----------------------------------------|-------:|
| `core/__init__.py`                     |      6 |
| `core/config_store.py`                 |    148 |
| `core/games.py`                        |    696 |
| `core/ia_engine.py`                    |    675 |
| `core/logger.py`                       |     93 |
| `core/minigame_stats.py`               |     53 |
| `core/minigames.py`                    |    648 |
| `core/overlays.py`                     |    270 |
| `core/paths.py`                        |     88 |
| `core/rule_engine.py`                  |    627 |
| `core/spanish_words.py`                |   1243 |
| `core/spotify_client.py`               |   1652 |
| `core/social_system.py`                |    588 |
| `core/tiktok_client.py`                |    584 |
| `core/tts_engine.py`                   |    840 |
| `core/version_checker.py`              |    105 |

**`core/social/` — 8 archivos:**

| Archivo                                | Líneas |
|----------------------------------------|-------:|
| `core/social/__init__.py`              |     26 |
| `core/social/_tarot_data.py`           |    586 |
| `core/social/admin.py`                 |    293 |
| `core/social/combat.py`                |    119 |
| `core/social/interactions.py`          |    368 |
| `core/social/music_ia.py`              |    148 |
| `core/social/streaks_rankings.py`      |    397 |
| `core/social/utilities.py`             |    228 |

### 2.4 `scripts/` — 2 archivos (no se importan en runtime)
- `scripts/download_all_images.py` (718 líneas)
- `scripts/improve_images_v2.py` (685 líneas)

### 2.5 `tests/` — 9 archivos
- `conftest.py` (11 líneas)
- `test_config_store.py` (133 líneas)
- `test_main_window_qt.py` (143 líneas)
- `test_overlays.py` (157 líneas)
- `test_rule_engine.py` (30 líneas)
- `test_rule_engine_functional.py` (175 líneas)
- `test_smoke_imports.py` (185 líneas)
- `test_social_commands.py` (147 líneas)

---

## 3. Datos JSON — `data/`

### 3.1 Top-level
| Archivo                              | Líneas |
|--------------------------------------|-------:|
| `config.json`                        |    155 |
| `config.json.PRE_SPLIT_BACKUP`       |        |
| `games.json`                         |    440 |
| `gifts.json`                         | **3139** |
| `profiles.json`                      |     77 |
| `fortunes.json`                      |    880 |
| `social_data.json`                   |   1710 |
| `social_narrations.json`             |    499 |
| `minigame_stats.json`                |     16 |
| `taps_data.json`                     |   1773 |
| `overlays.json`                      |     16 |

### 3.2 Catálogos por juego (`data_<juego>.json`)
- `data_7_days_to_die.json` (292 líneas)
- `data_7daystodie.json` (331)
- `data_hytale.json` (142)
- `data_minecraft.json` (9)
- `data_repo.json` (253)
- `data_ror2.json` (229)
- `data_terraria.json` (634)
- `data_valheim.json` (200)

### 3.3 Reglas por juego (`rules_<juego>.json`)
- `rules_7_days_to_die.json` (88)
- `rules_7daystodie.json` (3)
- `rules_hytale.json` (28)
- `rules_minecraft.json` (2)
- `rules_repo.json` (2)
- `rules_ror2.json` (55)
- `rules_terraria.json` (989)
- `rules_valheim.json` (887)

### 3.4 Stream profiles
- `stream_profiles/stream_minecraft_01_01.json`
- `stream_profiles/stream_terraria_01_01.json`

### 3.5 Carpetas de runtime
- `data/backups/` (auto-generado)
- `data/tts_cache/` (auto-generado)

> **Nota**: hay duplicación `7_days_to_die` vs `7daystodie` y entre carpetas de
> imágenes — investigar en G0.7 si es legacy o si convive (decidir cuál es
> el canónico al portar).

---

## 4. Imágenes y assets

### 4.1 Donaciones — `data/donaciones/`
- **415 PNG** (gifts de TikTok).
- Ejemplos: `Advancing_Planet.png`, `Air_Dancer.png`, `Alien_Buddy.png`,
  `Alpaca.png`, `Amusement_Park.png`, `Animal_Band.png`, ...

### 4.2 Iconos de triggers — `data/icons_triggers/`
7 PNG:
- `trigger_command.png`
- `trigger_follow.png`
- `trigger_gift.png`
- `trigger_like.png`
- `trigger_like_milestone.png`
- `trigger_share.png`
- `trigger_subscribe.png`

### 4.3 Game images — `data/game_images/`

Subcarpetas: 9 (8 juegos + `_templates/`)

| Juego          | entities | equipment | events | items | valuables | total |
|----------------|---------:|----------:|-------:|------:|----------:|------:|
| 7_days_to_die  |       59 |         1 |     42 |   180 |         1 |   283 |
| 7daystodie     |       58 |       n/a |     48 |   179 |       n/a |   285 |
| hytale         |       72 |         1 |     22 |    43 |         1 |   139 |
| minecraft      |        1 |         1 |      1 |     1 |         1 |     5 |
| repo           |       31 |         1 |      5 |    53 |       159 |   249 |
| ror2           |       85 |        31 |     29 |   126 |         1 |   272 |
| terraria       |      169 |         1 |     41 |   467 |         1 |   679 |
| valheim        |       94 |         1 |     27 |   141 |         1 |   264 |
| **subtotales** |    **569** |   **38** |  **215** | **1190** |   **165** | **2176** |

`_templates/` aparte: **276 PNG** (iconos genéricos reutilizables).

> **Nota**: muchas categorías tienen `1` PNG, lo que probablemente es un
> placeholder o icono por defecto. Confirmar en G0.8 al cruzar con
> `data_<juego>.json`.

### 4.4 Logo / icon
- `logo.png` (1.1 MB) — root del repo
- `icon.ico` (69 KB) — root del repo

### 4.5 Assets HTML/JS — `assets/overlays/`
- `streak/` → `index.html`, `style.css`, `app.js`
- `taps/`   → `index.html`, `style.css`, `app.js`

### 4.6 Sonidos
- No hay carpeta global de sonidos en el repo (vienen empaquetados o
  los aporta el usuario por evento — confirmar en G0.4 leyendo `sounds_dialog`).

---

## 5. Secretos / runtime

- `secrets/spotify/` — `account`, `accounts.json`, `cache` (NO comitear).
- `logs/livechaos.log` — log con rotación.

---

## 6. Totales gruesos

- **Python**: 75 archivos, ≈ 26.500 líneas (muy aprox).
- **JSON**: 26 archivos top-level + 2 stream profiles.
- **PNG**: 415 (donaciones) + 7 (triggers) + 2.176 (game_images) +
  276 (_templates) ≈ **2.874 imágenes** que hay que servir.
- **HTML/JS overlays**: 6 archivos en 2 paquetes.

---

## 7. Pendiente para G0.3+

- Leer `gui/main_window.py` entero (G0.3) — el archivo más grande.
- Leer los 17 diálogos (G0.4) — ojo: el inventario dice 17, no 16; revisar
  qué archivo extra es.
- Leer views/widgets/controllers/themes (G0.5).
- Leer todos los módulos `core/*.py` y `core/social/*.py` (G0.6).
- Leer todos los JSON con schemas reales (G0.7).
- Cruzar imágenes con catálogos JSON (G0.8).

> El conteo de diálogos es 17 (incluyendo `__init__.py`) → en realidad
> son 16 diálogos reales + 1 `__init__`. La memoria lo decía bien.
