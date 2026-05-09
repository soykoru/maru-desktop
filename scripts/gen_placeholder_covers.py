"""Genera portadas placeholder premium para juegos sin Steam (Minecraft, Hytale).

Resolución: 600x900 (mismo formato que las portadas de Steam library
que descargamos para los otros juegos). Gradient diagonal único por juego
+ textura sutil + texto grande del nombre.

Uso: python scripts/gen_placeholder_covers.py
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "apps" / "desktop" / "resources" / "data" / "game_covers"

# Dimensiones estilo Steam library cover
W, H = 600, 900


def find_font(size: int) -> ImageFont.FreeTypeFont:
    """Busca una fuente bold del sistema. En Windows usa Arial Black o
    Impact. Si no, fallback a default PIL."""
    candidates = [
        # Windows
        "C:\\Windows\\Fonts\\impact.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
        "C:\\Windows\\Fonts\\segoeuib.ttf",
        # macOS
        "/System/Library/Fonts/Helvetica.ttc",
        # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVu-Sans-Bold.ttf",
    ]
    for fp in candidates:
        try:
            return ImageFont.truetype(fp, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


def linear_gradient(
    size: tuple[int, int],
    color_top_left: tuple[int, int, int],
    color_bottom_right: tuple[int, int, int],
) -> Image.Image:
    """Crea un gradient diagonal del color top-left al bottom-right."""
    w, h = size
    base = Image.new("RGB", (w, h))
    pixels = base.load()
    # Diagonal: t=0 en (0,0), t=1 en (w-1, h-1)
    max_d = w + h - 2
    for y in range(h):
        for x in range(w):
            t = (x + y) / max_d
            r = int(color_top_left[0] * (1 - t) + color_bottom_right[0] * t)
            g = int(color_top_left[1] * (1 - t) + color_bottom_right[1] * t)
            b = int(color_top_left[2] * (1 - t) + color_bottom_right[2] * t)
            pixels[x, y] = (r, g, b)
    return base


def add_noise_overlay(img: Image.Image, alpha: int = 12) -> Image.Image:
    """Agrega ruido sutil para textura no-flat. alpha 0-255."""
    import random
    noise = Image.new("L", img.size)
    npx = noise.load()
    for y in range(img.height):
        for x in range(img.width):
            npx[x, y] = random.randint(120, 140)
    noise = noise.filter(ImageFilter.GaussianBlur(radius=0.5))
    out = img.copy()
    overlay = Image.new("RGB", img.size, (255, 255, 255))
    out.paste(overlay, (0, 0), Image.eval(noise, lambda v: int(alpha * (v - 128) / 128)))
    return out


def draw_diagonal_stripes(img: Image.Image, color: tuple[int, int, int, int]) -> None:
    """Dibuja líneas diagonales sutiles para textura visual."""
    draw = ImageDraw.Draw(img, mode="RGBA")
    spacing = 24
    for offset in range(-img.height, img.width + img.height, spacing):
        draw.line(
            [(offset, 0), (offset + img.height, img.height)],
            fill=color,
            width=1,
        )


def make_cover(
    name: str,
    subtitle: str,
    color_a: tuple[int, int, int],
    color_b: tuple[int, int, int],
    big_emoji: str,
    out_path: Path,
) -> None:
    """Compone una portada premium para un juego."""
    img = linear_gradient((W, H), color_a, color_b)

    # Textura: stripes diagonales sutiles
    draw_diagonal_stripes(img, (255, 255, 255, 12))

    # Vignette suave en bordes (oscurece hacia las esquinas)
    vignette = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vignette)
    vd.rectangle((30, 30, W - 30, H - 30), fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(radius=80))
    img = Image.composite(img, Image.new("RGB", (W, H), (0, 0, 0)), vignette)

    draw = ImageDraw.Draw(img, mode="RGBA")

    # Emoji grande en el centro vertical (el font del sistema lo renderiza
    # como glyph básico — vale como marca visual; los users con sistema
    # con emoji color lo van a ver perfecto).
    emoji_font = find_font(280)
    bbox = draw.textbbox((0, 0), big_emoji, font=emoji_font)
    emoji_w = bbox[2] - bbox[0]
    emoji_h = bbox[3] - bbox[1]
    draw.text(
        ((W - emoji_w) // 2 - bbox[0], H // 3 - emoji_h // 2 - bbox[1]),
        big_emoji,
        font=emoji_font,
        fill=(255, 255, 255, 220),
    )

    # Nombre del juego — bottom centered, gigante
    name_font = find_font(70)
    bbox = draw.textbbox((0, 0), name, font=name_font)
    name_w = bbox[2] - bbox[0]
    name_y = int(H * 0.66)
    # Sombra
    draw.text(
        ((W - name_w) // 2 + 3 - bbox[0], name_y + 3 - bbox[1]),
        name,
        font=name_font,
        fill=(0, 0, 0, 180),
    )
    draw.text(
        ((W - name_w) // 2 - bbox[0], name_y - bbox[1]),
        name,
        font=name_font,
        fill=(255, 255, 255, 255),
    )

    # Subtitle
    sub_font = find_font(28)
    bbox = draw.textbbox((0, 0), subtitle, font=sub_font)
    sub_w = bbox[2] - bbox[0]
    sub_y = int(H * 0.78)
    draw.text(
        ((W - sub_w) // 2 - bbox[0], sub_y - bbox[1]),
        subtitle,
        font=sub_font,
        fill=(255, 255, 255, 180),
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="JPEG", quality=88, optimize=True)
    print(f"  ✓ {out_path.name}  ({out_path.stat().st_size // 1024} KB)")


def main() -> None:
    print(f"Generando placeholders en: {OUT_DIR}")

    # Minecraft: paleta verde-marrón (terreno + earth)
    make_cover(
        name="MINECRAFT",
        subtitle="Java Edition · RCON",
        color_a=(58, 132, 64),     # verde Grass top
        color_b=(91, 60, 32),       # marrón Dirt
        big_emoji="⛏",
        out_path=OUT_DIR / "minecraft.jpg",
    )

    # Hytale: paleta azul-púrpura (fantasy/magic)
    make_cover(
        name="HYTALE",
        subtitle="Sandbox RPG · HTTP",
        color_a=(74, 49, 156),      # púrpura medio
        color_b=(28, 56, 138),      # azul profundo
        big_emoji="🧌",
        out_path=OUT_DIR / "hytale.jpg",
    )

    print("\n✅ Placeholders generados")


if __name__ == "__main__":
    main()
