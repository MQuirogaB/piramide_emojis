import numpy as np
import pytest

from piramide_emoji.geometry import PyramidSpec, build_frustum_mesh, apply_screw_hole, face_frame


def test_frustum_is_watertight():
    spec = PyramidSpec()
    mesh = build_frustum_mesh(spec)
    assert mesh.is_watertight
    assert mesh.volume > 0


def test_top_must_be_smaller_than_base():
    with pytest.raises(ValueError):
        PyramidSpec(base_size=10, top_size=20)


def test_screw_hole_reduces_volume_and_stays_watertight():
    spec = PyramidSpec()
    mesh = build_frustum_mesh(spec)
    vol_before = mesh.volume
    mesh = apply_screw_hole(mesh, spec)
    assert mesh.is_watertight
    assert mesh.volume < vol_before


def test_face_frame_normals_point_outward():
    spec = PyramidSpec()
    for i in range(4):
        frame = face_frame(spec, i)
        # El punto en el centro de la franja de grabado, desplazado un poco
        # hacia fuera a lo largo de la normal, debe quedar FUERA del sólido;
        # desplazado hacia dentro debe quedar DENTRO.
        mesh = build_frustum_mesh(spec)
        outside = frame.origin + frame.normal * 2.0
        inside = frame.origin - frame.normal * 2.0
        assert not mesh.contains([outside])[0]
        assert mesh.contains([inside])[0]
