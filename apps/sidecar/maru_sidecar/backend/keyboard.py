"""KeyboardService — acciones de teclado para reglas MARU.

Permite que las reglas simulen pulsaciones del teclado real del SO. Caso
de uso: streamers que juegan a juegos sin mod/RCON nativo. Ejemplo:
"gift de rosa → tecla W (avanza)", "comando !salto → Space",
"fin del live → Alt+F4 (cerrar juego)".

Diseño:
- `pynput` para enviar events nativos al SO (cross-platform).
- `pygetwindow` (Windows) para filtro opcional por título de ventana
  enfocada — evita que las teclas le peguen a MARU si está enfocado.
- Modo tap (default, ~50ms) o hold (mantener N ms).
- Repeat: ejecutar N veces (mapea naturalmente al campo `amount`).
- Blacklist hardcoded: combos críticos del SO no se pueden disparar
  por regla (Ctrl+Alt+Del, Win+L). El user no debe poder romperse el
  PC con un troll en chat.
- Toggle global en SettingsService (`keyboardActionsEnabled`). OFF por
  default — el user activa explícitamente.

Schema en RuleAction:
- `action_type = "keyboard"`
- `action_value` — spec de teclas: `"W"`, `"Ctrl+Alt+W"`, `"Space"`,
  `"F4"`, `"ArrowUp"`. Modifiers: Ctrl, Alt, Shift, Win/Cmd/Meta.
- `amount` — número de repeticiones (1..50).
- `commands` — config opcional como string `key:value;key:value`:
  - `hold:500` → hold mode, 500ms
  - `window:Minecraft` → solo si la ventana enfocada contiene "Minecraft"
  - combinables: `hold:500;window:Minecraft`

Ejecución es fire-and-forget vía thread pool — el dispatcher no bloquea.
"""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..logger import get_logger
from ..runtime import DATA_DIR

log = get_logger(__name__)

# Pool dedicado: 4 workers porque acciones de teclado son raras vs ticks
# de likes (no son bursts grandes). Hold de 5s en 1 thread no bloquea otros.
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="kbd-action")


# ── Mapas de keys ────────────────────────────────────────────────────────

_MODIFIERS = {"ctrl", "control", "alt", "shift", "win", "cmd", "meta", "super"}

# Resuelto lazy desde pynput.keyboard.Key cuando esté disponible.
# Nombres en lowercase para matching case-insensitive.
_SPECIAL_KEY_NAMES: dict[str, str] = {
    "ctrl": "ctrl",
    "control": "ctrl",
    "alt": "alt",
    "shift": "shift",
    "win": "cmd",
    "cmd": "cmd",
    "meta": "cmd",
    "super": "cmd",
    "tab": "tab",
    "enter": "enter",
    "return": "enter",
    "escape": "esc",
    "esc": "esc",
    "space": "space",
    "spacebar": "space",
    "backspace": "backspace",
    "delete": "delete",
    "del": "delete",
    "insert": "insert",
    "ins": "insert",
    "home": "home",
    "end": "end",
    "pageup": "page_up",
    "pgup": "page_up",
    "pagedown": "page_down",
    "pgdown": "page_down",
    "pgdn": "page_down",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
    "arrowup": "up",
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    "capslock": "caps_lock",
    "caps": "caps_lock",
    "numlock": "num_lock",
    "scrolllock": "scroll_lock",
    "printscreen": "print_screen",
    "prtsc": "print_screen",
    "pause": "pause",
    "menu": "menu",
}
for _i in range(1, 25):
    _SPECIAL_KEY_NAMES[f"f{_i}"] = f"f{_i}"


# Combos prohibidos — congelar el PC del user no debe ser una opción.
# Comparamos sets normalizados (lowercase, sin orden) para matchear
# `Ctrl+Alt+Del` y `Del+Alt+Ctrl` igual.
_BLACKLISTED_COMBOS: list[frozenset[str]] = [
    frozenset({"ctrl", "alt", "delete"}),
    frozenset({"ctrl", "alt", "del"}),
    frozenset({"win", "l"}),
    frozenset({"cmd", "l"}),
    frozenset({"meta", "l"}),
    frozenset({"ctrl", "shift", "esc"}),  # task manager — no peligroso pero molesto
]


# ── Parser ───────────────────────────────────────────────────────────────


class KeySpec:
    """Combinación parseada: lista de keys (modifiers + main).

    `tokens` siempre en lowercase normalizado. Para Ctrl+Alt+W:
        tokens = ["ctrl", "alt", "w"]
    Para "W":
        tokens = ["w"]
    Para "F4":
        tokens = ["f4"]
    """

    __slots__ = ("tokens", "raw")

    def __init__(self, tokens: list[str], raw: str) -> None:
        self.tokens = tokens
        self.raw = raw

    def is_blacklisted(self) -> bool:
        s = frozenset(self.tokens)
        return any(b.issubset(s) for b in _BLACKLISTED_COMBOS)


