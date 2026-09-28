import numpy as np
import trimesh

from piramide_emoji.geometry import FaceFrame
from piramide_emoji.engrave import _stamp_mesh_world


def _flat_frame():
    return FaceFrame(
        name="testflat",
        origin=np.array([0.0, 20.0, 15.0]),
        u_hat=np.array([1.0, 0.0, 0.0]),
        v_hat=np.array([0.0, 0.0, 1.0]),
        normal=np.array([0.0, 1.0, 0.0]),
        u_extent=20.0,
        v_extent=20.0,
    )


def test_stamp_is_a_valid_manifold_solid():
    frame = _flat_frame()
    heightmap = np.random.default_rng(0).random((24, 24))
    stamp = _stamp_mesh_world(frame, heightmap, depth=0.8, base_skin=0.05, mode="engrave", scale=0.9)
    assert stamp.is_watertight
    assert stamp.volume > 0

    import manifold3d as m3d

    mm = m3d.Manifold(
        mesh=m3d.Mesh(
            vert_properties=stamp.vertices.astype(np.float32),
            tri_verts=stamp.faces.astype(np.uint32),
        )
    )
    assert str(mm.status()) == "Error.NoError"


def test_engraving_actually_removes_surface_material():
    """Regresión: una versión anterior generaba un sello con el bobinado de
    las paredes invertido, que `manifold3d` aceptaba pero sin restar nada
    visible (dejaba una fina 'piel' intacta sobre una cavidad oculta)."""
    frame = _flat_frame()
    heightmap = np.ones((16, 16))  # grabado a máxima profundidad en toda la huella

    stamp = _stamp_mesh_world(frame, heightmap, depth=0.8, base_skin=0.05, mode="engrave", scale=0.9)

    box = trimesh.creation.box((40, 40, 40))
    box.apply_translation((0, 0, 20))
    result = box.difference(stamp, engine="manifold")
    assert result.is_watertight

    # Lanza un rayo desde fuera, hacia el centro de la huella grabada: debe
    # golpear una superficie claramente hundida respecto a la cara original.
    # (centro de la franja: u=0, v=v_extent/2 -> z = origin.z + v_extent/2)
    origins = np.array([[0.0, 100.0, frame.origin[2] + frame.v_extent / 2.0]])
    directions = np.array([[0.0, -1.0, 0.0]])
    locations, index_ray, _ = result.ray.intersects_location(origins, directions, multiple_hits=False)
    assert len(locations) == 1
    hit_y = locations[0][1]
    assert hit_y < 19.5  # claramente por dentro de la cara original (y=20)
