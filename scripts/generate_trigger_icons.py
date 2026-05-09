"""Generador one-shot de iconos default para triggers que aún no tienen
PNG en `resources/data/icons_triggers/`. Estilo: flat-design 512x512 con
fondo transparente y paleta plana, idéntico al de los triggers existentes
(gift/follow/share/like/like_milestone/subscribe/command).

Triggers cubiertos por esta corrida:
  - emote   → sticker carita feliz (purple/magenta) — paridad con
              `trigger-meta.ts:emote` (color purple).
  - join    → silueta entrando con flecha (cyan/teal) — paridad con
              `trigger-meta.ts:join` (color cyan).

Idempotente: si un PNG destino ya existe, lo sobrescribe (queremos
poder iterar el diseño sin tocar git a mano).

Uso (una sola vez al sumar nuevos triggers):
    python scripts/generate_trigger_icons.py
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw

OUT_DIR = (
    Path(__file__).resolve().parent.parent
    / "apps"
    / "desktop"
    / "resources"
    / "data"
    / "icons_triggers"
)


SIZE = 512


def _new_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img, "RGBA")


def render_emote() -> Image.Image:
    """Sticker carita feliz: círculo magenta/purple con ojos + boca + estrellitas."""
    img, d = _new_canvas()
    # Cuerpo principal — círculo grande purple (similar a un sticker pegado).
    body = (50, 50, 462, 462)
    d.ellipse(body, fill=(168, 85, 247, 255))  # purple-500
    # Highlight superior izquierdo (sticker shine). Forma elíptica más clara.
    d.ellipse((110, 100, 250, 200), fill=(216, 180, 254, 230))  # purple-300
    # Ojos — dos óvalos blancos con pupila negra.
    eye_l = (165, 195, 230, 280)
    eye_r = (282, 195, 347, 280)
    d.ellipse(eye_l, fill=(255, 255, 255, 255))
    d.ellipse(eye_r, fill=(255, 255, 255, 255))
    d.ellipse((184, 220, 215, 260), fill=(40, 20, 60, 255))  # pupila L
    d.ellipse((301, 220, 332, 260), fill=(40, 20, 60, 255))  # pupila R
    # Brillito en cada pupila para look "kawaii".
    d.ellipse((192, 226, 204, 240), fill=(255, 255, 255, 255))
    d.ellipse((309, 226, 321, 240), fill=(255, 255, 255, 255))
    # Boca grande sonriente — semicircunferencia rellena.
    d.pieslice((170, 270, 342, 410), start=10, end=170, fill=(255, 255, 255, 255))
    # Lengüita rosa.
    d.ellipse((226, 360, 286, 410), fill=(244, 114, 182, 255))  # pink-400
    # Estrellitas decorativas alrededor (efecto "sticker brillante").
    for cx, cy, r in [(85, 360, 18), (430, 130, 14), (420, 380, 10)]:
        # Estrella simple = polígono de 5 puntas.
        import math
        pts: list[tuple[float, float]] = []
        for i in range(10):
            ang = math.radians(-90 + i * 36)
            rr = r if i % 2 == 0 else r * 0.45
            pts.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr))
        d.polygon(pts, fill=(253, 224, 71, 255))  # yellow-300
    return img


def render_join() -> Image.Image:
    """Entrada al live: silueta con flecha cyan apuntando hacia adentro."""
    img, d = _new_canvas()
    # Marco de "puerta/portal" — rectángulo redondeado cyan oscuro.
    # Lo hacemos dibujando un rect grande y luego "vaciando" con corner radius
    # via 4 elipses + 1 rect interior.
    def rounded_rect(box, radius, fill):
        x0, y0, x1, y1 = box
        d.rectangle((x0 + radius, y0, x1 - radius, y1), fill=fill)
        d.rectangle((x0, y0 + radius, x1, y1 - radius), fill=fill)
        d.pieslice((x0, y0, x0 + 2 * radius, y0 + 2 * radius), 180, 270, fill=fill)
        d.pieslice((x1 - 2 * radius, y0, x1, y0 + 2 * radius), 270, 360, fill=fill)
        d.pieslice((x0, y1 - 2 * radius, x0 + 2 * radius, y1), 90, 180, fill=fill)
        d.pieslice((x1 - 2 * radius, y1 - 2 * radius, x1, y1), 0, 90, fill=fill)

    # Marco del live — rectángulo redondeado cyan-700 (oscuro).
    rounded_rect((250, 80, 470, 432), 28, (15, 118, 110, 255))  # teal-700
    # Interior cyan claro (escena del live).
    rounded_rect((280, 110, 440, 402), 16, (94, 234, 212, 255))  # teal-300
    # Onda arriba (encabezado/banner del live).
    rounded_rect((280, 110, 440, 170), 16, (45, 212, 191, 255))  # teal-400
    # "Punto rojo en vivo" arriba-izquierda del live.
    d.ellipse((300, 130, 326, 156), fill=(239, 68, 68, 255))  # red-500
    # Flecha grande cyan apuntando hacia adentro (de izquierda al portal).
    # Cuerpo de la flecha = rectángulo + cabeza triangular.
    arrow_y_top = 226
    arrow_y_bot = 286
    d.rectangle((60, arrow_y_top, 230, arrow_y_bot), fill=(8, 145, 178, 255))  # cyan-600
    # Cabeza triangular más alta + más ancha.
    d.polygon(
        [
            (230, arrow_y_top - 50),
            (230, arrow_y_bot + 50),
            (320, (arrow_y_top + arrow_y_bot) / 2),
        ],
        fill=(8, 145, 178, 255),
    )
    # Silueta humana mini dentro del marco (la viewer entrando).
    # Cabeza
    d.ellipse((338, 200, 388, 250), fill=(255, 255, 255, 255))
    # Torso (rectángulo redondeado).
    rounded_rect((328, 256, 398, 360), 20, (255, 255, 255, 255))
    return img


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    saved = 0
    for name, render in [
        ("trigger_emote.png", render_emote),
        ("trigger_join.png", render_join),
    ]:
        target = OUT_DIR / name
        img = render()
        img.save(target, format="PNG", optimize=True)
        print(f"[OK] {target}  ({target.stat().st_size:,} bytes)")
        saved += 1
    print(f"Generados {saved} archivos en {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
