# MARU Original — Audit Maestro

> Documento maestro de la fase G0 del Plan G de replicación 1:1.
> Este archivo es el **índice general** del audit. Cada sección apunta
> al documento detallado correspondiente.
>
> **Estado**: en progreso (G0 en curso · 2026-04-27).

---

## 1. Identidad visual

Ver: [`MARU_VISUAL_AUDIT.md`](MARU_VISUAL_AUDIT.md)

- Logo y splash
- Paleta de colores (hex exactos)
- Tipografía
- Iconos del sidebar
- Stylesheet QSS extraído
- Animaciones

## 2. Estructura general de la app

Ver: [`MARU_MAIN_WINDOW.md`](MARU_MAIN_WINDOW.md)

- Ventana principal: layout, sidebar, titlebar
- Pestañas/vistas activas
- Atajos de teclado
- Toasts y notificaciones

## 3. Diálogos (16)

Ver carpeta: [`dialogs/`](dialogs/)

| #  | Diálogo               | Archivo                                  |
|----|-----------------------|------------------------------------------|
| 01 | backup                | `MARU_DIALOG_01_backup.md`               |
| 02 | custom_game           | `MARU_DIALOG_02_custom_game.md`          |
| 03 | data                  | `MARU_DIALOG_03_data.md`                 |
| 04 | entity_selector       | `MARU_DIALOG_04_entity_selector.md`      |
| 05 | gift_selector         | `MARU_DIALOG_05_gift_selector.md`        |
| 06 | gifts                 | `MARU_DIALOG_06_gifts.md`                |
| 07 | manage_games          | `MARU_DIALOG_07_manage_games.md`         |
| 08 | minigames             | `MARU_DIALOG_08_minigames.md`            |
| 09 | overlays_manager      | `MARU_DIALOG_09_overlays_manager.md`     |
| 10 | profile               | `MARU_DIALOG_10_profile.md`              |
| 11 | profiles              | `MARU_DIALOG_11_profiles.md`             |
| 12 | rule                  | `MARU_DIALOG_12_rule.md`                 |
| 13 | simulator             | `MARU_DIALOG_13_simulator.md`            |
| 14 | social_config         | `MARU_DIALOG_14_social_config.md`        |
| 15 | sounds                | `MARU_DIALOG_15_sounds.md`               |
| 16 | voices                | `MARU_DIALOG_16_voices.md`               |

## 4. Vistas y widgets

Ver carpeta: [`views/`](views/)

- Vistas de gui/views/
- Widgets de gui/widgets/
- Controllers

## 5. Lógica de negocio (core/)

Ver carpeta: [`core/`](core/)

- `tiktok_client` — conexión TikTok Live
- `rule_engine` — motor de reglas
- `games` — Valheim/Terraria/Minecraft/Custom
- `social_system` — comandos sociales, rachas, narraciones
- `spotify_client` — Spotify + anti-rate-limit
- `ia_engine` — multi-proveedor IA
- `tts_engine` — 3 canales TTS
- `overlays` — cliente Cloudflare
- `minigames` + `minigame_stats`
- `version_checker`
- `config_store`, `paths`, `logger`

## 6. Datos persistentes

Ver: [`MARU_JSON_SCHEMAS.md`](MARU_JSON_SCHEMAS.md)

Schemas reales de cada JSON consumido por MARU.

## 7. Assets

Ver: [`MARU_ASSETS_INVENTORY.md`](MARU_ASSETS_INVENTORY.md)

- 415 PNG de donaciones
- PNG por juego/categoría en `data/game_images/`
- Iconos de triggers
- Logo, splash, fuentes, sonidos

## 8. Contrato final del port

Ver: [`MARU_FEATURE_MATRIX.md`](MARU_FEATURE_MATRIX.md) y
     [`MARU_PLAN_G_FINAL.md`](MARU_PLAN_G_FINAL.md)

La matriz mapea cada feature a su fase G. El plan final reemplaza al
borrador G1-G14 con el alcance descubierto en G0.

## 9. Limpieza pre-G1

Ver: [`MARU_CLEANUP_BEFORE_G1.md`](MARU_CLEANUP_BEFORE_G1.md)

Lista de invenciones a borrar y reversión de v1.0.0 → v0.5.0-alpha.

---

## Progreso de G0

- [x] G0.1 Esqueleto de docs
- [x] G0.2 Inventario crudo de archivos
- [x] G0.3 Audit de gui/main_window.py (3345 líneas)
- [x] G0.4 Audit de los 16 diálogos
- [x] G0.5 Audit de views/widgets/controllers/themes
- [x] G0.6 Audit de core/*.py (~10000 líneas)
- [x] G0.7 Audit de JSON schemas (15 archivos)
- [x] G0.8 Inventario de assets/imágenes (2.873 PNGs cross-checked)
- [x] G0.9 Matriz Feature × Fase (343 features)
- [x] G0.10 Plan G final (14 fases revisadas)
- [x] G0.11 Checklist de limpieza pre-G1

**G0 COMPLETADA · 2026-04-27** — listo para arrancar G1 cuando el
usuario confirme.
