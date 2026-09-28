"""Interfaz de línea de comandos.

Ejemplos:

  # Pirámide con el mismo emoji en las 4 caras
  piramide-emoji --emoji-front "😀" --emoji-right "😀" \\
                  --emoji-back "😀" --emoji-left "😀" -o piramide.stl

  # Usando un fichero de configuración YAML/JSON
  piramide-emoji --config examples/carita.yaml -o piramide.stl
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

from .geometry import PyramidSpec, SIDE_FACE_NAMES
from .engrave import EngraveSpec
from .builder import PyramidBuild


def _load_config(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in (".yaml", ".yml"):
        import yaml  # dependencia opcional

        return yaml.safe_load(text)
    return json.loads(text)


def _build_from_config(cfg: dict) -> PyramidBuild:
    pyramid_cfg = cfg.get("pyramid", {})
    pyramid = PyramidSpec(**pyramid_cfg)

    faces_cfg = cfg.get("faces", {})
    faces = {}
    for name, face_cfg in faces_cfg.items():
        if name not in SIDE_FACE_NAMES:
            raise ValueError(
                f"Cara desconocida '{name}'. Válidas: {SIDE_FACE_NAMES}"
            )
        if isinstance(face_cfg, str):
            face_cfg = {"emoji": face_cfg}
        faces[name] = EngraveSpec(**face_cfg)

    return PyramidBuild(pyramid=pyramid, faces=faces)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="piramide-emoji",
        description="Genera una pirámide truncada en 3D con agujero para tornillo M3 y emojis grabados en las caras.",
    )
    p.add_argument("-o", "--output", default="piramide.stl", help="Ruta del STL de salida")
    p.add_argument("--config", type=Path, help="Fichero YAML/JSON con la configuración completa")

    geo = p.add_argument_group("Geometría de la pirámide")
    geo.add_argument("--base-size", type=float, default=40.0, help="Lado de la base cuadrada (mm)")
    geo.add_argument("--top-size", type=float, default=14.0, help="Lado de la cara superior truncada (mm)")
    geo.add_argument("--height", type=float, default=32.0, help="Altura total (mm)")

    hole = p.add_argument_group("Agujero para el tornillo")
    hole.add_argument("--screw-hole-diameter", type=float, default=3.4, help="Diámetro de paso (mm), 3.4 = M3 con holgura")
    hole.add_argument("--screw-head-diameter", type=float, default=6.2, help="Diámetro del alojamiento de la cabeza (mm)")
    hole.add_argument("--screw-head-depth", type=float, default=3.2, help="Profundidad del alojamiento de la cabeza (mm)")
    hole.add_argument("--no-hole", action="store_true", help="No generar el agujero del tornillo")

    for name in SIDE_FACE_NAMES:
        p.add_argument(f"--emoji-{name}", type=str, default=None, help=f"Emoji (o ruta a SVG/PNG) para la cara '{name}'")

    emoji_opts = p.add_argument_group("Ajustes del grabado de emojis (aplican a todas las caras indicadas por CLI)")
    emoji_opts.add_argument("--emboss", action="store_true", help="Repuja el emoji en vez de grabarlo")
    emoji_opts.add_argument("--depth", type=float, default=1.0, help="Profundidad/altura máxima del grabado (mm)")
    emoji_opts.add_argument("--emoji-scale", type=float, default=1.0, help="Escala del emoji respecto al área utilizable de la cara (0-1]")
    emoji_opts.add_argument("--resolution", type=int, default=96, help="Resolución de la rejilla del heightmap (N x N)")
    emoji_opts.add_argument("--invert", action="store_true", help="Invierte qué zonas del emoji quedan grabadas")

    p.add_argument("--cache-dir", type=Path, default=None, help="Directorio de caché para los SVG de emoji descargados")
    p.add_argument("--quiet", action="store_true", help="No mostrar mensajes de progreso")
    return p


def main(argv: Optional[list] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.config:
        cfg = _load_config(args.config)
        build = _build_from_config(cfg)
    else:
        pyramid = PyramidSpec(
            base_size=args.base_size,
            top_size=args.top_size,
            height=args.height,
            screw_hole_diameter=0.0 if args.no_hole else args.screw_hole_diameter,
            screw_head_diameter=args.screw_head_diameter,
            screw_head_depth=args.screw_head_depth,
        )
        faces = {}
        for name in SIDE_FACE_NAMES:
            emoji = getattr(args, f"emoji_{name}")
            if emoji:
                faces[name] = EngraveSpec(
                    emoji=emoji,
                    mode="emboss" if args.emboss else "engrave",
                    depth=args.depth,
                    scale=args.emoji_scale,
                    resolution=args.resolution,
                    invert=args.invert,
                )
        build = PyramidBuild(pyramid=pyramid, faces=faces, cache_dir=args.cache_dir)

    build.export(args.output, verbose=not args.quiet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
