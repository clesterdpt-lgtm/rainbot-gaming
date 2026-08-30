#!/usr/bin/env python3
"""Build an animation-ready face appliance for the optimized Mr. Feast rig.

The Meshy body is intentionally preserved.  This pass removes only source
triangles that are first-hit visible through a conservative inner face mask,
then adds a deterministic connected face appliance, separate eyes and eyelids,
an oral cavity, teeth, brows, lips, and the existing ten semantic shape keys.

Run with Blender 4.5 LTS or newer::

    blender --background \
      --python scripts/blender/retopologize-mr-feast-face.py -- \
      --input-blend assets/models/mr-feast/processed/mr-feast-working.blend \
      --output assets/models/mr-feast/processed/mr-feast-game-retopo-face-v1.glb \
      --report assets/models/mr-feast/processed/mr-feast-retopology-report.json \
      --preview-dir output/blender/mr-feast-retopo-v1 \
      --force

The appearance pass first attempts a selected-to-active Cycles bake and rejects
blank pixels.  Blender's fragmented source currently needs the deterministic
fallback: a head-on unlit source-color projection into one unified 1024 atlas.
Both paths preserve topology and morph indices.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


PIPELINE_VERSION = 1
TARGETS = (
    "blink_left",
    "blink_right",
    "brow_raise",
    "brow_compress",
    "smile",
    "smile_wide",
    "sneer_left",
    "sneer_right",
    "mouth_open",
    "jaw_shift",
)

# Blender is Z-up; the neutral character looks toward -Y.  +X is anatomical
# left.  These landmarks were measured from the normalized 1.92m working mesh.
FACE_CENTER_X = -0.0115
FACE_CENTER_Z = 1.748
FACE_RADIUS_X = 0.080
FACE_RADIUS_Z = 0.115
FACE_GRID = 97
FACE_OUTSET = 0.0012
PERIMETER_TUCK = 0.0045
RAY_ORIGIN_Y = -0.30
RAY_DISTANCE = 0.60

EYES = {
    # Centers sit 1.5mm behind the measured corneal surface so the spheres read
    # through the almond apertures instead of protruding as circular goggles.
    # The source albedo's painted eyes center at 1.779m. Keeping the openings
    # on that landmark prevents the separate eyeballs from reading as a second
    # pair of eyes on the forehead after the planar texture transfer.
    "left": {"center": Vector((0.020, -0.1151, 1.779)), "source_y": -0.1281},
    "right": {"center": Vector((-0.043, -0.1233, 1.779)), "source_y": -0.1363},
}
EYE_RADIUS = 0.0130
EYE_APERTURE_X = 0.0120
EYE_APERTURE_Z = 0.0048

MOUTH_CENTER = Vector((-0.0115, -0.1286, 1.706))
def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-blend", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--preview-dir", type=Path)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


def exportable(obj: bpy.types.Object) -> bool:
    return not any(collection.name == "glTF_not_exported" for collection in obj.users_collection)


def ensure_safe(paths: list[Path], force: bool) -> None:
    existing = [path for path in paths if path.exists()]
    if existing and not force:
        raise FileExistsError("Refusing to replace outputs without --force: " + ", ".join(map(str, existing)))


def make_material(name: str, color: tuple[float, float, float, float], roughness: float) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = roughness
        if "IOR" in bsdf.inputs:
            bsdf.inputs["IOR"].default_value = 1.45
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (0, 0, 0, 1)
        elif "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = (0, 0, 0, 1)
    material.diffuse_color = color
    return material


def world_to_local(source: bpy.types.Object, point: Vector) -> Vector:
    return source.matrix_world.inverted_safe() @ point


def add_armature_skin(
    obj: bpy.types.Object,
    source: bpy.types.Object,
    armature: bpy.types.Object,
    weights: list[tuple[float, float]] | None = None,
) -> None:
    obj.matrix_world = source.matrix_world.copy()
    modifier = obj.modifiers.new(name="Armature", type="ARMATURE")
    modifier.object = armature
    # Match the source body's skin contract: the skinned mesh remains a scene
    # root while the Armature modifier references the rig.  Parenting these
    # attachments beneath the already 0.01-scaled armature makes Three.js r128
    # apply that normalization twice, collapsing the facial parts to 1/100 of
    # their intended size once an animation is evaluated.
    head = obj.vertex_groups.new(name="Head")
    neck = obj.vertex_groups.new(name="neck")
    if weights is None:
        head.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        return
    for index, (head_weight, neck_weight) in enumerate(weights):
        if head_weight > 0:
            head.add([index], head_weight, "REPLACE")
        if neck_weight > 0:
            neck.add([index], neck_weight, "REPLACE")


def create_mesh_object(
    name: str,
    world_vertices: list[Vector],
    faces: list[tuple[int, ...]],
    source: bpy.types.Object,
    armature: bpy.types.Object,
    materials: list[bpy.types.Material],
    weights: list[tuple[float, float]] | None = None,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([world_to_local(source, point) for point in world_vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for material in materials:
        mesh.materials.append(material)
    add_armature_skin(obj, source, armature, weights)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def mesh_bvh(obj: bpy.types.Object) -> tuple[BVHTree, list[Vector], list[tuple[int, int, int]]]:
    mesh = obj.data
    mesh.calc_loop_triangles()
    vertices = [obj.matrix_world @ vertex.co for vertex in mesh.vertices]
    triangles = [tuple(loop.vertices) for loop in mesh.loop_triangles]
    return BVHTree.FromPolygons(vertices, triangles, all_triangles=True), vertices, triangles


def ray_y(bvh: BVHTree, x: float, z: float, fallback: float = -0.085) -> tuple[float, int | None]:
    hit, _normal, triangle_index, _distance = bvh.ray_cast(
        Vector((x, RAY_ORIGIN_Y, z)), Vector((0, 1, 0)), RAY_DISTANCE
    )
    if hit is None:
        return fallback, None
    return hit.y, triangle_index


def square_to_disk(u: float, v: float) -> tuple[float, float]:
    # Elliptical grid mapping keeps one connected quad surface while turning
    # the square boundary into a clean oval appliance perimeter.
    x = u * math.sqrt(max(0.0, 1.0 - 0.5 * v * v))
    z = v * math.sqrt(max(0.0, 1.0 - 0.5 * u * u))
    return x, z


def disk_to_square(x: float, z: float) -> tuple[float, float]:
    """Invert the elliptical square-to-disk map used by the face grid."""
    root_two = math.sqrt(2.0)
    u = 0.5 * (
        math.sqrt(max(0.0, 2.0 + x * x - z * z + 2.0 * root_two * x))
        - math.sqrt(max(0.0, 2.0 + x * x - z * z - 2.0 * root_two * x))
    )
    v = 0.5 * (
        math.sqrt(max(0.0, 2.0 - x * x + z * z + 2.0 * root_two * z))
        - math.sqrt(max(0.0, 2.0 - x * x + z * z - 2.0 * root_two * z))
    )
    return max(-1.0, min(1.0, u)), max(-1.0, min(1.0, v))


def add_face_projection_uv(obj: bpy.types.Object) -> None:
    """Map an attachment into the same head-on atlas as the connected face."""
    uv_layer = obj.data.uv_layers.new(name="RetopoFaceUV")
    for loop in obj.data.loops:
        point = obj.matrix_world @ obj.data.vertices[loop.vertex_index].co
        disk_x = (point.x - FACE_CENTER_X) / FACE_RADIUS_X
        disk_z = (point.z - FACE_CENTER_Z) / FACE_RADIUS_Z
        u, v = disk_to_square(disk_x, disk_z)
        uv_layer.data[loop.index].uv = ((u + 1.0) * 0.5, (v + 1.0) * 0.5)


def smooth_ellipse(x: float, z: float, cx: float, cz: float, rx: float, rz: float) -> float:
    radius_squared = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2
    return max(0.0, 1.0 - radius_squared) ** 2


def build_face_surface(
    source: bpy.types.Object,
    armature: bpy.types.Object,
    bvh: BVHTree,
    skin_material: bpy.types.Material,
    beard_material: bpy.types.Material,
) -> tuple[bpy.types.Object, list[dict[str, float]]]:
    count = FACE_GRID
    samples: list[dict[str, float]] = []
    raw_y: list[float] = []
    for row in range(count):
        v = -1.0 + 2.0 * row / (count - 1)
        for column in range(count):
            u = -1.0 + 2.0 * column / (count - 1)
            disk_x, disk_z = square_to_disk(u, v)
            x = FACE_CENTER_X + FACE_RADIUS_X * disk_x
            z = FACE_CENTER_Z + FACE_RADIUS_Z * disk_z
            fallback = -0.075 - 0.048 * max(0.0, 1.0 - disk_x * disk_x - disk_z * disk_z)
            y, _triangle = ray_y(bvh, x, z, fallback)
            samples.append({"u": u, "v": v, "dx": disk_x, "dz": disk_z, "x": x, "z": z})
            raw_y.append(y)

    # Median-like neighbor relaxation removes the disconnected source's tiny
    # depth spikes while retaining the projected nose and cheek silhouette.
    y_values = list(raw_y)
    for _pass in range(2):
        next_values = list(y_values)
        for row in range(1, count - 1):
            for column in range(1, count - 1):
                index = row * count + column
                sample = samples[index]
                neighbors = [
                    y_values[index - 1], y_values[index + 1],
                    y_values[index - count], y_values[index + count],
                ]
                ordered = sorted(neighbors)
                median = 0.5 * (ordered[1] + ordered[2])
                nose_lock = smooth_ellipse(sample["x"], sample["z"], -0.0115, 1.750, 0.025, 0.045)
                blend = 0.24 * (1.0 - 0.8 * nose_lock)
                next_values[index] = y_values[index] * (1.0 - blend) + median * blend
        y_values = next_values

    vertices: list[Vector] = []
    weights: list[tuple[float, float]] = []
    for index, sample in enumerate(samples):
        radius = min(1.0, math.sqrt(sample["dx"] ** 2 + sample["dz"] ** 2))
        perimeter = max(0.0, min(1.0, (radius - 0.82) / 0.18))
        y = y_values[index] - FACE_OUTSET + PERIMETER_TUCK * perimeter * perimeter
        vertices.append(Vector((sample["x"], y, sample["z"])))
        neck_weight = 0.0
        if sample["z"] < 1.655:
            neck_weight = min(0.20, (1.655 - sample["z"]) / 0.045 * 0.20) * perimeter
        weights.append((1.0 - neck_weight, neck_weight))
        sample["radius"] = radius

    faces: list[tuple[int, int, int, int]] = []
    for row in range(count - 1):
        for column in range(count - 1):
            a = row * count + column
            corners = (a, a + 1, a + 1 + count, a + count)
            center_x = sum(samples[index]["x"] for index in corners) * 0.25
            center_z = sum(samples[index]["z"] for index in corners) * 0.25
            eye_hole = any(
                ((center_x - spec["center"].x) / EYE_APERTURE_X) ** 2
                + ((center_z - spec["center"].z) / EYE_APERTURE_Z) ** 2 <= 1.0
                for spec in EYES.values()
            )
            mouth_hole = (
                ((center_x - MOUTH_CENTER.x) / 0.0385) ** 2
                + ((center_z - MOUTH_CENTER.z) / 0.0017) ** 2 <= 1.0
            )
            if not eye_hole and not mouth_hole:
                faces.append(corners)

    # Remove every unused interior vertex and remap the faces.  This turns the
    # three apertures into real compacted holes without loose geometry while
    # leaving the appliance itself as one connected component.
    used = sorted({index for face in faces for index in face})
    remap = {old: new for new, old in enumerate(used)}
    vertices = [vertices[index] for index in used]
    weights = [weights[index] for index in used]
    samples = [samples[index] for index in used]
    faces = [tuple(remap[index] for index in face) for face in faces]

    obj = create_mesh_object(
        "MrFeast_RetopoFace", vertices, faces, source, armature,
        [skin_material, beard_material], weights,
    )
    # Frame the lower face with a restrained dark beard material.  The central
    # mouth remains available to the lip/cavity geometry.
    for polygon in obj.data.polygons:
        center = obj.matrix_world @ polygon.center
        side = abs(center.x - FACE_CENTER_X)
        beard_line = 1.674 + min(0.034, side * 0.42)
        polygon.material_index = 1 if center.z < beard_line else 0
    uv_layer = obj.data.uv_layers.new(name="RetopoFaceUV")
    for loop in obj.data.loops:
        sample = samples[loop.vertex_index]
        uv_layer.data[loop.index].uv = ((sample["u"] + 1.0) * 0.5, (sample["v"] + 1.0) * 0.5)
    return obj, samples


def bake_face_albedo(
    source: bpy.types.Object,
    face: bpy.types.Object,
    size: int = 1024,
) -> tuple[bool, str | None, dict[str, float]]:
    """Bake Meshy's fragmented atlas to one deterministic face texture."""
    image = bpy.data.images.get("MrFeast_RetopoFace_Albedo") or bpy.data.images.new(
        "MrFeast_RetopoFace_Albedo", width=size, height=size, alpha=False
    )
    image.generated_color = (0.34, 0.16, 0.10, 1)
    material = bpy.data.materials.get("MrFeast_RetopoFace_Baked") or bpy.data.materials.new("MrFeast_RetopoFace_Baked")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    nodes.active = texture
    links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.68
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = 1.45
    face.data.materials.clear()
    face.data.materials.append(material)
    for polygon in face.data.polygons:
        polygon.material_index = 0

    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    face.select_set(True)
    bpy.context.view_layer.objects.active = face
    scene = bpy.context.scene
    prior_engine = scene.render.engine
    try:
        scene.render.engine = "CYCLES"
        bpy.ops.object.bake(
            type="DIFFUSE",
            pass_filter={"COLOR"},
            use_selected_to_active=True,
            use_clear=True,
            # Both objects retain Meshy's 0.01 object scale.  Bake distances
            # are local units, so these correspond to 4mm/40mm world space.
            cage_extrusion=0.4,
            max_ray_distance=4.0,
            margin=12,
        )
        stats = image_pixel_stats(image)
        stats["method"] = "cycles-selected-to-active"
        if stats["maximumLuminance"] < 0.01 or stats["luminanceRange"] < 0.01:
            raise RuntimeError(f"Unified face albedo bake is blank or constant: {stats}")
        image.pack()
        return True, None, stats
    except Exception as error:
        selected_to_active_error = str(error)
        try:
            stats = project_face_albedo_front(source, face, image, size)
            stats["method"] = "orthographic-source-albedo-projection"
            stats["selectedToActiveFallbackReason"] = selected_to_active_error
            if stats["maximumLuminance"] < 0.01 or stats["luminanceRange"] < 0.01:
                raise RuntimeError(f"Orthographic face albedo projection is blank or constant: {stats}")
            image.pack()
            return True, None, stats
        except Exception as projection_error:
            face.data.materials.clear()
            fallback = bpy.data.materials.get("MrFeast_Retopo_Skin")
            if fallback:
                face.data.materials.append(fallback)
            return False, f"selected-to-active: {selected_to_active_error}; projection: {projection_error}", {}
    finally:
        scene.render.engine = prior_engine


