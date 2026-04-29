# Diálogo 09 — `overlays_manager.py` · OverlaysManager (197 líneas)

> Galería estilo Tikfinity con grid de overlays. Cada overlay = una
> `OverlayCard` con preview en vivo + botón Copy URL + ⚙️ ajustes.
> **Sin pantallas de configuración global. Todo automático.**

## Constructor

```python
OverlaysManager(parent=None, client: OverlayClient | None = None)
COLUMNS = 2
```

- minSize 960x720.
- `client = OverlayClient()` (de `core/overlays.py`).

## Layout

### Header (panel rounded con bg PANEL_BG)
- Title `🎬 Galería de Overlays` (22 bold ACCENT).
- Subtitle (Rich Text):
  > "Elige un overlay → click en **📋 Copiar URL** → pega en TikTok
  > Studio como *Browser Source*. ¡Eso es todo!"

### Grid scrollable de OverlayCards
Itera `OVERLAY_REGISTRY.keys()` (de `core/overlays.py`):
- 1 `OverlayCard(overlay_id, client)` por entrada.
- 2 columnas (`COLUMNS = 2`).

**Auditar `core/overlays.py` para conocer los overlays registrados.**
Por la estructura visible en `assets/overlays/` son al menos:
- `streak` (racha)
- `taps` (meta de likes)

### Cards "PRÓXIMAMENTE" (placeholder, 420x420)
3 placeholders dashed border:
- `🎁 Alerta de Gifts` — Pop-up animado al llegar regalos.
- `👥 Top Likers` — Ranking en vivo de los que más likes dan.
- `⭐ Alerta de Follows` — Pop-up al llegar nuevos seguidores.

Cada uno con:
- Icono 64px gris.
- Nombre en bold 18 TEXT_SECONDARY.
- Descripción 11 TEXT_MUTED.
- Badge `PRÓXIMAMENTE` (orange `ACCENT` con bg `rgba(243,156,18,0.15)`).

### Footer (con bg footer_style)
- Hint izquierdo (en lugar de mostrar user_id directo):
  > "💡 Pega la URL en TikTok Studio → *Add Source* → *Browser Source*"
- Botón `✏️ Cambiar mi alias` → `_change_alias`.
- Botón `Cerrar`.

## `_change_alias`
- QInputDialog con texto:
  > "Tu alias aparece en la URL del overlay.
  > Solo letras, números, guiones. Sin espacios ni acentos.
  >
  > Ejemplo: soykoru → URL será .../u/soykoru/taps"
- `client.set_user_id(new)`.
- Refresca todas las cards llamando `child._refresh_preview()` si tienen
  ese método.

## Notas para el port

- **No hay configuración global** — cada overlay tiene su propia card
  con sus propios ajustes (en `OverlayCard`, auditar `gui/widgets/overlay_card.py`).
- **`OVERLAY_REGISTRY`** vive en `core/overlays.py` (270 líneas) — auditar
  en G0.6 para saber el formato exacto.
- **Alias** = `user_id` del client. Persiste para que la URL del
  overlay sea estable entre sesiones.
- **Backend overlays está desplegado en Cloudflare** según memoria
  (`overlays.korugames.lat` funcionando).
- **El `_warmup_overlays_manager`** del MainWindow construye este
  diálogo OCULTO durante el splash para que el flicker de Chromium
  ocurra detrás. Crítico para UX.

## OverlayCard (extracto — auditar completo en G0.5)

Cada card tiene:
- Preview (probablemente `QWebEngineView` con la URL del overlay).
- Botón `📋 Copiar URL`.
- Botón `⚙️` para ajustes (color, mensaje, meta, etc.).

Tamaño aprox 420x420 (basado en placeholder).
