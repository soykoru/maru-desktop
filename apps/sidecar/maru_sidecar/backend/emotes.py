"""Servicio `emotes.*` — galería de emotes/stickers por streamer.

Esta feature NO existe en el MARU original — se crea desde cero porque
TikTokLive 6.6.5 expone `EmoteChatEvent` con `emote_list[*].image.m_urls`
(equivalente a gifts) pero el original nunca lo cabló.

Estructura en disco (multi-account):
    runtime_data/data/emotes/
        <streamer_username>/
            avatar.png                  ← foto de perfil del streamer
            manifest.json               ← {streamer, displayName, emotes: {<id>: {soundPath?}}}
            <emote_id>.png              ← un PNG por emote
        <otro_streamer>/...

Cuando un emote llega en chat:
  1. `EmotesService.on_emote_detected(streamer, emote_id, image_url)` descarga
     PNG si no existe.
  2. Si hay `soundPath` asignado → reproduce vía `SoundsService.play_for_emote`.
  3. Publica `emotes:updated` push event para que la galería refresque.

RPC methods:
  - `emotes.list-streamers` → [{username, displayName, avatar?, emoteCount}]
  - `emotes.list` → params {streamer} → [{emoteId, path, soundPath?}]
  - `emotes.assign-sound` → {streamer, emoteId, soundPath}
  - `emotes.delete` → {streamer, emoteId}
  - `emotes.set-streamer-avatar` → {username, avatarUrl?}
"""

from __future__ import annotations

import io
import json
import re
import threading
from pathlib import Path
from typing import Any

from ..event_bus import get_event_bus
from ..logger import get_logger
from ..runtime import EMOTES_DIR

log = get_logger(__name__)

_STREAMER_RE = re.compile(r"^[a-zA-Z0-9_.\-]{2,64}$")


def _safe_streamer(name: Any) -> str:
    if not isinstance(name, str):
        raise TypeError("streamer requerido")
    s = name.strip().lstrip("@")
    if not _STREAMER_RE.match(s):
        raise ValueError(f"streamer inválido: {name!r}")
    return s


def _safe_emote_id(eid: Any) -> str:
    if not isinstance(eid, str):
        raise TypeError("emoteId requerido")
    s = eid.strip()
    if not s or len(s) > 128 or "/" in s or "\\" in s or ".." in s:
        raise ValueError(f"emoteId inválido: {eid!r}")
    return s


def _streamer_dir(streamer: str) -> Path:
    return EMOTES_DIR / streamer


def _manifest_path(streamer: str) -> Path:
    return _streamer_dir(streamer) / "manifest.json"


def _read_manifest(streamer: str) -> dict[str, Any]:
    p = _manifest_path(streamer)
    if not p.exists():
        return {"streamer": streamer, "displayName": streamer, "emotes": {}}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"streamer": streamer, "displayName": streamer, "emotes": {}}
        data.setdefault("streamer", streamer)
        data.setdefault("displayName", streamer)
        if not isinstance(data.get("emotes"), dict):
            data["emotes"] = {}
        return data
    except (OSError, json.JSONDecodeError):
        return {"streamer": streamer, "displayName": streamer, "emotes": {}}


def _write_manifest(streamer: str, manifest: dict[str, Any]) -> None:
    p = _manifest_path(streamer)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


