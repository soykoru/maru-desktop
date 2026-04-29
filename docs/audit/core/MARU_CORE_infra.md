# MARU Original — Infraestructura `core/` (paths + logger + config_store + version_checker)

> Módulos de infra (paths, logging, persistencia, version check).
> Total: ~430 líneas combinadas.

## `core/paths.py` (88 líneas) — rutas centralizadas

```python
ROOT_DIR = Path(__file__).parent.parent

CORE_DIR     = ROOT_DIR / "core"
GUI_DIR      = ROOT_DIR / "gui"
DATA_DIR     = ROOT_DIR / "data"
SCRIPTS_DIR  = ROOT_DIR / "scripts"
SECRETS_DIR  = ROOT_DIR / "secrets"
LOGS_DIR     = ROOT_DIR / "logs"

# Subcarpetas data
BACKUPS_DIR        = DATA_DIR / "backups"
TTS_CACHE_DIR      = DATA_DIR / "tts_cache"
DONACIONES_DIR     = DATA_DIR / "donaciones"
GAME_IMAGES_DIR    = DATA_DIR / "game_images"
ICONS_TRIGGERS_DIR = DATA_DIR / "icons_triggers"
STREAM_PROFILES_DIR = DATA_DIR / "stream_profiles"

# Files
CONFIG_FILE              = DATA_DIR / "config.json"
SOCIAL_DATA_FILE         = DATA_DIR / "social_data.json"
SOCIAL_NARRATIONS_FILE   = DATA_DIR / "social_narrations.json"
MINIGAME_STATS_FILE      = DATA_DIR / "minigame_stats.json"
TAPS_DATA_FILE           = DATA_DIR / "taps_data.json"
FORTUNES_FILE            = DATA_DIR / "fortunes.json"

# Spotify secrets
SPOTIFY_SECRETS_DIR  = SECRETS_DIR / "spotify"
SPOTIFY_ACCOUNT_FILE = SPOTIFY_SECRETS_DIR / "account"
SPOTIFY_ACCOUNTS_FILE = SPOTIFY_SECRETS_DIR / "accounts.json"
SPOTIFY_CACHE_FILE   = SPOTIFY_SECRETS_DIR / "cache"
SPOTIFY_RATE_LIMIT_FILE = SPOTIFY_SECRETS_DIR / "rate_limit"
```

### `resolve_spotify_secret(filename) → str`
Backward-compat: si existe en `secrets/spotify/`, usa esa. Si no, busca
en `data/.spotify_<legacy>` (instalaciones viejas). Sino: nueva ruta.

### `ensure_runtime_dirs()`
Crea las 7 carpetas runtime al boot.

## `core/logger.py` (93 líneas) — logger central

### `configure_logging(level=INFO, log_file=None, console=True)`
- Idempotente.
- Formato: `%(asctime)s [%(levelname)-7s] %(name)s: %(message)s`.
- Date: `%Y-%m-%d %H:%M:%S`.
- `RotatingFileHandler`: max 2MB × 5 archivos backup.
- Default file: `logs/livechaos.log`.
- Silencia loggers ruidosos: `urllib3, spotipy, httpx, websockets`
  → `WARNING`.

### `get_logger(name) → logging.Logger`
Auto-llama `configure_logging()` la 1ra vez.

### `as_callback(logger_name, level=INFO) → Callable[[str], None]`
Adapter para código viejo que espera `Callable[[str], None]`:
```python
spotify = SpotifyClient(log=as_callback("spotify"))
```

## `core/config_store.py` (148 líneas) — partición de config

Divide el `config.json` legacy en **4 archivos** para evitar corrupción
y mejorar performance:

```
config.json    → settings primitivos (theme, volumes, voices, ia, spotify, games básicos)
gifts.json     → custom_gifts (484 items, 102KB)
games.json     → custom_games + game_configs + entity_images
profiles.json  → profile_sounds + profile_voices + global_voices
```

### `KEY_TO_FILE` mapping
```python
{
  "custom_gifts": "gifts.json",
  "custom_games": "games.json",
  "game_configs": "games.json",
  "entity_images": "games.json",
  "profile_sounds": "profiles.json",
  "profile_voices": "profiles.json",
  "global_voices": "profiles.json",
}
```

Resto de keys → `config.json`.

### `_write_json_atomic(path, data)`
```python
tmp = path.with_suffix(suffix + ".tmp")
with open(tmp, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.flush()
    os.fsync(f.fileno())  # ⭐ Evita corrupción ante crash
os.replace(tmp, path)     # atomic rename
```

### `load_config() → dict`
Lee `config.json` + 3 particionados, mergea (los particionados ganan).

### `save_config(config)`
Buckets por archivo destino, escribe atómico solo los archivos con
contenido (excepto `config.json` que siempre se escribe como ancla).

### `migrate_from_monolithic() → bool`
- Si ya está particionado: skip.
- Si solo existe `config.json` con keys que deben ir a otros archivos:
  divide automáticamente.
- Idempotente (safe llamar múltiples veces).

Llamado desde `MainWindow.load_config()` al boot.

## `core/version_checker.py` (105 líneas) — check de TikTokLive

### Constantes
```python
PYPI_URL = "https://pypi.org/pypi/TikTokLive/json"
HEADERS = {"User-Agent": "LiveChaosEngine/8.5"}
KNOWN_GOOD_VERSIONS = ["6.6.5", "6.6.4", "6.6.3", "6.6.2", "6.6.1", "6.6.0"]
```

### `get_installed_version() → str | None`
1. Intenta `import TikTokLive` y leer `__version__`.
2. Fallback: `pip show TikTokLive` parsing.

### `get_latest_version() → (version, summary)`
GET PyPI `/pypi/TikTokLive/json`. Returns `(info.version, info.summary)`.

### `check_update() → dict`
```python
{
  "installed": "6.6.5" | "No instalado",
  "latest": "6.6.7" | "Error al consultar",
  "summary": "...",
  "update_available": bool,
  "status": "up_to_date" | "update_available" | "not_installed" | "check_failed"
}
```

### `update_tiktok_live(target_version="") → (bool, msg)`
Ejecuta `pip install --upgrade TikTokLive[==<version>]` con timeout 120s.
Captura stdout/stderr.

### `rollback_version(version) → (bool, msg)`
- Verifica `version in KNOWN_GOOD_VERSIONS`.
- Llama `update_tiktok_live(version)`.

## Notas para el port

- **Paths centralizados** — replicar idéntico en sidecar Python.
- **Logger central** con rotación 2MB × 5 archivos — replicar.
- **Particionado de config** es ideal para evitar reescribir 102KB cada
  cambio. Mantenerlo en sidecar.
- **`os.fsync` + atomic rename** garantiza no-corruption ante crash.
  CRÍTICO para userdata.
- **Migración legacy** — si el user tiene un MARU instalado con
  `config.json` monolítico viejo, se migra automáticamente al boot.
- **Version checker** usa PyPI directamente — para Electron app que
  empaqueta TikTokLive en el sidecar, este flujo cambia: el upgrade del
  sidecar debe ser parte del autoupdater de Electron, no `pip install`
  desde la app.
- **`KNOWN_GOOD_VERSIONS`** es lista de versiones probadas — al pinear
  TikTokLive en `requirements.txt` del sidecar, mantener esta lista
  para rollback rápido.
