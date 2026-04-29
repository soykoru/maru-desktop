# Diálogo 01 — `backup_dialog.py` · BackupDialog (342 líneas)

> Gestor de respaldos. Lista de cards con preview + Restore + Delete.
> Manual + automático antes de cargar perfil / antes de importar.

## Constructor

```python
BackupDialog(parent, backup_manager)
```

- `backup_manager` instancia de `BackupManager` (en
  `gui/widgets/backup_manager.py`, 135 líneas — auditar G0.5).
- minSize 680x560, resize 700x580.

## Mapping de razones (`_REASON_MAP`)

| Reason key | Display | Color | Icon |
|------------|---------|-------|------|
| `manual` | Manual | `#2ecc71` (verde) | 💾 |
| `pre_load` | Antes de cargar perfil | `#3498db` (azul) | 📂 |
| `prerestore` | Antes de restaurar | `#e67e22` (naranja) | 🛡️ |
| `pre_import` | Antes de importar | `#9b59b6` (morado) | 📥 |
| <other> | (literal) | `#95a5a6` (gris) | 📦 |

## Layout

### Header (56px)
- Title `Respaldos` (18 bold ACCENT).
- `_counter` (derecha) — `<n> de <MAX_BACKUPS>` (default 7).
- Background: `header_gradient("rgba(39,174,96,0.4)")`.

### Explain panel (frame con bg verde claro)
> "**¿Cómo funcionan?** — Los respaldos guardan una copia de tus archivos
> de configuración, reglas y datos de juego. Se crean automáticamente
> antes de cargar un perfil o importar datos. También puedes crearlos
> manualmente. Se guardan máximo 7 (los más viejos se eliminan solos)."

### Body (scrolleable)
- Lista vertical de `_BackupCard` (72px alto).
- Si vacío: `_empty_lbl` "No hay respaldos todavía. Crea uno con el botón de abajo."

### `_BackupCard`
Tarjeta horizontal:
- Icono según reason (44px wide).
- `<display>` (12 bold) — fecha humanizada (ej `"2025-04-26 14:30"`).
- Tag de reason (badge con color del reason, border, padding 2x10).
- Sub: `<files> archivos  ·  <age>` donde age es:
  - `>0 days` → `"hace Xd"`.
  - `>3600 seconds` → `"hace Xh"`.
  - else → `"hace Xmin"`.

### Action bar (64px)
- `Crear Respaldo` (verde, 44px alto) → `_on_create`:
  - `bm.create_backup("manual")` → si OK refresh.
- `Restoración Seleccionado` (naranja, disabled si no hay selection):
  - Confirma con QMessageBox.question:
    > "¿Restaurar desde este respaldo?
    >
    > Se sobrescribirá tu configuración actual.
    > Se creará un respaldo de seguridad antes de restaurar."
  - Si Yes:
    - `bm.create_backup("prerestore")` (auto-respaldo previo).
    - `bm.restore_backup(path)` → si OK info "Reinicia la app para aplicar".
- `Eliminar` (rojo, disabled si no hay selection):
  - Confirma → `shutil.rmtree(path)` o `Path.unlink()`.

### Footer (46px)
- `_last_lbl` (izquierda) — `Último respaldo: <info>` (de
  `bm.get_last_backup_info()`).
- Botón `Cerrar` (100x34).

## API esperada del `BackupManager`

```python
bm.MAX_BACKUPS              # 7
bm.create_backup(reason: str) → tuple[bool, str]
bm.get_available_backups() → list[dict]
bm.get_last_backup_info() → str
bm.restore_backup(path) → tuple[bool, str]
```

Cada `backup` dict tiene:
```python
{
  "path": str,
  "reason": str,        # manual / pre_load / prerestore / pre_import
  "display": str,       # "2025-04-26 14:30"
  "files": int,         # cantidad
  "datetime": datetime  # objeto Python
}
```

## Notas para el port

- **MAX_BACKUPS = 7** (default), rotación FIFO (los más viejos se borran
  automáticamente).
- **4 razones** están tipadas. Cualquier otra cae al fallback gris.
- **Restoración requiere reinicio** de la app — el modal lo dice
  explícitamente.
- **Pre-restore backup** se crea automáticamente antes de restaurar
  (defensa en profundidad).
- **Patrón cards click-to-select + bottom action bar** se repite en
  varios diálogos (StreamProfilesDialog también).
