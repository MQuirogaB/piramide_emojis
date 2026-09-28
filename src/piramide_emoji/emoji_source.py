"""Obtención y rasterizado de emojis a partir de los SVG de Twemoji
(https://github.com/twitter/twemoji, licencia CC-BY 4.0).

También admite pasar directamente una ruta a un SVG o PNG propio en vez de
un emoji Unicode, para poder usar artwork personalizado.
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image

TWEMOJI_BASE_URL = (
    "https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/{code}.svg"
)

DEFAULT_CACHE_DIR = Path(
    os.environ.get("PIRAMIDE_EMOJI_CACHE", str(Path.home() / ".cache" / "piramide_emoji"))
)


class EmojiFetchError(RuntimeError):
    pass


def _codepoints(char: str) -> str:
    """Devuelve los codepoints Unicode del emoji en el formato de nombre de
    fichero que usa Twemoji: hex en minúsculas separados por '-'."""
    return "-".join(f"{ord(c):x}" for c in char)


def _codepoints_without_variation_selector(char: str) -> Optional[str]:
    stripped = char.replace("️", "")
    if stripped == char or not stripped:
        return None
    return "-".join(f"{ord(c):x}" for c in stripped)


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "piramide-emoji-generator"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def fetch_twemoji_svg(emoji_char: str, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path:
    """Descarga (o recupera de caché) el SVG de Twemoji para un emoji dado.

    Devuelve la ruta local al fichero .svg.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", emoji_char)
    digest = hashlib.sha1(emoji_char.encode("utf-8")).hexdigest()[:8]
    cached_path = cache_dir / f"{safe_name}_{digest}.svg"
    if cached_path.exists() and cached_path.stat().st_size > 0:
        return cached_path

    candidates = [_codepoints(emoji_char)]
    alt = _codepoints_without_variation_selector(emoji_char)
    if alt:
        candidates.append(alt)

    last_error: Optional[Exception] = None
    for code in candidates:
        url = TWEMOJI_BASE_URL.format(code=code)
        try:
            data = _download(url)
            cached_path.write_bytes(data)
            return cached_path
        except urllib.error.HTTPError as e:
            last_error = e
            continue
        except Exception as e:  # noqa: BLE001
            last_error = e
            continue

    raise EmojiFetchError(
        f"No se pudo descargar el emoji {emoji_char!r} de Twemoji "
        f"(probado: {candidates}). Último error: {last_error}"
    )


def rasterize_svg(svg_path: Path, resolution: int) -> np.ndarray:
    """Convierte un SVG en un array RGBA (resolution x resolution x 4,
    valores 0..255) usando cairosvg."""
    import cairosvg  # importación diferida: dependencia opcional pesada

    png_bytes = cairosvg.svg2png(
        url=str(svg_path), output_width=resolution, output_height=resolution
    )
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    return np.array(img)


def load_raster(image_path: Path, resolution: int) -> np.ndarray:
    """Carga un PNG/JPG propio y lo reescala a resolution x resolution RGBA."""
    img = Image.open(image_path).convert("RGBA")
    img = img.resize((resolution, resolution), Image.LANCZOS)
    return np.array(img)


def get_emoji_array(
    emoji: str,
    resolution: int = 128,
    cache_dir: Path = DEFAULT_CACHE_DIR,
) -> np.ndarray:
    """Obtiene un array RGBA para el "emoji" solicitado.

    `emoji` puede ser:
      - un único carácter/emoji Unicode (se descarga de Twemoji), o
      - una ruta a un fichero .svg, .png o .jpg propio.
    """
    path = Path(emoji)
    if path.suffix.lower() in (".svg",) and path.exists():
        return rasterize_svg(path, resolution)
    if path.suffix.lower() in (".png", ".jpg", ".jpeg") and path.exists():
        return load_raster(path, resolution)

    svg_path = fetch_twemoji_svg(emoji, cache_dir=cache_dir)
    return rasterize_svg(svg_path, resolution)


def to_heightmap(rgba: np.ndarray, invert: bool = False) -> np.ndarray:
    """Convierte un array RGBA (0..255) en un mapa de alturas normalizado
    0..1, donde 1 = grabado más profundo (o relieve más alto en modo
    emboss). Las zonas transparentes (fuera del dibujo del emoji) valen 0.

    Se pondera por luminancia y por el canal alfa, así que los trazos
    oscuros sobre fondo transparente quedan como el área "activa" del
    grabado.
    """
    rgb = rgba[..., :3].astype(np.float64) / 255.0
    alpha = rgba[..., 3].astype(np.float64) / 255.0

    luminance = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    darkness = 1.0 - luminance  # oscuro -> 1, claro -> 0

    value = darkness * alpha
    if invert:
        value = alpha - value  # zonas claras del dibujo pasan a ser las "activas"
        value = np.clip(value, 0.0, 1.0)

    vmax = value.max()
    if vmax > 1e-6:
        value = value / vmax
    return value
