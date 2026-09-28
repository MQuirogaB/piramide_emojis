"""Geometría base: pirámide truncada (frustum) de base cuadrada y agujero
pasante para tornillo, con utilidades para localizar el plano de cada cara
lateral (necesarias para grabar los emojis)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
import trimesh

# Nombres de las 4 caras laterales, en el orden en que se generan
# (empezando por la cara "sur" = -Y, y girando 90 grados en sentido
# antihorario alrededor de Z).
SIDE_FACE_NAMES = ["front", "right", "back", "left"]


@dataclass
class FaceFrame:
    """Marco de referencia de una cara plana: origen + ejes locales.

    - origin: punto de la cara desde el que se miden (u, v)
    - u_hat, v_hat: ejes en el plano de la cara (unitarios)
    - normal: normal saliente de la cara (unitaria)
    - u_extent: anchura utilizable a lo largo de u_hat (mm), centrada en origin
    - v_extent: altura utilizable a lo largo de v_hat (mm), desde origin
    """

    name: str
    origin: np.ndarray
    u_hat: np.ndarray
    v_hat: np.ndarray
    normal: np.ndarray
    u_extent: float
    v_extent: float


@dataclass
class PyramidSpec:
    base_size: float = 40.0          # lado de la base cuadrada (mm)
    top_size: float = 14.0           # lado de la cara superior truncada (mm)
    height: float = 32.0             # altura total (mm)

    # Agujero pasante para el tornillo (a lo largo del eje Z, por el centro)
    screw_hole_diameter: float = 3.4    # paso libre para M3 (mm)
    screw_head_diameter: float = 6.2    # avellanado/alojamiento de cabeza (mm)
    screw_head_depth: float = 3.2       # profundidad del alojamiento (mm)
    through_hole: bool = True           # True: atraviesa toda la pieza

    # Márgenes usados para dimensionar el área de grabado de cada cara
    emoji_margin_fraction: float = 0.18  # margen relativo alrededor del emoji

    def __post_init__(self) -> None:
        if self.top_size >= self.base_size:
            raise ValueError("top_size debe ser menor que base_size (pirámide truncada)")
        if self.height <= 0:
            raise ValueError("height debe ser positivo")


def _frustum_vertices_faces(base: float, top: float, height: float):
    hb = base / 2.0
    ht = top / 2.0
    bottom = [(-hb, -hb, 0.0), (hb, -hb, 0.0), (hb, hb, 0.0), (-hb, hb, 0.0)]
    top_v = [(-ht, -ht, height), (ht, -ht, height), (ht, ht, height), (-ht, ht, height)]
    vertices = np.array(bottom + top_v, dtype=float)

    faces = []
    # tapa inferior (normal hacia -Z)
    faces += [[0, 2, 1], [0, 3, 2]]
    # tapa superior (normal hacia +Z)
    faces += [[4, 5, 6], [4, 6, 7]]
    # 4 caras laterales (cada una, 2 triángulos)
    for i in range(4):
        b0, b1 = i, (i + 1) % 4
        t0, t1 = 4 + i, 4 + (i + 1) % 4
        faces += [[b0, b1, t1], [b0, t1, t0]]

    return vertices, np.array(faces, dtype=int)


def build_frustum_mesh(spec: PyramidSpec) -> trimesh.Trimesh:
    """Crea el sólido macizo de la pirámide truncada (sin agujero)."""
    vertices, faces = _frustum_vertices_faces(spec.base_size, spec.top_size, spec.height)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    mesh.fix_normals()
    if not mesh.is_watertight:
        raise RuntimeError("El sólido base de la pirámide no es estanco (watertight)")
    return mesh


def _cylinder(radius: float, z0: float, z1: float, sections: int = 96) -> trimesh.Trimesh:
    height = z1 - z0
    cyl = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    cyl.apply_translation((0, 0, z0 + height / 2.0))
    return cyl


def apply_screw_hole(mesh: trimesh.Trimesh, spec: PyramidSpec) -> trimesh.Trimesh:
    """Resta el agujero pasante para el tornillo M3 (con alojamiento de
    cabeza en la cara superior) del sólido de la pirámide."""
    if spec.screw_hole_diameter <= 0:
        return mesh

    eps = 1.0
    z_bottom = -eps
    z_top = spec.height + eps

    hole = _cylinder(spec.screw_hole_diameter / 2.0, z_bottom, z_top)
    result = mesh.difference(hole, engine="manifold")

    if spec.screw_head_diameter > spec.screw_hole_diameter and spec.screw_head_depth > 0:
        head = _cylinder(
            spec.screw_head_diameter / 2.0,
            spec.height - spec.screw_head_depth,
            z_top,
        )
        result = result.difference(head, engine="manifold")

    if not result.is_watertight:
        raise RuntimeError("El sólido no quedó estanco tras taladrar el agujero del tornillo")
    return result


def face_frame(spec: PyramidSpec, index: int) -> FaceFrame:
    """Devuelve el marco de referencia (origen + ejes) de la cara lateral
    `index` (0=front/-Y, 1=right/+X, 2=back/+Y, 3=left/-X), pensado para
    situar encima un grabado (emoji) centrado horizontalmente y con un
    margen respecto a los bordes superior e inferior.
    """
    hb = spec.base_size / 2.0
    ht = spec.top_size / 2.0
    h = spec.height

    # Cara "front" (-Y) en su posición canónica, luego se rota 90*index
    # grados alrededor de Z para obtener las otras 3.
    bottom_mid = np.array([0.0, -hb, 0.0])
    top_mid = np.array([0.0, -ht, h])
    u_hat0 = np.array([1.0, 0.0, 0.0])
    v_vec0 = top_mid - bottom_mid
    v_len0 = float(np.linalg.norm(v_vec0))
    v_hat0 = v_vec0 / v_len0
    normal0 = np.cross(u_hat0, v_hat0)
    normal0 = normal0 / np.linalg.norm(normal0)
    # Asegura que la normal apunta hacia fuera (hacia -Y en el centro de la cara)
    if normal0[1] > 0:
        normal0 = -normal0
        u_hat0 = -u_hat0  # mantiene un sistema u,v,n right-handed y u apuntando a +X visualmente

    angle = np.deg2rad(90.0 * index)
    c, s = np.cos(angle), np.sin(angle)
    rot = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])

    origin_local = bottom_mid + v_hat0 * 0  # se ajusta más abajo con márgenes
    u_hat = rot @ u_hat0
    v_hat = rot @ v_hat0
    normal = rot @ normal0
    bottom_mid_r = rot @ bottom_mid

    # Anchura utilizable: la cara es un trapecio, para que el grabado no
    # sobresalga del borde superior (más estrecho) usamos el ancho superior
    # menos un margen; la altura utilizable es la longitud de la pendiente
    # menos un margen arriba y abajo.
    margin = spec.emoji_margin_fraction
    usable_width = 2.0 * ht * (1.0 - margin)
    usable_height = v_len0 * (1.0 - 2.0 * margin)
    v_offset = v_len0 * margin

    origin = bottom_mid_r + v_hat * v_offset

    return FaceFrame(
        name=SIDE_FACE_NAMES[index % 4],
        origin=origin,
        u_hat=u_hat,
        v_hat=v_hat,
        normal=normal,
        u_extent=usable_width,
        v_extent=usable_height,
    )


def all_side_face_frames(spec: PyramidSpec) -> List[FaceFrame]:
    return [face_frame(spec, i) for i in range(4)]
