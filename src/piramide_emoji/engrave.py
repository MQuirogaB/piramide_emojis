"""Construye un relieve (heightmap) 3D a partir de un emoji rasterizado y lo
graba (o repuja) sobre una cara plana arbitraria de la pirámide mediante una
resta/unión booleana robusta (motor `manifold`)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import trimesh

from .geometry import FaceFrame
from .emoji_source import get_emoji_array, to_heightmap

Mode = Literal["engrave", "emboss"]


@dataclass
class EngraveSpec:
    emoji: str
    mode: Mode = "engrave"
    depth: float = 1.0          # profundidad (engrave) o altura (emboss) máxima, mm
    base_skin: float = 0.05     # corte/relieve mínimo en el fondo, mm (robustez booleana)
    resolution: int = 96        # resolución de la rejilla del heightmap (N x N)
    scale: float = 1.0          # factor de escala respecto al área utilizable de la cara
    invert: bool = False        # invierte qué zonas del dibujo quedan "activas"


def _stamp_mesh_world(
    frame: FaceFrame,
    heightmap: np.ndarray,
    depth: float,
    base_skin: float,
    mode: Mode,
    scale: float,
) -> trimesh.Trimesh:
    """Genera el sólido del "sello" ya posicionado en coordenadas del mundo,
    listo para restar (engrave) o unir (emboss) con la pirámide.

    heightmap: array (n, n) con valores 0..1 (0 = fondo, 1 = máximo grabado/relieve)

    El sello es un prisma con una cara EXTERIOR plana (a ras/ligeramente por
    fuera de la cara real de la pieza, para que la resta booleana la
    atraviese siempre limpiamente) y una cara INTERIOR con el contorno del
    heightmap: así solo se retira (o añade, en emboss) una capa fina y
    contorneada, no un bloque uniformemente profundo.
    """
    # La fila 0 de un array de imagen es la parte SUPERIOR del dibujo, pero
    # v=0 es la parte INFERIOR de la cara; se voltea verticalmente para que
    # el emoji quede orientado igual que se ve en pantalla.
    heightmap = np.flipud(heightmap)

    n = heightmap.shape[0]
    u_extent = frame.u_extent * scale
    v_extent = frame.v_extent * scale

    us = np.linspace(-u_extent / 2.0, u_extent / 2.0, n)
    vs = np.linspace(0.0, v_extent, n)
    uu, vv = np.meshgrid(us, vs, indexing="xy")

    depths = heightmap * depth  # 0 (fondo) .. depth (máximo grabado/relieve)
    if mode == "engrave":
        # Cara exterior plana, ligeramente por fuera de la superficie real.
        w_outer = np.full_like(uu, base_skin)
        # Cara interior: se hunde según el heightmap (0..depth mm).
        w_inner = -depths
    else:  # emboss
        # Cara exterior (la que suelda con la pieza) ligeramente por dentro.
        w_outer = np.full_like(uu, -base_skin)
        # Cara interior: sobresale según el heightmap (0..depth mm).
        w_inner = depths

    # Punto de origen de la cara + eje v centrado en el punto medio de la
    # franja utilizable (frame.origin ya está desplazado el margen inferior).
    origin = frame.origin + frame.v_hat * ((frame.v_extent - v_extent) / 2.0)

    def to_world(u, v, w):
        return (
            origin
            + u[..., None] * frame.u_hat
            + v[..., None] * frame.v_hat
            + w[..., None] * frame.normal
        )

    top_pts = to_world(uu, vv, w_outer)
    bottom_pts = to_world(uu, vv, w_inner)

    top_pts = top_pts.reshape(-1, 3)
    bottom_pts = bottom_pts.reshape(-1, 3)
    vertices = np.vstack([top_pts, bottom_pts])
    n_top = top_pts.shape[0]

    def idx(i, j, layer=0):
        return layer * n_top + i * n + j

    faces = []
    for i in range(n - 1):
        for j in range(n - 1):
            a = idx(i, j, 0)
            b = idx(i, j + 1, 0)
            c = idx(i + 1, j + 1, 0)
            d = idx(i + 1, j, 0)
            faces += [[a, b, c], [a, c, d]]

            a2 = idx(i, j, 1)
            b2 = idx(i, j + 1, 1)
            c2 = idx(i + 1, j + 1, 1)
            d2 = idx(i + 1, j, 1)
            faces += [[a2, c2, b2], [a2, d2, c2]]

    # Paredes laterales: un único bucle recorriendo todo el perímetro de la
    # rejilla en un único sentido (evita inconsistencias de bobinado en las
    # esquinas que dejarían la malla resultante como "no-manifold" para el
    # motor booleano, aunque trimesh la considere "watertight").
    perimeter = []
    perimeter += [(0, j) for j in range(n)]
    perimeter += [(i, n - 1) for i in range(1, n)]
    perimeter += [(n - 1, j) for j in range(n - 2, -1, -1)]
    perimeter += [(i, 0) for i in range(n - 2, 0, -1)]

    for k in range(len(perimeter)):
        i0, j0 = perimeter[k]
        i1, j1 = perimeter[(k + 1) % len(perimeter)]
        t0, t1 = idx(i0, j0, 0), idx(i1, j1, 0)
        b0, b1 = idx(i0, j0, 1), idx(i1, j1, 1)
        # Bobinado invertido respecto al de las caras superiores para que
        # cada arista compartida se recorra en sentidos opuestos desde sus
        # dos triángulos adyacentes (condición de malla 2-manifold).
        faces.append([t1, t0, b0])
        faces.append([t1, b0, b1])

    mesh = trimesh.Trimesh(vertices=vertices, faces=np.array(faces), process=False)
    if mesh.volume < 0:
        mesh.invert()
    return mesh


def engrave_emoji_on_face(
    mesh: trimesh.Trimesh,
    frame: FaceFrame,
    spec: EngraveSpec,
    cache_dir=None,
) -> trimesh.Trimesh:
    """Devuelve una copia de `mesh` con el emoji de `spec` grabado (o
    repujado) sobre la cara descrita por `frame`."""
    kwargs = {}
    if cache_dir is not None:
        kwargs["cache_dir"] = cache_dir
    rgba = get_emoji_array(spec.emoji, resolution=spec.resolution, **kwargs)
    heightmap = to_heightmap(rgba, invert=spec.invert)

    stamp = _stamp_mesh_world(
        frame,
        heightmap,
        depth=spec.depth,
        base_skin=spec.base_skin,
        mode=spec.mode,
        scale=spec.scale,
    )

    if spec.mode == "engrave":
        result = mesh.difference(stamp, engine="manifold")
    else:
        result = mesh.union(stamp, engine="manifold")

    if not result.is_watertight:
        raise RuntimeError(
            f"El resultado no quedó estanco tras grabar el emoji en la cara "
            f"'{frame.name}'. Prueba a reducir 'depth' o 'scale'."
        )
    return result
