"""Orquesta la construcción completa: pirámide truncada + agujero de
tornillo + emojis grabados en las caras indicadas."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

import trimesh

from .geometry import PyramidSpec, build_frustum_mesh, apply_screw_hole, face_frame, SIDE_FACE_NAMES
from .engrave import EngraveSpec, engrave_emoji_on_face


@dataclass
class PyramidBuild:
    pyramid: PyramidSpec = field(default_factory=PyramidSpec)
    # clave: nombre de cara ("front", "right", "back", "left"); valor: EngraveSpec
    faces: Dict[str, EngraveSpec] = field(default_factory=dict)
    cache_dir: Optional[Path] = None

    def build(self, verbose: bool = True) -> trimesh.Trimesh:
        if verbose:
            print("Generando el sólido de la pirámide truncada...")
        mesh = build_frustum_mesh(self.pyramid)

        if self.pyramid.screw_hole_diameter > 0:
            if verbose:
                print("Taladrando el agujero pasante para el tornillo...")
            mesh = apply_screw_hole(mesh, self.pyramid)

        for index, name in enumerate(SIDE_FACE_NAMES):
            spec = self.faces.get(name)
            if spec is None:
                continue
            if verbose:
                print(f"Grabando emoji {spec.emoji!r} en la cara '{name}'...")
            frame = face_frame(self.pyramid, index)
            mesh = engrave_emoji_on_face(mesh, frame, spec, cache_dir=self.cache_dir)

        if verbose:
            print(f"Listo. Watertight: {mesh.is_watertight}  Volumen: {mesh.volume:.1f} mm3")
        return mesh

    def export(self, path: str, verbose: bool = True) -> trimesh.Trimesh:
        mesh = self.build(verbose=verbose)
        mesh.export(path)
        if verbose:
            print(f"STL exportado en: {path}")
        return mesh
