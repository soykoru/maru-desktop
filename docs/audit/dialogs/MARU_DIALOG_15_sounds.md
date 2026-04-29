# Diálogo 15 — `sounds_dialog.py` · SoundsDialog (650 líneas)

> Biblioteca + asignación visual de sonidos a regalos y eventos.
> 3 tabs: Biblioteca, Regalos, Eventos.

## Constructor

```python
SoundsDialog(parent, sounds: dict, custom_gifts: dict, sound_volume: int = 80)
```

- `sounds` es por perfil — viene de `MainWindow.profile_sounds[current_game]`.
- `sound_volume` 0–100, default 80.
- `_rebuild_cache()` indexa `Path.exists()` para no llamarlo en cada paint.

## Layout

3 tabs (`self._tabs`):

### Tab 1 · `📁 Biblioteca`

- Header con search bar.
- Grid de `_SoundFileCard` (48px alto cada uno) en QScrollArea.
  Cada card:
  - `✅` o `❌` según existe (cacheado).
  - Nombre del archivo.
  - Tamaño (`<X.X> MB` o `<XX> KB`).
  - Click → `_select_lib`.
- Botones bottom: `Añadir sonidos`, `Probar`, `Eliminar`, count label.

`_add_sounds()` abre QFileDialog filtro audio (mp3/wav/ogg) y los suma a
`self.sound_library` (`sounds["library"]`).

### Tab 2 · `🎁 Regalos`

- Lista vertical de `_GiftSoundCard` (68px alto cada uno) por cada gift
  en `custom_gifts`:
  - Avatar 42x42 (PNG real o emoji fallback).
  - Nombre + monedas en columna izquierda.
  - `combo` (QComboBox 200px) con:
    - Primer item: `"Sin sonido"` (data `""`).
    - Sub-items: `"🔊 <nombre>"` por cada sonido válido.
  - Botón `🔊` test (azul) → `_on_gift_test(gid)`.
  - Botón `✕` (transparente, hover rojo) → `_on_gift_remove(gid)`.

`_on_gift_sound_changed(gid, path)` → `self.sounds[gid] = path or ""`.

### Tab 3 · `⚡ Eventos`

3 filas de `_EventRow` (60px alto, fixed):

| Icon | Label | Key |
|------|-------|-----|
| ➕ | Nuevo Seguidor | `follow` |
| 📤 | Compartir | `share` |
| ⭐ | Super Fan | `superfan` |

Cada fila tiene:
- Icon 36px wide.
- Label (12 bold) 140px wide.
- Combo de sonidos válidos.
- Botón test.

> NOTA: hay 3 eventos con sonido global, NO 6 (no hay sonido de like, ni
> comment). Los demás eventos (likes/comments) tienen sus sonidos vía
> reglas.

## Volume slider

- Slider 0–100 + label `<n>%`.
- `_on_vol(val)` actualiza `self.sound_volume` y label en vivo.
- Volumen aplicado a TODOS los sonidos (gift + eventos + library test).

## Playback

`_play_sound(path)`:
1. Verificar archivo existe → si no, QMessageBox warning.
2. Lanzar thread daemon que:
   - `pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=512)` si no inicializado.
   - `s = pygame.mixer.Sound(path)`.
   - `s.set_volume(vol / 100.0)`.
   - `s.play()`.

> Patrón importante: NO bloquea la UI con la reproducción, threads
> daemon que se limpian solos.

## Métodos públicos

### `get_sounds() → dict`
Persiste `library` + cada `event_row.combo.currentData()`:
```python
{
  "library": [paths...],
  "follow": "<path>",
  "share": "<path>",
  "superfan": "<path>",
  "<gift_id>": "<path>",  # uno por gift configurado
  ...
}
```

### `get_volume() → int`
0–100.

## Notas para el port

- **Solo 3 eventos** tienen sonido global (`follow / share / superfan`).
  Los demás (likes / comments / regalos no listados) no tienen sonido
  por evento — se manejan vía sistema de reglas.
- **Por gift** sí hay sonido configurable. La galería se popula desde
  `custom_gifts` (no desde `library`).
- **Library** es solo el set de archivos disponibles para asignar — no
  un audio que se reproduce solo.
- **`pygame.mixer.Sound` en thread daemon** — replicar el patrón
  no-bloqueante en Electron (Web Audio API o `<audio>` con catch).
- **`disabled` flag** en gifts: revisar si `SoundsDialog` los oculta o
  los muestra grayed. (Mirando el código: parece que itera todos los
  gifts y solo los muestra si `coins` existe — auditar más a fondo si
  filtra disabled).
