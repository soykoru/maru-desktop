"""Generador de letter PNG fallback (G2.6).

Réplica de:
  - `gui/widgets/default_images.py:_draw_letter_icon`
  - `gui/widgets/default_images.py:_LETTER_FALLBACK`
  - `gui/widgets/image_cache.py:tint_icon_file`

Cuándo se usa:
  Cuando el bundle no tiene un PNG y tampoco hay default categoría —
  generamos un PNG 128x128 con un círculo de color + letra centrada
  (idéntico al fallback del MARU original).

NO depende de Qt (el original usaba `QPainter`). Acá usamos PIL puro,
que ya está en deps del sidecar.

Mejoras vs original:
  - Cache de los letter PNGs ya generados (mismo letter+color → ya tenemos
    el archivo).
  - Genera bajo demanda en `CACHE_DIR/letters/<key>.png` (NO en el bundle
    read-only) para que se puedan invalidar sin afectar el bundle.
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path
from typing import Final

from maru_sidecar.logger import get_logger
from maru_sidecar.runtime import CACHE_DIR

log = get_logger(__name__)

LETTER_CACHE_DIR: Final[Path] = CACHE_DIR / "letters"
SIZE: Final[int] = 128

# Espejo de `gui/widgets/default_images.py:_LETTER_FALLBACK`.
LETTER_FALLBACK: Final[dict[str, tuple[str, str, str, str]]] = {
    # (letter, bg, fg, border)
    "like": ("♥", "#4a1028", "#ff6b6b", "#e74c3c"),
    "gift": ("G", "#3d1f5c", "#d4a0ff", "#9b59b6"),
    "follow": ("+", "#1a3a5c", "#7ec8f8", "#3498db"),
    "share": ("S", "#1a4a2e", "#7aeba4", "#2ecc71"),
    "subscribe": ("★", "#4a3a10", "#f9ca24", "#f39c12"),
    "command": (">", "#2d3436", "#dfe6e9", "#636e72"),
    "like_milestone": ("◎", "#4a1a3a", "#fd79a8", "#e84393"),
    "entities": ("D", "#2d1b69", "#a29bfe", "#8e44ad"),
    "items": ("S", "#1b3a4b", "#74b9ff", "#2980b9"),
    "events": ("E", "#4a1a1a", "#ffeaa7", "#e74c3c"),
    "commands": ("C", "#4a1a1a", "#ffeaa7", "#e74c3c"),
    "valuables": ("V", "#1a3a1a", "#81ecec", "#27ae60"),
    "equipment": ("T", "#2d2d1a", "#feca57", "#d4a017"),
}


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return (50, 50, 70)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _cache_key(letter: str, bg: str, fg: str, border: str, size: int) -> str:
    raw = f"{letter}|{bg}|{fg}|{border}|{size}"
    return hashlib.sha1(raw.encode("utf-8"), usedforsecurity=False).hexdigest()[:16]


def draw_letter_png(
    letter: str,
    bg: str = "#2d3436",
    fg: str = "#dfe6e9",
    border: str = "#636e72",
    size: int = SIZE,
) -> bytes:
    """Generar el PNG en memoria (bytes).

    Espejo simplificado de `_draw_letter_icon` del MARU original:
      - 128x128 transparent.
      - Rounded square 16% radius con gradient radial bg→bg.lighter.
      - Border 2.5px del color border.
      - Letra 45% del tamaño, centrada, bold, color fg.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont  # type: ignore[import-not-found]
    except ImportError:
        log.warning("Pillow not installed — letter PNG fallback degraded")
        # Devolver un PNG mínimo 1x1 transparente.
        return (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
            b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
            b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfc"
            b"\xff\xff?\x03\x00\x05\xfe\x02\xfe\xa3\\\xc8\xb8\x00\x00"
            b"\x00\x00IEND\xaeB`\x82"
        )

    bg_rgb = _hex_to_rgb(bg)
    fg_rgb = _hex_to_rgb(fg)
    border_rgb = _hex_to_rgb(border)

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded rect bg con margin 2px.
    radius = int(size * 0.16)
    draw.rounded_rectangle(
        [(2, 2), (size - 2, size - 2)],
        radius=radius,
        fill=bg_rgb + (255,),
        outline=border_rgb + (255,),
        width=3,
    )

    # Aproximación del gradient radial: lighter en el centro-arriba.
    # PIL no tiene gradient directo; simulamos con un overlay translúcido.
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    lighter = tuple(min(255, int(c * 1.3)) for c in bg_rgb) + (90,)
    overlay_draw.ellipse(
        [
            (size * 0.1, size * 0.05),
            (size * 0.9, size * 0.5),
        ],
        fill=lighter,
    )
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    # Letra centrada.
    target_font_size = int(size * 0.45)
    font: ImageFont.ImageFont | ImageFont.FreeTypeFont
    try:
        # Intentar bold del sistema; si falla, default.
        for candidate in (
            "arialbd.ttf",
            "Arial Bold.ttf",
            "DejaVuSans-Bold.ttf",
            "Helvetica-Bold.ttf",
        ):
            try:
                font = ImageFont.truetype(candidate, target_font_size)
                break
            except (OSError, IOError):
                continue
        else:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    # Calcular bbox para centrar.
    try:
        bbox = draw.textbbox((0, 0), letter, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        text_x = (size - text_w) // 2 - bbox[0]
        text_y = (size - text_h) // 2 - bbox[1]
    except AttributeError:
        # Fallback si textbbox no está disponible.
        text_x = size // 4
        text_y = size // 4

    draw.text((text_x, text_y), letter, fill=fg_rgb + (255,), font=font)

    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def get_or_create_letter_png(
    key: str = "gift",
    *,
    letter: str | None = None,
    bg: str | None = None,
    fg: str | None = None,
    border: str | None = None,
    size: int = SIZE,
) -> Path:
    """Lookup en preset por `key` o usar overrides; devolver path cacheado.

    Ejemplos:
        get_or_create_letter_png("gift")           # usa preset gift
        get_or_create_letter_png("custom", letter="X", bg="#000", fg="#fff", border="#888")
    """
    preset = LETTER_FALLBACK.get(
        key, ("?", "#333333", "#ffffff", "#666666")
    )
    final_letter = letter if letter is not None else preset[0]
    final_bg = bg or preset[1]
    final_fg = fg or preset[2]
    final_border = border or preset[3]

    LETTER_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = _cache_key(
        final_letter, final_bg, final_fg, final_border, size
    )
    out_path = LETTER_CACHE_DIR / f"{cache_key}.png"
    if out_path.exists():
        return out_path

    data = draw_letter_png(
        final_letter, final_bg, final_fg, final_border, size
    )
    try:
        out_path.write_bytes(data)
    except OSError as ex:
        log.warning("could not write letter PNG cache: %s", ex)
    return out_path


def tint_png_destructive(
    src_path: Path | str, color: str
) -> bool:
    """Tintar un PNG monocromático con un color, sobreescribiendo el archivo.

    Espejo de `gui/widgets/image_cache.py:tint_icon_file`. Toma la silueta
    (alpha) del original y la rellena con el color target.

    Premium polish vs original: usa `Image.alpha_composite` en vez de
    `compositionMode_DestinationIn` de Qt — resultado equivalente.

    Returns True si tintó OK, False si falló.
    """
    src = Path(src_path)
    if not src.exists():
        return False
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError:
        log.warning("Pillow not installed — cannot tint PNG")
        return False
    try:
        original = Image.open(src).convert("RGBA")
        rgb = _hex_to_rgb(color)
        # Tomar el alpha del original y rellenar con el color target.
        alpha = original.split()[-1]
        tinted = Image.new("RGBA", original.size, rgb + (0,))
        # Usar el alpha como mask para "pintar" el color.
        result = Image.composite(
            Image.new("RGBA", original.size, rgb + (255,)),
            Image.new("RGBA", original.size, (0, 0, 0, 0)),
            alpha,
        )
        del tinted  # tinted unused in this approach
        result.save(src, format="PNG")
        return True
    except Exception as ex:
        log.warning("Tint failed for %s: %s", src, ex)
        return False


__all__ = [
    "LETTER_FALLBACK",
    "LETTER_CACHE_DIR",
    "SIZE",
    "draw_letter_png",
    "get_or_create_letter_png",
    "tint_png_destructive",
]
