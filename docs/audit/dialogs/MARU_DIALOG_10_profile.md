# Diálogo 10 — `profile_dialog.py` · NewProfileDialog (114 líneas)

> Modal pequeño para crear un nuevo perfil de juego basado en otro existente.

## Constructor

```python
NewProfileDialog(parent, existing_profiles: list)
```

- `existing_profiles` = lista de tuplas `(profile_id, display_name)`.
- minSize 500x400.

## Layout

### Title
- `🎮 Crear Nuevo Perfil de Juego` (18 bold ACCENT).

### `📋 Información del Nuevo Perfil`
- `profile_id` (QLineEdit) — placeholder `"ej: ark, rust, 7days..."`.
- `profile_name` (QLineEdit) — placeholder `"ej: ARK Survival, Rust, 7 Days..."`.

### `📦 Copiar Datos de Otro Perfil`
- Hint: *"Selecciona un perfil existente para copiar sus entidades, items y eventos:"*.
- `base_profile` (QComboBox):
  - 1ra opción: `🆕 Vacío (sin datos)` → data `"empty"`.
  - Resto: `📋 <pname>` → data `<pid>` por cada existing.

### `🔗 Compartir Configuración Global`
- Hint: *"Estas opciones usan la configuración global (compartida entre perfiles):"*.
- `share_sounds` (QCheckBox) — `🔔 Usar sonidos globales` (default checked).
- `share_voices` (QCheckBox) — `🎤 Usar voces globales` (default checked).

### Botones
- `Cancelar`.
- `✅ Crear Perfil` (verde) → `on_create`.

## `on_create()` — validación
- ID obligatorio.
- Nombre puede ser vacío → fallback a `pid.title()`.
- ID no puede ser duplicado de uno existente.
- Llama `accept()`.

## `get_result() → dict`

```python
{
  "id": <id_normalized: lower, spaces→_>,
  "name": <name>,
  "base_profile": <base_id> | "empty",
  "share_sounds": bool,
  "share_voices": bool
}
```

## Notas para el port

- **Modal mínimo** — pocos campos, validación simple.
- ID normalization: `.lower().replace(" ", "_")`.
- `share_sounds/voices` → cuando se activa, el perfil USA los sonidos /
  voces globales en vez de tener su propio set.
- **Llamado solo desde** `ManageGamesDialog.new_profile()` (Diálogo 07).