class EmotesService:
    """CRUD + auto-descarga + asignación de sonidos para emotes/stickers."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sounds: Any = None
        # Throttle de `emotes:updated`: en burst de stickers spam (10/seg)
        # antes mandábamos un push event por cada uno, lo que disparaba
        # un loadAll() en el frontend cada vez y producía flicker /
        # "desaparición" — race entre requests concurrentes.
        # Ahora juntamos hasta 1.5s de actualizaciones en un solo push.
        self._update_pending: dict[str, dict[str, Any]] = {}
        self._update_timer: threading.Timer | None = None
        self._update_lock = threading.Lock()
        EMOTES_DIR.mkdir(parents=True, exist_ok=True)

    def attach_sounds(self, sounds: Any) -> None:
        self._sounds = sounds

    def _schedule_update_push(self, payload: dict[str, Any]) -> None:
        """Agrupa pushes `emotes:updated` con debounce 800ms para evitar
        flickering en bursts. Mantiene el último payload por streamer."""
        with self._update_lock:
            streamer = str(payload.get("streamer") or "")
            if streamer:
                self._update_pending[streamer] = payload
            if self._update_timer is not None:
                self._update_timer.cancel()
            self._update_timer = threading.Timer(0.8, self._flush_updates)
            self._update_timer.daemon = True
            self._update_timer.start()

    def _flush_updates(self) -> None:
        with self._update_lock:
            payloads = list(self._update_pending.values())
            self._update_pending.clear()
            self._update_timer = None
        for p in payloads:
            try:
                get_event_bus().publish("emotes:updated", p)
            except Exception:
                pass

    # ── RPC handlers ─────────────────────────────────────────────────────

    def list_streamers(self, _params: dict[str, Any]) -> dict[str, Any]:
        result: list[dict[str, Any]] = []
        if not EMOTES_DIR.is_dir():
            log.info("list_streamers: EMOTES_DIR no existe → []")
            return {"streamers": result}
        skipped: list[str] = []
        for sub in EMOTES_DIR.iterdir():
            if not sub.is_dir():
                continue
            try:
                streamer = _safe_streamer(sub.name)
            except (TypeError, ValueError):
                skipped.append(sub.name)
                continue
            man = _read_manifest(streamer)
            emote_count = sum(
                1 for f in sub.glob("*.png") if f.name != "avatar.png"
            )
            avatar_path = sub / "avatar.png"
            result.append({
                "username": streamer,
                "displayName": man.get("displayName") or streamer,
                "avatar": (
                    f"emotes/{streamer}/avatar.png"
                    if avatar_path.is_file() else None
                ),
                "emoteCount": emote_count,
            })
        result.sort(key=lambda r: r["username"].lower())
        if skipped:
            log.info("list_streamers: %d carpetas con nombre inválido ignoradas: %s",
                     len(skipped), skipped[:5])
        return {"streamers": result}

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        streamer = _safe_streamer(params.get("streamer"))
        sd = _streamer_dir(streamer)
        if not sd.is_dir():
            return {"streamer": streamer, "emotes": []}
        man = _read_manifest(streamer)
        emote_meta = man.get("emotes", {})
        out: list[dict[str, Any]] = []
        for f in sorted(sd.glob("*.png")):
            if f.name == "avatar.png":
                continue
            emote_id = f.stem
            meta = emote_meta.get(emote_id, {}) if isinstance(emote_meta, dict) else {}
            out.append({
                "emoteId": emote_id,
                "path": f"emotes/{streamer}/{f.name}",
                "soundPath": meta.get("soundPath") or "",
                "name": meta.get("name") or emote_id,
                "createdAt": meta.get("createdAt"),
            })
        return {"streamer": streamer, "emotes": out}

    def assign_sound(self, params: dict[str, Any]) -> dict[str, Any]:
        streamer = _safe_streamer(params.get("streamer"))
        emote_id = _safe_emote_id(params.get("emoteId"))
        sound_path = str(params.get("soundPath") or "").strip()
        # Verificar primero que el PNG existe (defensivo: si el user
        # asigna sonido a un emote_id que no se descargó, no creamos
        # entry fantasma en el manifest).
        png_path = _streamer_dir(streamer) / f"{emote_id}.png"
        if not png_path.is_file():
            return {
                "ok": False,
                "message": f"emote {emote_id} no existe en disco",
            }
        with self._lock:
            man = _read_manifest(streamer)
            emotes = man.setdefault("emotes", {})
            if not isinstance(emotes, dict):
                emotes = {}
                man["emotes"] = emotes
            entry = emotes.setdefault(emote_id, {})
            if not isinstance(entry, dict):
                entry = {}
                emotes[emote_id] = entry
            entry["soundPath"] = sound_path
            _write_manifest(streamer, man)
        return {"ok": True, "streamer": streamer, "emoteId": emote_id}

    def preview_sound(self, params: dict[str, Any]) -> dict[str, Any]:
        """Reproduce el sonido asignado a un emote (preview manual desde
        el botón "▶️ Probar" del dialog). Reutiliza el mismo `_play_file`
        que se invoca cuando el emote llega en chat — así la prueba es
        idéntica al comportamiento real."""
        streamer = _safe_streamer(params.get("streamer"))
        emote_id = _safe_emote_id(params.get("emoteId"))
        with self._lock:
            man = _read_manifest(streamer)
        entry = (man.get("emotes") or {}).get(emote_id) or {}
        sound_path = str(entry.get("soundPath") or "").strip()
        if not sound_path:
            return {"ok": False, "message": "Este emote no tiene sonido asignado"}
        if self._sounds is None:
            return {"ok": False, "message": "SoundsService no disponible"}
        played = False
        try:
            played = bool(self._sounds._play_file(sound_path, 80))
        except Exception as exc:
            log.exception("preview_sound fallo")
            return {"ok": False, "message": f"Error al reproducir: {exc}"}
        if not played:
            return {
                "ok": False,
                "message": "No se pudo reproducir (archivo no existe o formato inválido)",
            }
        return {"ok": True, "soundPath": sound_path}

    def delete(self, params: dict[str, Any]) -> dict[str, Any]:
        streamer = _safe_streamer(params.get("streamer"))
        emote_id = _safe_emote_id(params.get("emoteId"))
        sd = _streamer_dir(streamer)
        png = sd / f"{emote_id}.png"
        with self._lock:
            if png.is_file():
                try:
                    png.unlink()
                except OSError as exc:
                    log.warning("emotes.delete: %s", exc)
            man = _read_manifest(streamer)
            emotes = man.get("emotes") or {}
            if emote_id in emotes:
                emotes.pop(emote_id, None)
                _write_manifest(streamer, man)
        return {"ok": True}

    def delete_streamer(self, params: dict[str, Any]) -> dict[str, Any]:
        streamer = _safe_streamer(params.get("streamer"))
        sd = _streamer_dir(streamer)
        with self._lock:
            if sd.is_dir():
                try:
                    import shutil
                    shutil.rmtree(sd)
                except OSError as exc:
                    log.warning("emotes.delete_streamer: %s", exc)
        return {"ok": True}

    def set_streamer_avatar(self, params: dict[str, Any]) -> dict[str, Any]:
        """**Avatar es INMUTABLE**: una vez descargado, nunca más se toca
        salvo que el user pulse explícitamente "Borrar streamer" (que
        elimina toda la carpeta) y vuelva a conectar.

        Esta función ahora hace:
          - Si avatar.png NO existe Y vino `avatarUrl` válido → descargar.
          - Si avatar.png ya existe → NO TOCAR (paridad con donaciones del
            MARU original: la imagen se guarda una sola vez).
          - Update parcial del manifest (`displayName`, `avatarUrl`) sin
            tocar el dict `emotes` (defensa contra race).

        Esto elimina el bug donde "guardar" sobrescribía la imagen y
        creaba flicker visual / pérdida de datos.
        """
        streamer = _safe_streamer(params.get("username"))
        avatar_url = str(params.get("avatarUrl") or "").strip()
        display_name = str(params.get("displayName") or "").strip()
        sd = _streamer_dir(streamer)
        sd.mkdir(parents=True, exist_ok=True)

        avatar_file = sd / "avatar.png"
        downloaded = False
        # Solo descarga si NO existe ya. Inmutable post-descarga inicial.
        if avatar_url and not avatar_file.is_file():
            tmp_path = sd / ".avatar.tmp"
            ok = self._download_image(avatar_url, tmp_path)
            if ok:
                try:
                    tmp_path.replace(avatar_file)
                    downloaded = True
                except OSError:
                    log.exception("avatar replace fallo")
            else:
                try:
                    if tmp_path.exists():
                        tmp_path.unlink()
                except OSError:
                    pass

        # Update parcial del manifest — preservamos `emotes` siempre.
        with self._lock:
            man = _read_manifest(streamer)
            if display_name:
                man["displayName"] = display_name
            if avatar_url and "avatarUrl" not in man:
                man["avatarUrl"] = avatar_url  # solo primera vez
            _write_manifest(streamer, man)
        return {
            "ok": True,
            "streamer": streamer,
            "avatarDownloaded": downloaded,
            "avatarExisted": avatar_file.is_file() and not downloaded,
        }

    # ── Hook llamado por el TikTok worker (no-RPC) ───────────────────────

    def on_emote_detected(
        self,
        streamer: str,
        streamer_avatar_url: str,
        emote_id: str,
        image_url: str,
    ) -> dict[str, Any]:
        """Descarga + cachea el emote del live (paridad arquitectónica con
        las donaciones del MARU original).

        **Política idempotente por emote_id**:
          - Primera vez que llega `<emote_id>` → descarga el PNG.
          - Si el PNG ya existe Y la URL es la MISMA → no toca disco.
          - Si el PNG ya existe pero la URL CAMBIÓ (TikTok renueva CDN)
            → re-descarga (versión nueva sobreescribe la vieja, ID estable).
          - Si el user borró el PNG manualmente → vuelve a descargar la
            próxima vez que aparezca el emote.
          - El manifest guarda `{url, createdAt, soundPath}` para
            comparar URLs y preservar asignaciones de sonido al
            re-descargar.

        Layout final:
          emotes/<streamer>/avatar.png       ← actualizable con botón
          emotes/<streamer>/<emote_id>.png   ← idempotente por ID
          emotes/<streamer>/manifest.json    ← url + sound + timestamp
        """
        try:
            streamer = _safe_streamer(streamer)
            emote_id = _safe_emote_id(emote_id)
        except (TypeError, ValueError):
            return {"ok": False, "reason": "invalid params"}
        if not isinstance(image_url, str) or not image_url.strip():
            return {"ok": False, "reason": "no url"}

        sd = _streamer_dir(streamer)
        sd.mkdir(parents=True, exist_ok=True)

        # Avatar del STREAMER (no del espectador). Si llegó URL y aún no
        # lo tenemos, descargarlo. El URL viene del room_info al
        # conectarse — ver core_bridge.
        avatar_path = sd / "avatar.png"
        if (
            isinstance(streamer_avatar_url, str)
            and streamer_avatar_url.strip()
            and not avatar_path.is_file()
        ):
            try:
                self._download_image(streamer_avatar_url, avatar_path)
            except Exception:
                log.exception("avatar download fallo (%s)", streamer)

        png_path = sd / f"{emote_id}.png"

        # Decidir si descargar:
        #   1. PNG no existe (primera vez O fue borrado) → descargar.
        #   2. PNG existe pero la URL en manifest es DIFERENTE → re-descargar
        #      (TikTok renovó CDN o cambió el sticker manteniendo el ID).
        #   3. PNG existe Y URL coincide → no tocar disco.
        with self._lock:
            man = _read_manifest(streamer)
        emotes_meta = man.get("emotes") or {}
        existing = emotes_meta.get(emote_id) if isinstance(emotes_meta, dict) else None
        existing_url = (existing or {}).get("url", "") if isinstance(existing, dict) else ""

        action = "skipped"
        should_download = (not png_path.is_file()) or (
            existing_url and existing_url != image_url
        )
        if should_download:
            ok = self._download_image(image_url, png_path)
            if ok:
                action = "downloaded" if not existing else "refreshed"
                with self._lock:
                    man = _read_manifest(streamer)
                    emotes = man.setdefault("emotes", {})
                    if not isinstance(emotes, dict):
                        emotes = {}
                        man["emotes"] = emotes
                    prev = emotes.get(emote_id, {}) if isinstance(emotes.get(emote_id), dict) else {}
                    # Preservar soundPath previo al refresh — la asignación
                    # de sonido sobrevive al cambio de imagen.
                    emotes[emote_id] = {
                        "url": image_url,
                        "createdAt": prev.get("createdAt") or int(__import__('time').time() * 1000),
                        "updatedAt": int(__import__('time').time() * 1000),
                        "soundPath": prev.get("soundPath", ""),
                    }
                    _write_manifest(streamer, man)

        # Reproducir sonido asignado si existe.
        try:
            with self._lock:
                man = _read_manifest(streamer)
            entry = (man.get("emotes") or {}).get(emote_id) or {}
            sound_path = entry.get("soundPath") or ""
            if sound_path and self._sounds is not None:
                if hasattr(self._sounds, "_play_file"):
                    self._sounds._play_file(sound_path, 80)
        except Exception:
            log.exception("emote sound play fallo")

        # Notificar UI solo cuando hubo cambio en disco.
        if action != "skipped":
            try:
                self._schedule_update_push(
                    {
                        "streamer": streamer,
                        "emoteId": emote_id,
                        "path": f"emotes/{streamer}/{png_path.name}",
                        "action": action,
                    },
                )
            except Exception:
                pass

        return {"ok": True, "action": action, "path": str(png_path)}

    def refresh_avatar(self, params: dict[str, Any]) -> dict[str, Any]:
        """Re-descarga el avatar del streamer desde la URL guardada (o la
        que llegue como param). Borra el archivo viejo y baja uno nuevo.

        Llamado por el botón "🔄 Actualizar foto" del frontend cuando el
        streamer cambió su foto de perfil de TikTok y querés sincronizar."""
        streamer = _safe_streamer(params.get("streamer") or params.get("username"))
        sd = _streamer_dir(streamer)
        sd.mkdir(parents=True, exist_ok=True)
        avatar_file = sd / "avatar.png"

        # 1) Determinar la URL — primero la del param, después la del manifest.
        url = str(params.get("avatarUrl") or "").strip()
        if not url:
            with self._lock:
                man = _read_manifest(streamer)
            url = str(man.get("avatarUrl") or "").strip()
        if not url:
            return {
                "ok": False,
                "message": "No hay URL de avatar guardada. Reconectá al live primero.",
            }

        # 2) Descargar a tmp y reemplazar atómicamente.
        tmp = sd / ".avatar.tmp"
        ok = self._download_image(url, tmp)
        if not ok:
            try:
                if tmp.exists():
                    tmp.unlink()
            except OSError:
                pass
            return {"ok": False, "message": "fallo descargando avatar (URL inválida o CDN bloqueado)"}
        try:
            if avatar_file.exists():
                avatar_file.unlink()
            tmp.replace(avatar_file)
        except OSError as exc:
            return {"ok": False, "message": str(exc)}

        # 3) Notificar UI.
        try:
            self._schedule_update_push(
                {
                    "streamer": streamer,
                    "action": "avatar-refreshed",
                    "avatarPath": f"emotes/{streamer}/avatar.png",
                },
            )
        except Exception:
            pass
        return {"ok": True, "streamer": streamer}

    def set_streamer(self, streamer: str, avatar_url: str = "") -> None:
        """Asegura la carpeta del streamer y descarga su avatar al
        conectarse al live. Llamado desde TikTokService cuando recibimos
        room_info con la foto del host."""
        try:
            streamer = _safe_streamer(streamer)
        except (TypeError, ValueError):
            return
        sd = _streamer_dir(streamer)
        sd.mkdir(parents=True, exist_ok=True)
        avatar_path = sd / "avatar.png"
        if (
            isinstance(avatar_url, str)
            and avatar_url.strip()
            and not avatar_path.is_file()
        ):
            try:
                ok = self._download_image(avatar_url, avatar_path)
                if ok:
                    try:
                        self._schedule_update_push(
                            {
                                "streamer": streamer,
                                "action": "avatar",
                                "avatarPath": f"emotes/{streamer}/avatar.png",
                            },
                        )
                    except Exception:
                        pass
            except Exception:
                log.exception("set_streamer avatar fallo (%s)", streamer)
        # Inicializar manifest si no existe.
        with self._lock:
            man = _read_manifest(streamer)
            _write_manifest(streamer, man)

    # ── Helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _download_image(url: str, dst: Path) -> bool:
        try:
            import requests  # noqa: PLC0415
        except ImportError:
            return False
        try:
            r = requests.get(url, timeout=10)
            if r.status_code != 200 or not r.content:
                return False
            try:
                from PIL import Image  # type: ignore[import-not-found]
                img = Image.open(io.BytesIO(r.content)).convert("RGBA")
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                data = buf.getvalue()
            except Exception:
                # Si PIL falla, guardar raw — la mayoría de los assets
                # ya son PNG/WebP utilizables tal cual.
                data = r.content
            dst.parent.mkdir(parents=True, exist_ok=True)
            with open(dst, "wb") as f:
                f.write(data)
            return True
        except Exception as ex:
            log.warning("emote download fallo (%s): %s", url, ex)
            return False
