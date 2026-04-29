# Paridad funcional MARU v8.5 (PyQt6) ↔ MARU Desktop v1.0.0

Esta tabla documenta qué features del MARU original están cubiertas por
MARU Desktop, qué quedó mejor y qué (si algo) se decidió dejar.

## ✅ Paridad completa

| Feature original | Implementación nueva | Mejora |
|---|---|---|
| Conexión TikTok Live (TikTokWorker QThread) | `tiktok.connect/disconnect/status` reusa `core.tiktok_client.TikTokWorker` | Lazy import: Qt sólo se carga al conectar |
| Eventos en vivo (gift/like/follow/share/comment/command) | Push event `tiktok:event` por WebSocket → store zustand → UI | Feed circular max 200 eventos en memoria |
| Reglas por juego (trigger → acción) | `rules.*` con persistencia atómica | Editor inline + reorder + dry-run + backup auto |
| Multi-acción + modo aleatorio | Mantenido en estructura `Rule.actions[]` + `randomPick` | UI clara para configurar |
| 4 juegos: Valheim, Terraria, Minecraft, Custom | `games.*` reusa las clases originales | ThreadPool acotado (2 workers) |
| Datos por juego (entidades/items/eventos) | `data.*` con CRUD + búsqueda server-side | Búsqueda con debounce + import/export |
| TTS 3 canales (chat / social / fortune) | `tts.*` reusa `core.tts_engine.TTSEngine` | Mismo backend, UI de prueba |
| IA multi-proveedor (Groq/Gemini/OpenAI/Claude) | `ia.*` reusa `core.ia_engine.IAEngine` | Probador inline en la app |
| Sistema social (duelos/relaciones/ranking/tarot) | `social.*` reusa `core.social_system.SocialSystem` | Comandos siguen funcionando |
| Spotify (now-playing/cola/anti-rate-limit) | `spotify.*` reusa `core.spotify_client.SpotifyClient` | Controles UI + barra de progreso |
| Stream Profiles | `profiles.*` propio | SHA-256, export portable JSON, import |
| Backups automáticos | `backups.*` propio (escritura atómica + retención dual) | Hash, locks, manifest indexado |
| Logs en archivo | `logs.tail` con rotación 5 MB × 5 | Filtros por nivel y contenido en UI |
| Overlays web (Cloudflare) | `overlays.*` reusa `core.overlays.OverlayClient` | Galería con copy/test |
| Empaquetado EXE | PyInstaller `--onedir` + electron-builder NSIS | Instalador firmado, auto-update |

## 🚀 Mejoras estructurales (no estaban en el original)

| Mejora | Detalle |
|---|---|
| Auto-update | electron-updater + GitHub Releases. Banner global + Settings. |
| 3 temas | Midnight (default) · Aurora (claro) · Cyberpunk (neon) |
| Hardening producción | DevTools off · navegación bloqueada · permisos negados |
| Telemetría opt-in | Sentry como dep opcional, sanitizada |
| Métricas live | RAM/CPU/threads/bus en Dashboard + Settings |
| Profiling tracemalloc | Opt-in para diagnóstico de memoria |
| Idle pause | Polling se detiene cuando la ventana no está visible |
| Asistente de migración | Importa data del MARU original con backup |
| Mockups navegables | `docs/design/` con 12 pantallas en HTML |
| Tests automatizados | 35+ tests Python con pytest |
| Lazy routes | Bundle inicial 30% más chico (~340 KB) |
| Custom title bar | Frameless con drag region y botones nativos |
| Toasts globales | Errors persistentes, success auto-dismiss |
| Stream profiles portables | Snapshot completo con SHA-256, JSON exportable |
| Backups atómicos | `os.replace` con rename, hash de integridad |
| Quickcheck | Health check sin deps que valida todo el repo |
| EventBus thread→asyncio | Desacopla Qt del transporte WS |

## 🟰 Equivalencias 1:1 (no se rompió nada)

- Formato `data/*.json` se mantuvo idéntico → la migración es copia simple.
- Reglas tienen exactamente los mismos triggers (gift/follow/share/like/comment/command)
  y acciones (spawn/give_item/trigger_event/tts).
- `core.tiktok_client.TikTokWorker` se importa sin tocar → señales PyQt
  intactas, sólo se mapean al EventBus.
- `core.games.{Valheim,Terraria,Minecraft,Custom}Game` se instancian con
  los mismos parámetros (host/port/password) y métodos (spawn/give_item/trigger_event).

## ❌ No portado (decisiones explícitas)

| Feature original | Por qué no |
|---|---|
| `gui.py` monolítico ~14k líneas | Reemplazado por React + componentes reutilizables |
| QWebEngineView para preview | Electron ya es Chromium, los overlays se servían desde Cloudflare |
| `MaruLive.spec` viejo | Reemplazado por `apps/sidecar/sidecar.spec` |
| `CREAR_EXE_COMPLETO.bat` | Reemplazado por `pnpm release patch` |
| Sistema de temas como QSS | Reemplazado por CSS variables + 3 temas operativos |

## Cómo migrar tu instalación actual

1. Abrí MARU Desktop por primera vez.
2. Aparecerá la pantalla **Bienvenido**.
3. Si el original está en su ruta default (`MARU PRO/LiveChaosEngine/LiveChaosEngine_Refactored/`),
   lo detecta automáticamente.
4. Listará los archivos con tamaños y badges de "ya existe en runtime".
5. Click **Importar N archivos** → backup automático + copia atómica + report.
6. Listo: tus reglas, datos, social, gifts, profiles, configuración están en el nuevo MARU.

> ⚠️ El original NO se modifica. Si algo sale raro, podés borrar la carpeta
> `apps/sidecar/runtime_data/` y volver a empezar.

## Validación a hacer la primera vez

1. ¿Las reglas existentes aparecen en `/rules`? → ✓ migración OK.
2. ¿Los datos por juego aparecen en `/data`? → ✓.
3. ¿Conexión TikTok funciona con tu @usuario? → reusa el worker original.
4. ¿Los juegos responden a `games.test`? → reusa las clases originales.
5. ¿Spotify se autoconecta si tenías credenciales? → `core.spotify_client` se inicializa lazy.
6. ¿IA responde a `ia.ask`? → `core.ia_engine` se inicializa lazy.
