# Diálogo 16 — `voices_dialog.py` · VoicesDialog (146 líneas)

> Gestionar voces TTS personalizadas **por @username** (asignar voz a usuarios VIP).

## Constructor

```python
VoicesDialog(parent, voices: dict, tts_voices: dict)
```

- `voices` = `{username_norm: voice_id}` (la asignación user→voice).
- `tts_voices` = `TTSEngine.VOICES` (catálogo de las 74 voces).
- minSize 550x500.

## Layout

### Header info banner
- Texto en azul claro `#7ed6df` con bg `rgba(74,105,189,0.15)`:
  > "Asigna voces por @USERNAME (el nombre único con arroba).
  > ⚠️ Usa el @ de TikTok, NO el nombre de perfil.
  > Ejemplo: si es @soykoru → escribe: soykoru"

### `➕ Asignar Voz` (form)
- `user` (QLineEdit) — placeholder `"soykoru, gottina, etc. (sin el @)"`.
- `voice` (QComboBox) — TODAS las 74 voces de `tts_voices`.
- Botón `➕ Agregar` → `add()`:
  - Normaliza username: `lower().replace("@", "").replace(" ", "")`.
  - Setea `voices[u] = v`.
  - Refresh + clear input.

### Lista de voces asignadas
`QListWidget` mostrando `@<user>  →  <voice_name>` por cada entrada
(ordenado alfabéticamente por user).

### Botones
- `🔊 Probar` → `test()`:
  - Lee la entrada seleccionada (parsea `<user>` del display).
  - `parent_win.tts.speak_now(f"Hola, soy {user}", v)`.
- `✏️ Editar` → `edit()` abre subdiálogo modal con QComboBox para
  cambiar la voz del user seleccionado.
- `🗑️ Eliminar` → `delete()` quita del dict.

### Footer
- `QDialogButtonBox` con solo `Ok`.

## Subdiálogo de edición (`edit()`)

- minWidth 350.
- Title: `✏️ Editar voz de @<user>`.
- Label: `Cambiar voz para @<user>:`.
- QComboBox con las 74 voces, posicionado al actual.
- Botones `💾 Guardar` y `Cancelar`.

## Métodos públicos

```python
get_voices() → dict   # {username_norm: voice_id}
```

## Notas para el port

- **Username normalization** importante: `lower().replace("@", "").replace(" ", "")`.
  Replicar idéntico para que reglas y voices match al mismo user.
- **3 niveles de voces** del MainWindow:
  - `default_voice` (global, TTS engine).
  - `profile_voices[game]` o `global_voices` según `use_global_voices`.
  - **Per-user voice** (este diálogo) — override sobre las anteriores.
- **`tts.speak_now`** vs `tts.speak`: el `_now` salta cola y reproduce
  inmediato (auditar `core/tts_engine.py` en G0.6).
- **Edición** abre sub-modal — patrón repetido en otros diálogos.
- **No hay validación** del username (cualquier string es válido).