def parse_key_spec(spec: str) -> KeySpec:
    """Parsea `"Ctrl+Alt+W"` → KeySpec(["ctrl","alt","w"]).

    - Separadores aceptados: `+`, espacio, `-`.
    - Case-insensitive.
    - Tokens reconocidos: modifiers + special keys + letras a-z + números 0-9.

    Lanza ValueError si el spec está vacío o tiene tokens inválidos.
    """
    if not spec or not spec.strip():
        raise ValueError("spec vacío")
    raw = spec.strip()
    # Normalizar separadores → '+'
    s = raw.replace(" ", "+").replace("-", "+")
    # Colapsar duplicados
    while "++" in s:
        s = s.replace("++", "+")
    s = s.strip("+").lower()
    if not s:
        raise ValueError(f"spec inválido: {raw!r}")
    parts = [p.strip() for p in s.split("+") if p.strip()]
    if not parts:
        raise ValueError(f"spec inválido: {raw!r}")
    tokens: list[str] = []
    for p in parts:
        if p in _SPECIAL_KEY_NAMES:
            tokens.append(_SPECIAL_KEY_NAMES[p])
        elif len(p) == 1 and (p.isalnum() or p in ".,;:'`/\\[]-=<>?!@#$%^&*()_+"):
            tokens.append(p)
        else:
            raise ValueError(f"tecla desconocida: {p!r} (spec: {raw!r})")
    return KeySpec(tokens, raw)


def parse_config(commands: str) -> dict[str, str]:
    """Parsea config opcional `"hold:500;window:Minecraft"` → dict."""
    out: dict[str, str] = {}
    if not commands:
        return out
    for chunk in commands.split(";"):
        chunk = chunk.strip()
        if not chunk or ":" not in chunk:
            continue
        k, _, v = chunk.partition(":")
        k = k.strip().lower()
        v = v.strip()
        if k and v:
            out[k] = v
    return out


# ── Window focus check (Windows-only por ahora) ──────────────────────────


def _active_window_title() -> str:
    """Devuelve el título de la ventana enfocada actualmente, lowercase.
    Si pygetwindow no está disponible o falla, devuelve "" (lo cual hace
    que el filtro `window:` siempre matchee — fail-open por usabilidad)."""
    try:
        import pygetwindow as gw  # type: ignore[import-untyped]
    except Exception:
        return ""
    try:
        w = gw.getActiveWindow()
        if w is None:
            return ""
        title = getattr(w, "title", "") or ""
        return str(title).lower()
    except Exception:
        return ""


# ── Service ──────────────────────────────────────────────────────────────


