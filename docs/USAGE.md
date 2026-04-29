# Manual de uso — MARU Live Desktop v1.0.0

Guía práctica para streamers. Asume que ya instalaste la app
(ver `FIRST_RUN.md` si todavía no).

---

## Primer uso

Al abrir MARU Desktop por primera vez vas a ver la pantalla de
**Bienvenido**.

- **Si tenías MARU original instalado**, te detecta automáticamente y te
  ofrece importar tus reglas, datos, perfiles y configuración. Click en
  **Importar N archivos** → listo en 1 segundo (con backup automático).
- **Si nunca usaste MARU**, click en **Empezar desde cero** y al Dashboard.

A partir de ahí, MARU recuerda que ya viste la welcome — no la verás
de nuevo.

---

## Layout principal

```
┌─────────────────────────────────────────────────┐
│ ● MARU Live · Dashboard           ─  ▢  ✕      │  ← TitleBar
├─────────────────────────────────────────────────┤
│ ┌─────┐ ┌─────────────────────────────────────┐ │
│ │ ✨  │ │                                     │ │
│ │     │ │                                     │ │
│ │ Nav │ │     Contenido de la pestaña         │ │
│ │     │ │                                     │ │
│ │     │ │                                     │ │
│ └─────┘ └─────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ sidecar ● rpc ● tiktok ●  │  👁 1240 💎 580 ❤ 9k │  ← StatusBar
└─────────────────────────────────────────────────┘
```

- **TitleBar**: arrastrá la zona del nombre para mover la ventana.
  Botones nativos a la derecha.
- **Sidebar**: 11 secciones + Ajustes. Click en `<` abajo para colapsarla
  y ganar ancho.
- **StatusBar**: tu fuente de verdad sobre el sistema. Si todo está verde,
  todo funciona.

---

## Flujo diario típico

### 1. Conectar TikTok
1. Click en **Conexión** (sidebar).
2. Ingresá tu @usuario (sin el @, hay un prefix automático).
3. **Conectar** → la status bar pasa a verde.

Una vez conectado, el feed en vivo va llenándose de gifts/likes/follows/
comentarios/comandos en tiempo real.

### 2. Activar tus reglas
1. Click en **Reglas**.
2. Tab del juego con el que vas a streamear (Valheim/Terraria/Minecraft/Custom).
3. Cada regla tiene un switch: prendé las que quieras esta sesión.
4. Si necesitás ajustar parámetros (ej. cantidad de gifts mínimos),
   click en la regla → editor → guardar.

### 3. Probar antes de salir en vivo
- En cada regla, **Test** dispara un dry-run que muestra qué haría
  sin ejecutarlo en el juego.
- En **Datos**, click en una entidad/item → confirmá que el "comando
  interno" coincide con el del juego.
- En **Conexión**, podés arrancar simulado: el original tiene un
  simulador (cuando esté disponible vía core).

### 4. Durante el live
- **Dashboard** te muestra: stats live (viewers, likes, diamantes, shares),
  últimos 8 eventos, salud del sistema (RAM/CPU del sidecar).
- **Logs** sirve si algo no responde como esperabas.
- Si hay errores, **toasts persistentes** en el ángulo inferior derecho
  hasta que los cierres.

### 5. Después del live
- Cerrar la app: la conexión TikTok se baja limpio, los datos quedan
  guardados.
- Si querés snapshot de cómo quedó la config, **Perfiles** → Guardar
  perfil actual.

---

## Atajos visuales

| Acción | Cómo |
|---|---|
| Cambiar tema | Ajustes → Apariencia → Midnight / Aurora / Cyberpunk |
| Buscar en datos | Datos → input arriba a la derecha |
| Filtrar logs | Logs → input + segmented buttons por nivel |
| Limpiar feed | Conexión → ícono de papelera arriba del feed |
| Recargar overlay | Overlays → ícono recargar en cada card |
| Buscar update | Ajustes → Avanzado → Buscar ahora |
| Ver métricas | Ajustes → Sistema (también mini en Dashboard) |
| Probar IA | IA → user + pregunta → Enviar |

---

## Stream Profiles (la feature más útil)

Si stremás con configs distintas según el juego o el día (modo casual vs
hardcore vs colab), los **Stream Profiles** son tu mejor amigo:

1. Configurá MARU como querés (reglas + datos + games + IA).
2. **Perfiles → Guardar perfil actual** con un nombre descriptivo.
3. Antes de cada stream, **Cargar** el perfil que necesitás.

Cada perfil incluye:
- Reglas de los 4 juegos.
- Datos por juego (entities/items/events).
- Configuración de juegos (host/port/password).
- `config.json` general.
- Hash SHA-256 para detectar drift.

**Exportar** descarga un `.maru-profile.json` portable. Podés
mandárselo a otro streamer y que lo importe en su MARU.

---

## Backups automáticos

Cada vez que editás una regla, un dato, o aplicás una migración, MARU
crea un **backup atómico** del scope correspondiente:

- **Retención dual**: max 20 backups por scope o max 30 días, lo que
  pase primero.
- **Hash SHA-256** para validar integridad al restore.
- Los podés ver y manejar en el código (UI dedicada vendrá si la pedís).
- Viven en `runtime_data/backups/<id>/`.

Si querés volver atrás: `pnpm dev:sidecar` y desde otra terminal podés
golpear `backups.list` y `backups.restore` por RPC. La UI de gestión es
F9 si la pedís.

---

## Auto-update

MARU Desktop revisa GitHub Releases:
- **Al boot**.
- **Cada 6 horas** mientras esté abierta.

Cuando hay una versión nueva:
1. La descarga **en background** (no interrumpe el stream).
2. Cuando termina, aparece un **banner violeta** arriba: "Versión X.Y.Z lista".
3. Click en **Reiniciar e instalar** para aplicar (cuando vos quieras —
   nunca en mitad de un live).

Si querés desactivar auto-update: **Ajustes → Avanzado → Auto-actualización**
off. (Nota: al reiniciar la app vuelve a activarse — decisión consciente
para que no quedes con bugs viejos.)

---

## Troubleshooting durante el stream

| Síntoma | Qué hacer |
|---|---|
| TikTok status en rojo | Click Conexión → Desconectar → Conectar de nuevo |
| Status sidecar en rojo | Reiniciar la app (el sidecar se relanza solo) |
| Reglas no disparan acciones en juego | Datos: chequear que el "comando interno" sea el correcto del juego |
| Spotify rate-limit (modo dev) | Esperar 30s; el anti-rate-limit del original sigue activo |
| RAM creciendo en Dashboard | Revisar Logs por errores; reiniciar app si pasa de 400 MB |
| Banner de update durante live | Ignoralo; reiniciás cuando termines |

---

## Datos persistidos · dónde viven

```
runtime_data/                         # apps/sidecar/runtime_data en dev
├── data/                             # tu config — la fuente de verdad
│   ├── rules_valheim.json
│   ├── rules_terraria.json
│   ├── ...
│   ├── data_valheim.json
│   ├── games.json
│   └── config.json
├── logs/
│   └── sidecar.log                   # rotación 5MB × 5
├── backups/
│   ├── rules-1745.../                # backup automático
│   └── full-1745.../
├── profiles/
│   └── p-1745.../                    # tus stream profiles
├── cache/
│   └── tts/                          # cache de TTS si lo usás
└── secrets/
    └── spotify/                      # credenciales Spotify
```

En producción (build instalado), `runtime_data/` se llama distinto y
está en `%APPDATA%/MARU Live/`.

---

## Variables de entorno útiles

Copiá `.env.example` a `.env` y editá lo que necesites:

```bash
# Path al MARU original (default lo busca solo)
MARU_CORE_ROOT=C:\path\al\LiveChaosEngine_Refactored

# Carpeta runtime
MARU_RUNTIME_DIR=

# DevTools en dev
MARU_DEVTOOLS=1

# Profiling de memoria
MARU_TRACEMALLOC=1

# Desactivar auto-updater
MARU_DISABLE_UPDATER=1
```

---

## Reportar problemas / pedidos

Cuando reportes un bug o pedís una feature, incluí:

1. **Versión**: la del Sidebar abajo a la izquierda.
2. **Tema en uso**.
3. **Captura** de la pestaña afectada.
4. **Logs**: tab Logs → Copiar últimas 50 líneas.
5. **Métricas**: tab Sistema → screenshot.
6. **Pasos para reproducir**.

Eso me alcanza para diagnosticar el 95% de los issues sin tener que
acceder a tu máquina.
