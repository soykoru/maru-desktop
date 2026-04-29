# MARU Original — Audit (Plan G · Fase G0)

> **Fuente de verdad**: `C:/Users/User/Desktop/MARU PRO/LiveChaosEngine/LiveChaosEngine_Refactored`
> **Destino del port**: `C:/Users/User/Desktop/MARU PRO/maru-desktop/`

Esta carpeta contiene la **auditoría exhaustiva** de MARU Live original
(PyQt6, ~14k líneas) que produce el contrato técnico de qué portar al
nuevo MARU Desktop (Electron + React + sidecar Python).

## Reglas firmes (no negociables)

1. **MARU original = única referencia válida.** Lo que no está ahí, no se mete.
2. **Lo que está, va al 100%.** Sin "MVP", sin reemplazos sintéticos.
3. **Tema único oscuro.** Borrar Aurora y Cyberpunk inventados.
4. **TTS no es pestaña**, es interno (solo se expone en `voices_dialog`).
5. **Galería de imágenes = prioridad #1.** Sin las 415 PNG no es MARU.
6. **Reglas multi-action + random_action son obligatorias.**
7. **G0 es DESCUBRIMIENTO ABIERTO.** Todo lo nuevo se mapea a una fase.
8. **Cero código de aplicación en G0.** Solo audit + documentos.
9. **Antes de cerrar cualquier fase G**, comparar pestaña-por-pestaña
   con MARU original.

## Estructura de la auditoría

```
docs/audit/
├── README.md                       (este archivo — índice)
├── MARU_ORIGINAL_AUDIT.md          (documento maestro, índice general)
├── MARU_INVENTORY_RAW.md           (inventario crudo de archivos)
├── MARU_FEATURE_MATRIX.md          (Feature × Archivo × Diálogo × JSON × Fase)
├── MARU_VISUAL_AUDIT.md            (paleta + logo + fuentes + QSS + splash)
├── MARU_JSON_SCHEMAS.md            (todos los JSON con schema y ejemplos)
├── MARU_ASSETS_INVENTORY.md        (415 PNG donaciones + game_images + iconos)
├── MARU_PLAN_G_FINAL.md            (plan revisado, reemplaza al borrador G1-G14)
├── MARU_CLEANUP_BEFORE_G1.md       (qué borrar/revertir antes de empezar G1)
├── MARU_MAIN_WINDOW.md             (audit detallado de gui/main_window.py)
├── dialogs/                        (un archivo por diálogo, 16 archivos)
│   ├── MARU_DIALOG_01_backup.md
│   ├── MARU_DIALOG_02_custom_game.md
│   ├── ...
│   └── MARU_DIALOG_16_voices.md
├── views/                          (audit de gui/views/*)
│   └── MARU_VIEW_<nombre>.md
└── core/                           (audit de core/*.py)
    ├── MARU_CORE_tiktok_client.md
    ├── MARU_CORE_rule_engine.md
    └── ...
```

## Criterio de cierre de G0

G0 cierra **solo si**:

- [ ] Cada `.py` de gui/ y core/ tiene su sección documentada.
- [ ] Cada JSON tiene schema documentado.
- [ ] Cada imagen está en el inventario.
- [ ] La matriz "feature × fase" no tiene huecos.
- [ ] El plan revisado cubre el 100% del audit.
- [ ] Nada en el audit es "TBD" — todo está mapeado a una fase.
- [ ] La identidad visual (paleta, logo, QSS) está extraída con valores exactos.

## Cómo leer este audit

- Empezar por `MARU_ORIGINAL_AUDIT.md` (índice general).
- Bajar a la sección que interese (diálogos, core, visual, JSON).
- La matriz `MARU_FEATURE_MATRIX.md` resuelve cualquier pregunta del estilo
  "¿dónde vive feature X y a qué fase G se asigna?".
- El plan final vive en `MARU_PLAN_G_FINAL.md` — es el contrato.