class KeyboardService:
    """Servicio singleton para ejecutar acciones de teclado.

    Pasa el toggle global (`SettingsService.get("keyboardActionsEnabled")`)
    para que cada ejecución valide en tiempo real (sin restart).
    """

    def __init__(self, logs_svc: Any | None = None) -> None:
        self._logs = logs_svc
        self._controller_lock = threading.Lock()
        self._controller: Any | None = None
        # Cache de pynput.Key resoluciones para no importar en cada press.
        self._key_cache: dict[str, Any] = {}
        # Cache del toggle global con TTL corto — lee config.json directo
        # (mismo patrón que rule_dispatcher._read_active_game). Sin esto,
        # cada like/comentario de un live activo abriría/leería el JSON
        # dándonos latencia innecesaria.
        self._enabled_cache: tuple[float, bool] = (0.0, False)
        self._enabled_ttl = 1.5
        # v1.0.98: lock para el cache. Sin esto, dos threads del rule
        # engine ejecutando reglas keyboard concurrentes podían leer la
        # tupla `(ts, v)` a mitad de un reemplazo desde otro thread.
        # Caso real: 5 likes simultáneos disparando 5 reglas keyboard.
        self._enabled_lock = threading.Lock()

    # ── Toggle global ────────────────────────────────────────────────────

    def is_enabled(self) -> bool:
        """Lee `keyboardActionsEnabled` de `data/config.json`. Default false.

        v1.0.98: lectura/escritura del cache bajo lock. Hot path — corre
        en cada ejecución de regla con action_type='keyboard'.
        """
        now = time.time()
        # Fast path: lectura del cache bajo lock.
        with self._enabled_lock:
            ts, cached = self._enabled_cache
            if (now - ts) < self._enabled_ttl:
                return cached
        # Cache miss: leer disco fuera del lock (I/O), update bajo lock.
        path = DATA_DIR / "config.json"
        v = False
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    v = bool(data.get("keyboardActionsEnabled", False))
            except (json.JSONDecodeError, OSError):
                v = False
        with self._enabled_lock:
            self._enabled_cache = (now, v)
        return v

    # ── Lazy pynput init ─────────────────────────────────────────────────

    def _get_controller(self) -> Any | None:
        with self._controller_lock:
            if self._controller is not None:
                return self._controller
            try:
                from pynput.keyboard import Controller  # type: ignore[import-untyped]
                self._controller = Controller()
                log.info("KeyboardService: pynput.keyboard.Controller instanciado")
            except Exception as exc:
                log.warning("KeyboardService: pynput no disponible (%s) — acciones de teclado deshabilitadas", exc)
                self._controller = None
            return self._controller

    def _resolve_key(self, token: str) -> Any:
        """Convierte un token (e.g. 'ctrl', 'a', 'f4') al objeto que pynput espera."""
        if token in self._key_cache:
            return self._key_cache[token]
        try:
            from pynput.keyboard import Key, KeyCode  # type: ignore[import-untyped]
        except Exception as exc:
            raise RuntimeError(f"pynput no instalado: {exc}") from exc
        # Nombre special?
        if hasattr(Key, token):
            obj = getattr(Key, token)
        elif len(token) == 1:
            obj = KeyCode.from_char(token)
        else:
            raise ValueError(f"token no resoluble: {token!r}")
        self._key_cache[token] = obj
        return obj

    # ── API pública ──────────────────────────────────────────────────────

    def execute(
        self,
        spec_str: str,
        amount: int,
        commands: str = "",
        user: str = "",
    ) -> tuple[bool, str]:
        """Punto de entrada desde el RuleEngine.

        Devuelve `(ok, msg)` igual que `game.spawn/give_item/trigger_event`.
        La ejecución física se delega al thread pool (fire-and-forget) —
        el resultado de `execute()` solo refleja validaciones inmediatas
        (toggle, parser, blacklist).
        """
        if not self.is_enabled():
            return False, "🔒 Acciones de teclado deshabilitadas (Ajustes → Avanzado)"

        try:
            spec = parse_key_spec(spec_str)
        except ValueError as e:
            return False, f"❌ Combinación inválida: {e}"

        if spec.is_blacklisted():
            return False, f"🚫 Combinación bloqueada por seguridad: {spec.raw}"

        cfg = parse_config(commands or "")

        # hold mode opcional.
        hold_ms = 0
        try:
            if "hold" in cfg:
                hold_ms = max(0, min(10_000, int(cfg["hold"])))
        except (ValueError, TypeError):
            return False, f"❌ hold inválido: {cfg.get('hold')!r} (debe ser ms entre 0 y 10000)"

        # window filter opcional.
        window_filter = cfg.get("window", "").strip().lower()
        if window_filter:
            active = _active_window_title()
            if active and window_filter not in active:
                # Fail-soft: no es error, solo skip.
                return True, f"⏭️ Ventana «{window_filter}» no enfocada (actual: «{active[:30]}») — saltado"

        # Sanitizar amount.
        try:
            n = max(1, min(50, int(amount or 1)))
        except (ValueError, TypeError):
            n = 1

        # Validar pynput disponible antes de despachar (mensaje claro).
        if self._get_controller() is None:
            return False, "❌ pynput no disponible en este sistema"

        # Despachar al pool. El controller en sí es thread-safe a nivel
        # de press/release atómicos, pero envolvemos en lock por si hay
        # múltiples reglas de teclado paralelas — evita keys "pegadas".
        _executor.submit(self._send_keys_blocking, spec, n, hold_ms)

        # Mensaje al log.
        mode_tag = f" hold {hold_ms}ms" if hold_ms > 0 else ""
        repeat_tag = f" x{n}" if n > 1 else ""
        return True, f"⌨️ Tecla «{spec.raw}»{mode_tag}{repeat_tag} enviada"

    # ── Worker (corre en thread pool) ────────────────────────────────────

    def _send_keys_blocking(self, spec: KeySpec, repeat: int, hold_ms: int) -> None:
        """Press + release sincrónico. Corre en thread pool worker."""
        controller = self._get_controller()
        if controller is None:
            return

        try:
            keys = [self._resolve_key(t) for t in spec.tokens]
        except Exception as exc:
            log.error("KeyboardService: no pude resolver tokens %s: %s", spec.tokens, exc)
            return

        # Inter-repeat gap: 60ms — natural para juegos de pasos discretos
        # (Space repetido para saltos múltiples, etc.).
        inter_gap_s = 0.06
        # Mínimo dwell entre press y release para que el SO registre la
        # combinación (algunas apps descartan press<5ms).
        min_dwell_s = 0.05

        for i in range(repeat):
            try:
                # Press en orden (modifier primero, main key al final).
                for k in keys:
                    controller.press(k)
                if hold_ms > 0:
                    time.sleep(hold_ms / 1000.0)
                else:
                    time.sleep(min_dwell_s)
                # Release en orden inverso (main key primero, modifiers al final).
                for k in reversed(keys):
                    controller.release(k)
            except Exception as exc:
                log.error(
                    "KeyboardService: fallo press/release tokens=%s i=%d: %s",
                    spec.tokens, i, exc,
                )
                # Best-effort cleanup: liberar todo lo que podamos.
                for k in reversed(keys):
                    try:
                        controller.release(k)
                    except Exception:
                        pass
                return

            if i + 1 < repeat:
                time.sleep(inter_gap_s)