def image_pixel_stats(image: bpy.types.Image) -> dict[str, float]:
    pixels = image.pixels[:]
    luminance = []
    for offset in range(0, len(pixels), 4 * 64):
        red, green, blue = pixels[offset : offset + 3]
        luminance.append(0.2126 * red + 0.7152 * green + 0.0722 * blue)
    return {
        "minimumLuminance": round(min(luminance), 6),
        "maximumLuminance": round(max(luminance), 6),
        "meanLuminance": round(sum(luminance) / len(luminance), 6),
        "luminanceRange": round(max(luminance) - min(luminance), 6),
    }


def project_face_albedo_front(
    source: bpy.types.Object,
    face: bpy.types.Object,
    destination: bpy.types.Image,
    size: int,
) -> dict[str, float]:
    """Render source base color head-on into the appliance's planar atlas."""
    scene = bpy.context.scene
    source_material = source.data.materials[0]
    projection_material = source_material.copy()
    projection_material.name = "MrFeast_SourceAlbedoProjection"
    projection_material.use_nodes = True
    nodes = projection_material.node_tree.nodes
    links = projection_material.node_tree.links
    output = next((node for node in nodes if node.type == "OUTPUT_MATERIAL"), None)
    bsdf = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    if output is None or bsdf is None:
        raise RuntimeError("Source material lacks a Principled color path for planar projection")
    emission = nodes.new("ShaderNodeEmission")
    base_color = bsdf.inputs.get("Base Color")
    if base_color and base_color.is_linked:
        links.new(base_color.links[0].from_socket, emission.inputs["Color"])
    else:
        emission.inputs["Color"].default_value = base_color.default_value if base_color else (0.5, 0.3, 0.2, 1)
    emission.inputs["Strength"].default_value = 1.0
    for link in list(output.inputs["Surface"].links):
        links.remove(link)
    links.new(emission.outputs["Emission"], output.inputs["Surface"])

    material_slot = source.data.materials[0]
    source.data.materials[0] = projection_material
    hidden = {obj: obj.hide_render for obj in scene.objects if obj.type == "MESH" and obj != source}
    for obj in hidden:
        obj.hide_render = True

    camera_data = bpy.data.cameras.new("MrFeastAlbedoProjectionCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = FACE_RADIUS_Z * 2.0
    camera = bpy.data.objects.new("MrFeastAlbedoProjectionCamera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = Vector((FACE_CENTER_X, -2.5, FACE_CENTER_Z))
    look_at(camera, Vector((FACE_CENTER_X, -0.05, FACE_CENTER_Z)))

    prior = {
        "camera": scene.camera,
        "engine": scene.render.engine,
        "resolution_x": scene.render.resolution_x,
        "resolution_y": scene.render.resolution_y,
        "resolution_percentage": scene.render.resolution_percentage,
        "filepath": scene.render.filepath,
        "film_transparent": scene.render.film_transparent,
        "file_format": scene.render.image_settings.file_format,
    }
    temp_path = Path(bpy.app.tempdir or "/tmp") / "mr-feast-retopo-albedo-projection.png"
    rendered = None
    try:
        scene.camera = camera
        scene.render.engine = "BLENDER_EEVEE_NEXT"
        scene.render.resolution_x = max(1, round(size * FACE_RADIUS_X / FACE_RADIUS_Z))
        scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = False
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(temp_path)
        bpy.ops.render.render(write_still=True)
        rendered = bpy.data.images.load(str(temp_path), check_existing=False)
        rendered.scale(size, size)
        destination.scale(size, size)
        destination.pixels.foreach_set(rendered.pixels[:])
        destination.update()
        return image_pixel_stats(destination)
    finally:
        source.data.materials[0] = material_slot
        for obj, was_hidden in hidden.items():
            obj.hide_render = was_hidden
        scene.camera = prior["camera"]
        scene.render.engine = prior["engine"]
        scene.render.resolution_x = prior["resolution_x"]
        scene.render.resolution_y = prior["resolution_y"]
        scene.render.resolution_percentage = prior["resolution_percentage"]
        scene.render.filepath = prior["filepath"]
        scene.render.film_transparent = prior["film_transparent"]
        scene.render.image_settings.file_format = prior["file_format"]
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.materials.remove(projection_material)
        if rendered is not None:
            bpy.data.images.remove(rendered)


def add_world_delta(obj: bpy.types.Object, key: bpy.types.ShapeKey, index: int, delta: Vector) -> None:
    key.data[index].co += obj.matrix_world.inverted_safe().to_3x3() @ delta


def author_face_shapes(obj: bpy.types.Object, samples: list[dict[str, float]]) -> None:
    obj.shape_key_add(name="Basis")
    keys = {name: obj.shape_key_add(name=name) for name in TARGETS}
    for key in keys.values():
        key.interpolation = "KEY_LINEAR"
    for index, sample in enumerate(samples):
        x, z = sample["x"], sample["z"]
        left_eye = smooth_ellipse(x, z, EYES["left"]["center"].x, EYES["left"]["center"].z, 0.030, 0.017)
        right_eye = smooth_ellipse(x, z, EYES["right"]["center"].x, EYES["right"]["center"].z, 0.030, 0.017)
        if left_eye:
            direction = -1 if z >= EYES["left"]["center"].z else 1
            add_world_delta(obj, keys["blink_left"], index, Vector((0, -0.0005, direction * 0.0060 * left_eye)))
        if right_eye:
            direction = -1 if z >= EYES["right"]["center"].z else 1
            add_world_delta(obj, keys["blink_right"], index, Vector((0, -0.0005, direction * 0.0060 * right_eye)))

        brow_left = smooth_ellipse(x, z, EYES["left"]["center"].x, EYES["left"]["center"].z + 0.027, 0.040, 0.020)
        brow_right = smooth_ellipse(x, z, EYES["right"]["center"].x, EYES["right"]["center"].z + 0.027, 0.040, 0.020)
        brow = max(brow_left, brow_right)
        add_world_delta(obj, keys["brow_raise"], index, Vector((0, -0.0010 * brow, 0.0090 * brow)))
        inward = -1 if x > FACE_CENTER_X else 1
        add_world_delta(obj, keys["brow_compress"], index, Vector((inward * 0.0050 * brow, -0.0010 * brow, -0.0045 * brow)))

        corner_left = smooth_ellipse(x, z, 0.030, 1.715, 0.034, 0.028)
        corner_right = smooth_ellipse(x, z, -0.047, 1.715, 0.034, 0.028)
        corner = max(corner_left, corner_right)
        outward = 1 if x > FACE_CENTER_X else -1
        add_world_delta(obj, keys["smile"], index, Vector((outward * 0.0060 * corner, -0.0010 * corner, 0.0055 * corner)))
        add_world_delta(obj, keys["smile_wide"], index, Vector((outward * 0.0120 * corner, -0.0020 * corner, 0.0100 * corner)))
        add_world_delta(obj, keys["sneer_left"], index, Vector((0.0020 * corner_left, -0.0010 * corner_left, 0.0080 * corner_left)))
        add_world_delta(obj, keys["sneer_right"], index, Vector((-0.0020 * corner_right, -0.0010 * corner_right, 0.0080 * corner_right)))
        lower_face = smooth_ellipse(x, z, MOUTH_CENTER.x, 1.676, 0.080, 0.060) if z < MOUTH_CENTER.z else 0.0
        horizontal_mouth = max(0.0, 1.0 - abs(x - MOUTH_CENTER.x) / 0.050) ** 2
        vertical_mouth = max(0.0, 1.0 - abs(z - MOUTH_CENTER.z) / 0.022) ** 2
        mouth_boundary = horizontal_mouth * vertical_mouth
        if z < MOUTH_CENTER.z:
            add_world_delta(obj, keys["mouth_open"], index, Vector((0, 0.0010 * mouth_boundary, -0.0140 * mouth_boundary - 0.0040 * lower_face)))
        else:
            add_world_delta(obj, keys["mouth_open"], index, Vector((0, -0.0005 * mouth_boundary, 0.0015 * mouth_boundary)))
        add_world_delta(obj, keys["jaw_shift"], index, Vector((0.0080 * lower_face, 0, -0.0010 * lower_face)))


def sphere_geometry(center: Vector, radius: float, segments: int = 48, rings: int = 24) -> tuple[list[Vector], list[tuple[int, ...]]]:
    vertices = [center + Vector((0, 0, radius))]
    for ring in range(1, rings):
        phi = math.pi * ring / rings
        z = radius * math.cos(phi)
        radial = radius * math.sin(phi)
        for segment in range(segments):
            theta = 2 * math.pi * segment / segments
            vertices.append(center + Vector((radial * math.cos(theta), radial * math.sin(theta), z)))
    bottom = len(vertices)
    vertices.append(center + Vector((0, 0, -radius)))
    faces: list[tuple[int, ...]] = []
    for segment in range(segments):
        faces.append((0, 1 + segment, 1 + (segment + 1) % segments))
    for ring in range(rings - 2):
        start = 1 + ring * segments
        next_start = start + segments
        for segment in range(segments):
            nxt = (segment + 1) % segments
            faces.append((start + segment, next_start + segment, next_start + nxt, start + nxt))
    start = 1 + (rings - 2) * segments
    for segment in range(segments):
        faces.append((start + segment, bottom, start + (segment + 1) % segments))
    return vertices, faces


def build_eyes(
    source: bpy.types.Object,
    armature: bpy.types.Object,
    white: bpy.types.Material,
    iris: bpy.types.Material,
    pupil: bpy.types.Material,
) -> list[bpy.types.Object]:
    objects = []
    for side, spec in (("L", EYES["left"]), ("R", EYES["right"])):
        vertices, faces = sphere_geometry(spec["center"], EYE_RADIUS)
        eye = create_mesh_object(f"MrFeast_Eye_{side}", vertices, faces, source, armature, [white])
        objects.append(eye)

        eye_front_y = spec["center"].y - EYE_RADIUS
        iris_center = Vector((spec["center"].x, eye_front_y - 0.0004, spec["center"].z))
        pupil_center = Vector((spec["center"].x, eye_front_y - 0.0008, spec["center"].z))
        iris_vertices, iris_faces = ellipse_disk(iris_center, 0.0046, 0.0046, 48)
        pupil_vertices, pupil_faces = ellipse_disk(pupil_center, 0.0020, 0.0020, 48)
        pupil_offset = len(iris_vertices)
        detail = create_mesh_object(
            f"MrFeast_EyeDetail_{side}",
            iris_vertices + pupil_vertices,
            iris_faces + [tuple(index + pupil_offset for index in face) for face in pupil_faces],
            source,
            armature,
            [iris, pupil],
        )
        for polygon in detail.data.polygons:
            polygon.material_index = 0 if polygon.index < len(iris_faces) else 1
            polygon.use_smooth = False
        objects.append(detail)
    return objects


def eye_surface_y(center: Vector, x: float, z: float) -> float:
    distance_squared = (x - center.x) ** 2 + (z - center.z) ** 2
    return center.y - math.sqrt(max(0.000001, EYE_RADIUS * EYE_RADIUS - distance_squared)) - 0.0006


def build_eyelid(
    side_name: str,
    semantic_target: str,
    center: Vector,
    source: bpy.types.Object,
    armature: bpy.types.Object,
    bvh: BVHTree,
    material: bpy.types.Material,
) -> tuple[bpy.types.Object, float]:
    segments = 20
    vertices: list[Vector] = []
    meta: list[tuple[str, float, bool]] = []
    faces: list[tuple[int, int, int, int]] = []
    # Upper and lower annular ribbons are kept in one skinned object.  Their
    # inner edges meet to a 0.4mm gap in the blink target.
    for lid_name, sign in (("upper", 1), ("lower", -1)):
        start = len(vertices)
        for index in range(segments + 1):
            t = -1.0 + 2.0 * index / segments
            arch = math.sqrt(max(0.0, 1.0 - t * t))
            x_inner = center.x + EYE_APERTURE_X * t
            z_inner = center.z + sign * EYE_APERTURE_Z * arch
            x_outer = center.x + (EYE_APERTURE_X + 0.0008) * t
            z_outer = z_inner + sign * 0.0012
            inner_source_y, _ = ray_y(bvh, x_inner, z_inner, center.y)
            outer_source_y, _ = ray_y(bvh, x_outer, z_outer, center.y)
            inner_y = min(inner_source_y, eye_surface_y(center, x_inner, z_inner)) - 0.0010
            outer_y = min(outer_source_y, eye_surface_y(center, x_outer, z_outer)) - 0.0010
            vertices.append(Vector((x_inner, inner_y, z_inner)))
            meta.append((lid_name, t, True))
            vertices.append(Vector((x_outer, outer_y, z_outer)))
            meta.append((lid_name, t, False))
        for index in range(segments):
            a = start + index * 2
            faces.append((a, a + 2, a + 3, a + 1))
    obj = create_mesh_object(f"MrFeast_Eyelid_{side_name}", vertices, faces, source, armature, [material])
    add_face_projection_uv(obj)
    obj.shape_key_add(name="Basis")
    key = obj.shape_key_add(name=semantic_target)
    key.interpolation = "KEY_LINEAR"
    for index, (lid_name, t, inner) in enumerate(meta):
        arch = max(0.0, 1.0 - t * t)
        meeting = center.z + 0.0003 * arch
        base_world = obj.matrix_world @ key.data[index].co
        # The inner rims meet; the outer rims stay at the socket boundary so
        # each ribbon becomes a true skin flap covering half the eye.
        target_z = meeting + (-0.0002 if lid_name == "upper" else 0.0002) if inner else base_world.z
        target_y = center.y - EYE_RADIUS - 0.0015
        add_world_delta(obj, key, index, Vector((0, target_y - base_world.y, target_z - base_world.z)))
    return obj, 0.4


def build_lip_rim(
    source: bpy.types.Object,
    armature: bpy.types.Object,
    bvh: BVHTree,
    material: bpy.types.Material,
) -> bpy.types.Object:
    """Cover the grid-cut mouth edge with a smooth, source-textured rim."""
    segments = 48
    vertices: list[Vector] = []
    metadata: list[tuple[str, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for lip_name, sign in (("upper", 1), ("lower", -1)):
        start = len(vertices)
        for index in range(segments + 1):
            t = -1.0 + 2.0 * index / segments
            arch = math.sqrt(max(0.0, 1.0 - t * t))
            x_inner = MOUTH_CENTER.x + 0.0385 * t
            z_inner = MOUTH_CENTER.z + sign * 0.0016 * arch
            x_outer = MOUTH_CENTER.x + 0.0415 * t
            z_outer = MOUTH_CENTER.z + sign * (0.0040 * arch + 0.0005)
            for x, z in ((x_inner, z_inner), (x_outer, z_outer)):
                surface_y, _ = ray_y(bvh, x, z, MOUTH_CENTER.y)
                vertices.append(Vector((x, surface_y - 0.0018, z)))
                metadata.append((lip_name, t))
        for index in range(segments):
            a = start + index * 2
            faces.append((a, a + 2, a + 3, a + 1))

    obj = create_mesh_object("MrFeast_LipRim", vertices, faces, source, armature, [material])
    add_face_projection_uv(obj)
    obj.shape_key_add(name="Basis")
    keys = {
        name: obj.shape_key_add(name=name)
        for name in ("smile", "smile_wide", "sneer_left", "sneer_right", "mouth_open", "jaw_shift")
    }
    for index, (lip_name, t) in enumerate(metadata):
        side = 1 if t >= 0 else -1
        corner = abs(t) ** 2.4
        add_world_delta(obj, keys["smile"], index, Vector((side * 0.0060 * corner, -0.0010 * corner, 0.0055 * corner)))
        add_world_delta(obj, keys["smile_wide"], index, Vector((side * 0.0120 * corner, -0.0020 * corner, 0.0100 * corner)))
        if t >= 0:
            add_world_delta(obj, keys["sneer_left"], index, Vector((0.0020 * t, -0.0010 * t, 0.0080 * t)))
        if t <= 0:
            amount = -t
            add_world_delta(obj, keys["sneer_right"], index, Vector((-0.0020 * amount, -0.0010 * amount, 0.0080 * amount)))
        if lip_name == "lower":
            add_world_delta(obj, keys["mouth_open"], index, Vector((0, 0.0010, -0.0140)))
            add_world_delta(obj, keys["jaw_shift"], index, Vector((0.0080, 0, -0.0010)))
        else:
            add_world_delta(obj, keys["mouth_open"], index, Vector((0, -0.0005, 0.0015)))
    return obj


def ellipse_disk(center: Vector, radius_x: float, radius_z: float, segments: int = 32) -> tuple[list[Vector], list[tuple[int, int, int]]]:
    vertices = [center]
    for index in range(segments):
        theta = 2 * math.pi * index / segments
        vertices.append(center + Vector((radius_x * math.cos(theta), 0, radius_z * math.sin(theta))))
    faces = [(0, 1 + index, 1 + (index + 1) % segments) for index in range(segments)]
    return vertices, faces


def build_mouth(
    source: bpy.types.Object,
    armature: bpy.types.Object,
    cavity_material: bpy.types.Material,
    teeth_material: bpy.types.Material,
) -> tuple[bpy.types.Object, bpy.types.Object, float]:
    cavity_center = Vector((MOUTH_CENTER.x, -0.070, MOUTH_CENTER.z))
    # The cavity is full-height behind the neutral slit.  The face aperture is
    # the mask: opening the lower lip boundary reveals this static interior
    # without adding a fourth morph mesh.
    cavity_vertices, cavity_faces = ellipse_disk(cavity_center, 0.040, 0.016)
    cavity = create_mesh_object("MrFeast_OralCavity", cavity_vertices, cavity_faces, source, armature, [cavity_material])

    # Twelve restrained tooth blocks, six upper and six lower, joined into one
    # skinned mesh so the GLB has a stable named teeth node.
    tooth_vertices: list[Vector] = []
    tooth_faces: list[tuple[int, int, int, int]] = []
    tooth_meta: list[str] = []
    for row_name, z_sign in (("upper", 1), ("lower", -1)):
        for tooth in range(6):
            x = MOUTH_CENTER.x + (tooth - 2.5) * 0.0067
            z = MOUTH_CENTER.z + z_sign * 0.0040
            y = -0.073
            half_x, half_y, half_z = 0.0027, 0.0010, 0.0018
            start = len(tooth_vertices)
            tooth_vertices.extend([
                Vector((x - half_x, y - half_y, z - half_z)), Vector((x + half_x, y - half_y, z - half_z)),
                Vector((x + half_x, y - half_y, z + half_z)), Vector((x - half_x, y - half_y, z + half_z)),
                Vector((x - half_x, y + half_y, z - half_z)), Vector((x + half_x, y + half_y, z - half_z)),
                Vector((x + half_x, y + half_y, z + half_z)), Vector((x - half_x, y + half_y, z + half_z)),
            ])
            tooth_faces.extend([
                (start, start + 1, start + 2, start + 3), (start + 4, start + 7, start + 6, start + 5),
                (start, start + 4, start + 5, start + 1), (start + 1, start + 5, start + 6, start + 2),
                (start + 2, start + 6, start + 7, start + 3), (start + 4, start, start + 3, start + 7),
            ])
            tooth_meta.extend([row_name] * 8)
    teeth = create_mesh_object("MrFeast_Teeth", tooth_vertices, tooth_faces, source, armature, [teeth_material])
    return cavity, teeth, 18.0


def remove_obscured_source_faces(source: bpy.types.Object, bvh: BVHTree) -> int:
    mesh = source.data
    normal_matrix = source.matrix_world.to_3x3()
    candidates: list[int] = []
    for polygon in mesh.polygons:
        center = source.matrix_world @ polygon.center
        radius = ((center.x - FACE_CENTER_X) / 0.068) ** 2 + ((center.z - FACE_CENTER_Z) / 0.099) ** 2
        if radius > 1.0 or center.y >= -0.035:
            continue
        normal = (normal_matrix @ polygon.normal).normalized()
        if normal.y >= -0.10:
            continue
        _y, first_hit = ray_y(bvh, center.x, center.z)
        if first_hit == polygon.index:
            candidates.append(polygon.index)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bm.faces.index_update()
    doomed = [bm.faces[index] for index in candidates if index < len(bm.faces)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    loose_vertices = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose_vertices:
        bmesh.ops.delete(bm, geom=loose_vertices, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return len(candidates)


def triangle_count(objects: list[bpy.types.Object]) -> int:
    total = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        evaluated_mesh.calc_loop_triangles()
        total += len(evaluated_mesh.loop_triangles)
        evaluated.to_mesh_clear()
    return total


def connected_components(mesh: bpy.types.Mesh) -> int:
    adjacency: dict[int, set[int]] = defaultdict(set)
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacency[a].add(b)
        adjacency[b].add(a)
    unseen = set(range(len(mesh.vertices)))
    components = 0
    while unseen:
        components += 1
        stack = [unseen.pop()]
        while stack:
            index = stack.pop()
            for neighbor in adjacency[index]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    stack.append(neighbor)
    return components


def aggregate_target_stats(objects: list[bpy.types.Object]) -> dict[str, dict[str, float | int]]:
    stats = {name: {"changedVertices": 0, "maxDeltaMillimeters": 0.0} for name in TARGETS}
    for obj in objects:
        shape_keys = obj.data.shape_keys if obj.type == "MESH" else None
        if not shape_keys or "Basis" not in shape_keys.key_blocks:
            continue
        basis = shape_keys.key_blocks["Basis"]
        world_scale = obj.matrix_world.to_3x3()
        for name in TARGETS:
            key = shape_keys.key_blocks.get(name)
            if key is None:
                continue
            for index in range(len(key.data)):
                delta = world_scale @ (key.data[index].co - basis.data[index].co)
                if delta.length <= 1e-7:
                    continue
                stats[name]["changedVertices"] += 1
                stats[name]["maxDeltaMillimeters"] = max(stats[name]["maxDeltaMillimeters"], delta.length * 1000)
    for values in stats.values():
        values["maxDeltaMillimeters"] = round(float(values["maxDeltaMillimeters"]), 3)
    return stats


def select_for_export(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    armature = next((obj for obj in objects if obj.type == "ARMATURE"), objects[0])
    bpy.context.view_layer.objects.active = armature


def export_glb(path: Path, objects: list[bpy.types.Object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    select_for_export(objects)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
    )


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_previews(objects: list[bpy.types.Object], preview_dir: Path) -> list[str]:
    preview_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = scene.world or bpy.data.worlds.new("MrFeastRetopoPreviewWorld")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.004, 0.006, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.16

    camera_data = bpy.data.cameras.new("MrFeastRetopoPreviewCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 0.40
    camera = bpy.data.objects.new("MrFeastRetopoPreviewCamera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = Vector((0.0, -2.5, 1.76))
    look_at(camera, Vector((FACE_CENTER_X, -0.08, 1.76)))
    scene.camera = camera

    light_specs = (
        ("RetopoKey", (-0.75, -1.0, 2.20), 420.0, 1.1, (1.0, 0.78, 0.62)),
        ("RetopoFill", (0.80, -0.80, 1.80), 170.0, 1.0, (0.56, 0.68, 1.0)),
        ("RetopoRim", (0.10, 0.50, 2.10), 300.0, 0.8, (0.48, 0.58, 1.0)),
    )
    for name, location, energy, size, color in light_specs:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.location = Vector(location)
        look_at(light, Vector((FACE_CENTER_X, -0.06, 1.76)))

    poses = {
        "neutral": {},
        "blink-left": {"blink_left": 1.0},
        "blink-both": {"blink_left": 1.0, "blink_right": 1.0},
        "mouth-open": {"mouth_open": 1.0},
        "friendly": {"smile": 0.65, "brow_raise": 0.25},
        "threatened": {"smile_wide": 0.95, "brow_compress": 0.80, "sneer_left": 0.55, "mouth_open": 0.45, "jaw_shift": 0.30},
    }
    rendered: list[str] = []
    for pose_name, values in poses.items():
        for obj in objects:
            if obj.type != "MESH" or not obj.data.shape_keys:
                continue
            for key in obj.data.shape_keys.key_blocks:
                if key.name != "Basis":
                    key.value = values.get(key.name, 0.0)
        scene.render.filepath = str(preview_dir / f"mr-feast-retopo-{pose_name}.png")
        bpy.ops.render.render(write_still=True)
        rendered.append(scene.render.filepath)
    for obj in objects:
        if obj.type == "MESH" and obj.data.shape_keys:
            for key in obj.data.shape_keys.key_blocks:
                if key.name != "Basis":
                    key.value = 0.0
    return rendered


def main() -> None:
    args = parse_args()
    input_blend = args.input_blend.expanduser().resolve()
    output = args.output.expanduser().resolve()
    report_path = args.report.expanduser().resolve()
    preview_dir = args.preview_dir.expanduser().resolve() if args.preview_dir else None
    if not input_blend.is_file():
        raise FileNotFoundError(f"Working blend not found: {input_blend}")
    ensure_safe([output, report_path], args.force)

    bpy.ops.wm.open_mainfile(filepath=str(input_blend))
    source_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and exportable(obj)]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE" and exportable(obj)]
    if len(source_meshes) != 1 or len(armatures) != 1:
        raise RuntimeError(f"Expected one source mesh and one armature, found {len(source_meshes)} and {len(armatures)}")
    source = source_meshes[0]
    armature = armatures[0]
    if source.data.shape_keys:
        raise RuntimeError("Retopology must start from the shape-key-free working blend")
    source_triangles_before = triangle_count([source])
    bvh, _vertices, _triangles = mesh_bvh(source)

    skin = make_material("MrFeast_Retopo_Skin", (0.39, 0.205, 0.135, 1), 0.66)
    beard = make_material("MrFeast_Retopo_Beard", (0.018, 0.010, 0.008, 1), 0.80)
    eye_white = make_material("MrFeast_Eye_White", (0.20, 0.155, 0.105, 1), 0.48)
    iris = make_material("MrFeast_Eye_Iris", (0.025, 0.008, 0.004, 1), 0.52)
    pupil = make_material("MrFeast_Eye_Pupil", (0.002, 0.001, 0.001, 1), 0.38)
    cavity_material = make_material("MrFeast_Oral_Cavity", (0.028, 0.0025, 0.0035, 1), 0.88)
    teeth_material = make_material("MrFeast_Teeth_Ivory", (0.60, 0.50, 0.34, 1), 0.55)

    face, face_samples = build_face_surface(source, armature, bvh, skin, beard)
    author_face_shapes(face, face_samples)
    albedo_baked, albedo_bake_error, albedo_bake_stats = bake_face_albedo(source, face)
    if not albedo_baked:
        raise RuntimeError(f"Unified face albedo bake failed validation: {albedo_bake_error}")
    generated: list[bpy.types.Object] = [face]
    generated.extend(build_eyes(source, armature, eye_white, iris, pupil))
    face_material = face.data.materials[0]
    lid_left, left_gap = build_eyelid("L", "blink_left", EYES["left"]["center"], source, armature, bvh, face_material)
    lid_right, right_gap = build_eyelid("R", "blink_right", EYES["right"]["center"], source, armature, bvh, face_material)
    generated.extend([lid_left, lid_right])
    generated.append(build_lip_rim(source, armature, bvh, face_material))
    cavity, teeth, mouth_gap = build_mouth(source, armature, cavity_material, teeth_material)
    generated.extend([cavity, teeth])

    removed_triangles = remove_obscured_source_faces(source, bvh)
    bpy.context.view_layer.update()
    export_objects = [obj for obj in bpy.context.scene.objects if exportable(obj) and obj.type in {"MESH", "ARMATURE"}]
    target_stats = aggregate_target_stats(generated)
    missing = [name for name, values in target_stats.items() if values["changedVertices"] <= 0]
    if missing:
        raise RuntimeError("Empty retopology morph targets: " + ", ".join(missing))
    morph_meshes = sum(1 for obj in generated if obj.type == "MESH" and obj.data.shape_keys)
    morph_bindings = sum(
        max(0, len(obj.data.shape_keys.key_blocks) - 1)
        for obj in generated
        if obj.type == "MESH" and obj.data.shape_keys
    )

    export_glb(output, export_objects)
    previews = render_previews(generated, preview_dir) if preview_dir else []
    face.data.calc_loop_triangles()
    asset_triangles = triangle_count([obj for obj in export_objects if obj.type == "MESH"])
    skinned_meshes = sum(
        1 for obj in export_objects if obj.type == "MESH" and any(mod.type == "ARMATURE" for mod in obj.modifiers)
    )
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pipelineVersion": PIPELINE_VERSION,
        "pipeline": "deterministic-bmesh-parametric-face-appliance",
        "input": str(input_blend),
        "output": str(output),
        "face": {
            "object": face.name,
            "components": connected_components(face.data),
            "vertices": len(face.data.vertices),
            "triangles": len(face.data.loop_triangles),
            "grid": [FACE_GRID, FACE_GRID],
            "perimeterTuckMillimeters": PERIMETER_TUCK * 1000,
        },
        "parts": {
            "eyes": ["MrFeast_Eye_L", "MrFeast_Eye_R"],
            "eyelids": ["MrFeast_Eyelid_L", "MrFeast_Eyelid_R"],
            "oralCavity": "MrFeast_OralCavity",
            "teeth": "MrFeast_Teeth",
            "lipRim": "MrFeast_LipRim",
        },
        "albedoBake": {
            "completed": albedo_baked,
            "size": [1024, 1024],
            "image": "MrFeast_RetopoFace_Albedo",
            "error": albedo_bake_error,
            "pixelStats": albedo_bake_stats,
        },
        "source": {
            "trianglesBefore": source_triangles_before,
            "visibleFrontTrianglesRemoved": removed_triangles,
            "preservationPolicy": "first-ray-visible inner mask; original hair, ears, back head, neck, body, and wardrobe retained",
        },
        "rig": {
            "bones": len(armature.data.bones),
            "skinnedMeshes": skinned_meshes,
            "policy": "existing Head/neck groups only; no new bones",
            "meshParenting": "scene-root skinned meshes; Armature modifier only; avoids double 0.01 normalization in Three.js",
        },
        "asset": {
            "triangles": asset_triangles,
            "sizeBytes": output.stat().st_size,
        },
        "targets": list(TARGETS),
        "targetStats": target_stats,
        "morphMeshes": morph_meshes,
        "morphBindings": morph_bindings,
        "blinkClosureGapMillimeters": {"left": left_gap, "right": right_gap},
        "mouthOpenGapMillimeters": mouth_gap,
        "morphNormalExported": False,
        "previews": previews,
        "limitations": [
            "The unified 1024 face bake preserves source color, but a manual texture-paint cleanup may still improve the aperture borders.",
            "The connected appliance uses a dense compacted quad grid rather than manual cinematic production topology.",
            "Eye gaze controls remain object-level and are not yet driven by the mansion runtime.",
        ],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
