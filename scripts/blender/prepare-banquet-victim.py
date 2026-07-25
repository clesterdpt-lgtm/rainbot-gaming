#!/usr/bin/env python3
"""Prepare the Meshy Contestant 13 victim as two static banquet props.

Run through Blender 4.5:

    blender --background --factory-startup \
      --python scripts/blender/prepare-banquet-victim.py -- \
      --input assets/models/mr-feast/source/banquet/contestant-13-victim-source-v2-rigged.glb \
      --output-dir assets/models/mr-feast/banquet \
      --manifest assets/models/mr-feast/banquet/manifest.json \
      --force

The selected clean Meshy image-to-3D rig is baked into:

* a face-up, head-+X torso retaining the source's original boxer briefs and
  bare-torso PBR atlas, with four sealed bandage caps at the shoulder and hip
  sockets; and
* four detached limbs arranged as one compact, platter-ready static pile.

The runtime GLBs deliberately use Blender's standard uncompressed glTF export
without skins, animations, Draco, Meshopt, cameras, or lights so Three.js r128
can load them without extension decoders.
"""

from __future__ import annotations

import argparse
import bmesh
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import bpy
from mathutils import Matrix, Vector


TORSO_FILE = "contestant-13-limbless-torso.glb"
LIMBS_FILE = "contestant-13-detached-limbs.glb"
SOURCE_SLUG = "contestant-13-victim-source-v2"
HIP_CUT_HEIGHT = 0.72
SHOULDER_CUT_LATERAL = 0.18
TORSO_MAX_RUNTIME_BOUNDS = Vector((0.95, 0.30, 0.58))
LIMBS_MAX_RUNTIME_BOUNDS = Vector((1.30, 0.28, 0.76))
ARM_GROUPS = {
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
}
LEFT_ARM_GROUPS = {"LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"}
RIGHT_ARM_GROUPS = {"RightShoulder", "RightArm", "RightForeArm", "RightHand"}
LEFT_LEG_GROUPS = {
    "LeftUpLeg",
    "LeftLeg",
    "LeftFoot",
    "LeftToeBase",
}
RIGHT_LEG_GROUPS = {
    "RightUpLeg",
    "RightLeg",
    "RightFoot",
    "RightToeBase",
}
LEG_GROUPS = LEFT_LEG_GROUPS | RIGHT_LEG_GROUPS


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--texture-size", type=int, default=512)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


def reset_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.actions,
        bpy.data.armatures,
        bpy.data.cameras,
        bpy.data.curves,
        bpy.data.images,
        bpy.data.lights,
        bpy.data.meshes,
        bpy.data.materials,
    ):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def vector_list(value: Vector) -> list[float]:
    return [round(float(component), 6) for component in value]


def runtime_to_blender(value: Vector) -> Vector:
    """Map authored runtime XYZ into Blender before Y-up glTF export.

    Blender's glTF exporter maps Blender ``(x, y, z)`` to runtime
    ``(x, z, -y)``. Keeping this inverse in one place makes the requested
    head-+X / face-up-+Y / lateral-+Z orientation explicit.
    """

    return Vector((value.x, -value.z, value.y))


def blender_to_runtime(value: Vector) -> Vector:
    return Vector((value.x, value.z, -value.y))


def source_world_to_runtime(value: Vector, *, depth_scale: float) -> Vector:
    # Meshy is upright in Blender: source +Z is headward and source -Y is
    # facial/front. The banquet prop lies face-up in runtime space.
    return Vector((
        value.z - HIP_CUT_HEIGHT,
        -value.y * depth_scale,
        value.x,
    ))


def triangle_count(objects: list[bpy.types.Object]) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            total += len(mesh.loop_triangles)
        finally:
            evaluated.to_mesh_clear()
    return total


def runtime_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    bpy.context.view_layer.update()
    points = [
        blender_to_runtime(obj.matrix_world @ vertex.co)
        for obj in objects
        if obj.type == "MESH"
        for vertex in obj.data.vertices
    ]
    if not points:
        raise RuntimeError("No runtime mesh bounds were available")
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def bounds_payload(objects: list[bpy.types.Object]) -> dict[str, list[float]]:
    minimum, maximum = runtime_bounds(objects)
    return {
        "min": vector_list(minimum),
        "max": vector_list(maximum),
        "size": vector_list(maximum - minimum),
    }


def vertex_weights(source: bpy.types.Object) -> list[dict[str, float]]:
    group_names = {
        group.index: group.name
        for group in source.vertex_groups
    }
    payload: list[dict[str, float]] = []
    for vertex in source.data.vertices:
        payload.append({
            group_names[influence.group]: float(influence.weight)
            for influence in vertex.groups
            if influence.group in group_names
        })
    return payload


def group_score(
    weights: list[dict[str, float]],
    vertex_indices: list[int],
    names: set[str],
) -> float:
    if not vertex_indices:
        return 0.0
    return sum(
        sum(weights[index].get(name, 0.0) for name in names)
        for index in vertex_indices
    ) / len(vertex_indices)


def base_color_image(source: bpy.types.Object) -> bpy.types.Image | None:
    for material in source.data.materials:
        if not material or not material.use_nodes or not material.node_tree:
            continue
        principled = next(
            (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
            None,
        )
        if not principled:
            continue
        base_color = principled.inputs.get("Base Color")
        if not base_color:
            continue
        for link in base_color.links:
            if link.from_node.type == "TEX_IMAGE" and link.from_node.image:
                return link.from_node.image
    return None


def face_centroid_world(
    source: bpy.types.Object,
    polygon: bpy.types.MeshPolygon,
) -> Vector:
    points = [source.matrix_world @ source.data.vertices[index].co for index in polygon.vertices]
    return sum(points, Vector()) / len(points)


def face_points_world(
    source: bpy.types.Object,
    polygon: bpy.types.MeshPolygon,
) -> list[Vector]:
    return [
        source.matrix_world @ source.data.vertices[index].co
        for index in polygon.vertices
    ]


def select_torso_faces(
    source: bpy.types.Object,
    weights: list[dict[str, float]],
) -> set[int]:
    selected: set[int] = set()
    for polygon in source.data.polygons:
        indices = list(polygon.vertices)
        points = face_points_world(source, polygon)
        arm_score = group_score(weights, indices, ARM_GROUPS)
        # Reject every face crossing a surgical plane. This deliberately leaves
        # the source surface just inside the procedural cloth cap instead of
        # allowing long triangle tips to protrude through it.
        if sum(point.z for point in points) / len(points) < HIP_CUT_HEIGHT - 0.045:
            continue
        # The first-person camera is the victim's viewpoint. Export only the
        # compact chest-to-hips body proxy, never a duplicate head/hair/neck.
        if sum(point.z for point in points) / len(points) >= 1.535 + 0.045:
            continue
        if (
            max(abs(point.x) for point in points) > SHOULDER_CUT_LATERAL
            and arm_score > 0.10
        ):
            continue
        selected.add(polygon.index)
    return selected


def select_limb_faces(
    source: bpy.types.Object,
    weights: list[dict[str, float]],
    *,
    side: float,
    family: set[str],
    other_family: set[str],
    kind: str,
) -> set[int]:
    selected: set[int] = set()
    for polygon in source.data.polygons:
        indices = list(polygon.vertices)
        points = face_points_world(source, polygon)
        centroid = face_centroid_world(source, polygon)
        family_score = group_score(weights, indices, family)
        other_score = group_score(weights, indices, other_family)
        hips_score = group_score(weights, indices, {"Hips"})
        if side * centroid.x <= -0.015:
            continue
        if kind == "arm":
            if (
                sum(side * point.x for point in points) / len(points)
                < SHOULDER_CUT_LATERAL - 0.045
            ):
                continue
            if family_score < 0.14 or family_score < other_score:
                continue
        else:
            if (
                sum(point.z for point in points) / len(points)
                > HIP_CUT_HEIGHT + 0.045
            ):
                continue
            if family_score < 0.22 or family_score < other_score:
                continue
            if family_score < hips_score * 0.9:
                continue
        selected.add(polygon.index)
    return selected


def extract_faces(
    source: bpy.types.Object,
    selected_faces: set[int],
    name: str,
) -> bpy.types.Object:
    if not selected_faces:
        raise RuntimeError(f"No source faces selected for {name}")
    selected_polygons = [
        polygon
        for polygon in source.data.polygons
        if polygon.index in selected_faces
    ]
    source_vertex_indices = sorted({
        vertex_index
        for polygon in selected_polygons
        for vertex_index in polygon.vertices
    })
    remap = {
        source_index: output_index
        for output_index, source_index in enumerate(source_vertex_indices)
    }
    mesh = bpy.data.meshes.new(f"{name}_Geometry")
    mesh.from_pydata(
        [
            source.data.vertices[source_index].co.copy()
            for source_index in source_vertex_indices
        ],
        [],
        [
            [remap[source_index] for source_index in polygon.vertices]
            for polygon in selected_polygons
        ],
    )
    for material in source.data.materials:
        mesh.materials.append(material)
    for output_polygon, source_polygon in zip(mesh.polygons, selected_polygons):
        output_polygon.material_index = source_polygon.material_index
        output_polygon.use_smooth = source_polygon.use_smooth
    for source_uv_layer in source.data.uv_layers:
        output_uv_layer = mesh.uv_layers.new(name=source_uv_layer.name)
        for output_polygon, source_polygon in zip(mesh.polygons, selected_polygons):
            for output_loop, source_loop in zip(
                output_polygon.loop_indices,
                source_polygon.loop_indices,
            ):
                output_uv_layer.data[output_loop].uv = (
                    source_uv_layer.data[source_loop].uv.copy()
                )
    extracted = source.copy()
    extracted.data = mesh
    extracted.name = name
    bpy.context.collection.objects.link(extracted)
    source_group_names = {
        group.index: group.name
        for group in source.vertex_groups
    }
    output_groups = {
        group.name: group
        for group in extracted.vertex_groups
    }
    for output_index, source_index in enumerate(source_vertex_indices):
        for influence in source.data.vertices[source_index].groups:
            group_name = source_group_names.get(influence.group)
            if group_name and group_name in output_groups:
                output_groups[group_name].add(
                    [output_index],
                    float(influence.weight),
                    "REPLACE",
                )
    extracted.data.update()
    return extracted


def bake_static_mesh(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        if modifier.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    world_matrix = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world_matrix
    for vertex in obj.data.vertices:
        vertex.co = obj.matrix_world @ vertex.co
    obj.matrix_world = Matrix.Identity(4)
    obj.animation_data_clear()
    obj.vertex_groups.clear()
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.update()


def hard_clip_mesh(
    obj: bpy.types.Object,
    *,
    plane_point: Vector,
    keep_normal: Vector,
) -> None:
    """Bisect a baked source mesh and retain the side pointed to by the normal."""

    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.bisect_plane(
        bm,
        geom=[*bm.verts, *bm.edges, *bm.faces],
        dist=0.00001,
        plane_co=plane_point,
        plane_no=keep_normal.normalized(),
        clear_inner=True,
        clear_outer=False,
        use_snap_center=False,
    )
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def transform_vertices(
    obj: bpy.types.Object,
    transform: Callable[[Vector], Vector],
) -> None:
    for vertex in obj.data.vertices:
        vertex.co = runtime_to_blender(transform(vertex.co.copy()))
    obj.data.update()


def object_runtime_vertices(obj: bpy.types.Object) -> list[Vector]:
    return [
        blender_to_runtime(obj.matrix_world @ vertex.co)
        for vertex in obj.data.vertices
    ]


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float,
    roughness: float,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name=name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Metallic"].default_value = metallic
        principled.inputs["Roughness"].default_value = roughness
    return material


def add_runtime_rounded_cap(
    name: str,
    endpoint: Vector,
    normal: Vector,
    radius: float,
    depth: float,
    material: bpy.types.Material,
) -> bpy.types.Object:
    """Add a short rounded cloth sleeve ending at ``endpoint``.

    ``normal`` points away from the retained body part. The cap's flat outer
    face is therefore the absolute surgical endpoint, while the rest of its
    depth overlaps the source mesh and hides the open triangle boundary.
    """

    normal = normal.normalized()
    reference = Vector((0, 1, 0)) if abs(normal.y) < 0.85 else Vector((0, 0, 1))
    tangent = reference.cross(normal).normalized()
    bitangent = normal.cross(tangent).normalized()
    center = endpoint - normal * depth * 0.5
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=32,
        radius=radius,
        depth=depth,
        end_fill_type="NGON",
        location=(0, 0, 0),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}_Geometry"
    for vertex in obj.data.vertices:
        runtime = (
            center
            + tangent * vertex.co.x
            + bitangent * vertex.co.y
            + normal * vertex.co.z
        )
        vertex.co = runtime_to_blender(runtime)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.materials.append(material)
    obj.data.update()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bevel = obj.modifiers.new(name="Rounded_Cloth_Edges", type="BEVEL")
    bevel.width = min(0.008, depth * 0.16)
    bevel.segments = 3
    bevel.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj


def make_torso_dressing() -> tuple[list[bpy.types.Object], list[bpy.types.Object]]:
    bandage = make_material(
        "Banquet_Victim_Bandage_Ivory",
        (0.40, 0.35, 0.27, 1.0),
        metallic=0.0,
        roughness=0.88,
    )
    dressing: list[bpy.types.Object] = []
    caps = [
        add_runtime_rounded_cap(
            "Banquet_Victim_Left_Shoulder_Bandage_Cap",
            Vector((0.68, 0.0, 0.205)),
            Vector((0, 0, 1)),
            0.105,
            0.075,
            bandage,
        ),
        add_runtime_rounded_cap(
            "Banquet_Victim_Right_Shoulder_Bandage_Cap",
            Vector((0.68, 0.0, -0.205)),
            Vector((0, 0, -1)),
            0.105,
            0.075,
            bandage,
        ),
        add_runtime_rounded_cap(
            "Banquet_Victim_Left_Hip_Bandage_Cap",
            Vector((-0.015, 0.0, 0.085)),
            Vector((-1, 0, 0)),
            0.120,
            0.080,
            bandage,
        ),
        add_runtime_rounded_cap(
            "Banquet_Victim_Right_Hip_Bandage_Cap",
            Vector((-0.015, 0.0, -0.085)),
            Vector((-1, 0, 0)),
            0.120,
            0.080,
            bandage,
        ),
    ]
    return dressing, caps


def fit_runtime_bounds(
    objects: list[bpy.types.Object],
    maximum_size: Vector,
    *,
    center_lateral: bool = True,
) -> Vector:
    minimum, maximum = runtime_bounds(objects)
    size = maximum - minimum
    scales = Vector(tuple(
        min(1.0, maximum_size[axis] / size[axis])
        if size[axis] > 0
        else 1.0
        for axis in range(3)
    ))
    longitudinal_center = (minimum.x + maximum.x) * 0.5
    lateral_center = (minimum.z + maximum.z) * 0.5
    for obj in objects:
        for vertex in obj.data.vertices:
            runtime = blender_to_runtime(vertex.co)
            runtime.x = (runtime.x - longitudinal_center) * scales.x
            runtime.y = (runtime.y - minimum.y) * scales.y
            if center_lateral:
                runtime.z = (runtime.z - lateral_center) * scales.z
            else:
                runtime.z = (runtime.z - minimum.z) * scales.z
            vertex.co = runtime_to_blender(runtime)
        obj.data.update()
    return scales


def arrange_limb_group(
    objects: list[bpy.types.Object],
    *,
    angle: float,
    center_x: float,
    center_z: float,
    layer_y: float,
) -> None:
    points = [
        point
        for obj in objects
        for point in object_runtime_vertices(obj)
    ]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    center = (minimum + maximum) * 0.5
    cosine = math.cos(angle)
    sine = math.sin(angle)
    transformed_by_object: list[list[Vector]] = []
    for obj in objects:
        transformed: list[Vector] = []
        for point in object_runtime_vertices(obj):
            local = point - center
            transformed.append(Vector((
                cosine * local.x + sine * local.z,
                local.y,
                -sine * local.x + cosine * local.z,
            )))
        transformed_by_object.append(transformed)
    minimum_y = min(
        point.y
        for transformed in transformed_by_object
        for point in transformed
    )
    for obj, transformed in zip(objects, transformed_by_object):
        for vertex, point in zip(obj.data.vertices, transformed):
            point += Vector((center_x, layer_y - minimum_y, center_z))
            vertex.co = runtime_to_blender(point)
        obj.data.update()


def resize_and_pack_images(max_size: int) -> list[dict[str, int | str]]:
    images: list[dict[str, int | str]] = []
    for image in bpy.data.images:
        if image.type not in {"IMAGE", "UV_TEST"}:
            continue
        width, height = int(image.size[0]), int(image.size[1])
        if width <= 0 or height <= 0:
            continue
        largest = max(width, height)
        if largest > max_size:
            if not image.has_data:
                try:
                    _ = image.pixels[0]
                except (IndexError, RuntimeError):
                    pass
            scale = max_size / largest
            image.scale(max(1, round(width * scale)), max(1, round(height * scale)))
            image.update()
        try:
            image.pack()
        except RuntimeError:
            pass
        images.append({
            "name": image.name,
            "width": int(image.size[0]),
            "height": int(image.size[1]),
        })
    return images


def polish_source_materials(
    objects: list[bpy.types.Object],
) -> list[str]:
    materials = sorted(
        {
            material
            for obj in objects
            if obj.type == "MESH"
            for material in obj.data.materials
            if material
        },
        key=lambda material: material.name,
    )
    for index, material in enumerate(materials, start=1):
        if material.name.startswith("Banquet_Victim_"):
            continue
        material.name = f"Banquet_Victim_Source_PBR_{index:02d}"
        material.blend_method = "OPAQUE"
        material.use_backface_culling = False
        if not material.use_nodes or not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            roughness = node.inputs.get("Roughness")
            metallic = node.inputs.get("Metallic")
            emission = node.inputs.get("Emission Strength")
            if roughness and not roughness.is_linked:
                roughness.default_value = max(float(roughness.default_value), 0.52)
            if metallic and not metallic.is_linked:
                metallic.default_value = min(float(metallic.default_value), 0.2)
            if emission:
                emission.default_value = 0.0
    return [
        material.name
        for material in materials
        if material.name.startswith("Banquet_Victim_Source_PBR_")
    ]


def select_only(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def export_glb(path: Path, objects: list[bpy.types.Object]) -> None:
    select_only(objects)
    requested = {
        "filepath": str(path),
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_animations": False,
        "export_skins": False,
        "export_morph": False,
        "export_cameras": False,
        "export_lights": False,
        "export_draco_mesh_compression_enable": False,
        "export_use_gltfpack": False,
    }
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    result = bpy.ops.export_scene.gltf(**{
        key: value
        for key, value in requested.items()
        if key in available
    })
    if "FINISHED" not in result:
        raise RuntimeError(f"Failed to export {path.name}")


def collect_mesh_names(objects: list[bpy.types.Object]) -> list[str]:
    return sorted(obj.name for obj in objects if obj.type == "MESH")


def collect_material_names(objects: list[bpy.types.Object]) -> list[str]:
    return sorted({
        material.name
        for obj in objects
        if obj.type == "MESH"
        for material in obj.data.materials
        if material
    })


def meshy_trace(source_dir: Path) -> dict:
    source_meta = load_json(source_dir / f"{SOURCE_SLUG}.meta.json")
    rig_meta = load_json(source_dir / f"{SOURCE_SLUG}-rig.meta.json")
    selected_credits = (
        int(source_meta.get("consumedCredits") or 0)
        + int(rig_meta.get("consumedCredits") or 0)
    )
    rejected_source_meta = load_json(
        source_dir / "contestant-13-victim-source.meta.json"
    )
    rejected_remesh_meta = load_json(
        source_dir / "contestant-13-victim-source-remesh.meta.json"
    )
    rejected_rig_meta = load_json(
        source_dir / "contestant-13-victim-source-rig.meta.json"
    )
    rejected_credits = (
        int(rejected_source_meta["preview"].get("consumedCredits") or 0)
        + int(rejected_source_meta["refine"].get("consumedCredits") or 0)
        + int(rejected_remesh_meta.get("consumedCredits") or 0)
        + int(rejected_rig_meta.get("consumedCredits") or 0)
    )
    return {
        "generationMode": source_meta["type"],
        "generationTaskId": source_meta["id"],
        "rigTaskId": rig_meta["id"],
        "selectedSourceCredits": selected_credits,
        "rejectedAttempt": {
            "generationMode": "text-to-3d",
            "previewTaskId": rejected_source_meta["preview"]["id"],
            "refineTaskId": rejected_source_meta["refine"]["id"],
            "remeshTaskId": rejected_remesh_meta["id"],
            "rigTaskId": rejected_rig_meta["id"],
            "consumedCredits": rejected_credits,
        },
        "consumedCredits": selected_credits + rejected_credits,
    }


def update_manifest(
    manifest_path: Path,
    *,
    torso_report: dict,
    limbs_report: dict,
    trace: dict,
) -> None:
    manifest = load_json(manifest_path)
    credit_strategy = manifest.setdefault("creditStrategy", {})
    credit_strategy["victimSourceGenerations"] = 2
    credit_strategy["victimRuntimeVariants"] = 2
    credit_strategy["victimSelectedSourceCredits"] = int(
        trace["selectedSourceCredits"]
    )
    credit_strategy["victimRejectedAttemptCredits"] = int(
        trace["rejectedAttempt"]["consumedCredits"]
    )
    credit_strategy["estimatedConsumedCredits"] = (
        int(credit_strategy.get("estimatedConsumedCredits") or 0)
        - int(manifest.get("victim", {}).get("meshy", {}).get("consumedCredits") or 0)
        + int(trace["consumedCredits"])
    )
    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    manifest["victim"] = {
        "id": "contestant-13-victim",
        "description": (
            "Face-up headless Contestant 13 body proxy in plain opaque underwear, "
            "with non-graphic sealed sockets and one platter-ready detached-limb pile."
        ),
        "sourceCount": 1,
        "sourceFile": f"source/banquet/{SOURCE_SLUG}-rigged.glb",
        "static": True,
        "riggedSource": True,
        "runtimeSkins": 0,
        "runtimeAnimations": 0,
        "underwear": True,
        "limbCount": 4,
        "sealedSurgicalCaps": 4,
        "explicitGore": False,
        "orientation": {
            "headAxis": "+X",
            "faceUpAxis": "+Y",
            "lateralAxis": "+Z",
        },
        "torso": {
            "runtimeFile": TORSO_FILE,
            "visibleMeshyDerivedCore": True,
            "boundsMeters": torso_report["boundsMeters"]["size"],
            "triangles": torso_report["triangles"],
            "fileBytes": torso_report["fileBytes"],
            "torsoSocketBandageCaps": 4,
            "garmentPolicy": "original Meshy v2 opaque oxblood boxer briefs retained; no added garment shell",
            "blenderReport": Path(torso_report["report"]).name,
        },
        "limbs": {
            "runtimeFile": LIMBS_FILE,
            "visibleMeshyDerivedCore": True,
            "boundsMeters": limbs_report["boundsMeters"]["size"],
            "triangles": limbs_report["triangles"],
            "fileBytes": limbs_report["fileBytes"],
            "pieces": ["left-arm", "right-arm", "left-leg", "right-leg"],
            "arrangement": "compact non-graphic platter pile",
            "proximalBandageCaps": 4,
            "blenderReport": Path(limbs_report["report"]).name,
        },
        "meshy": trace,
    }
    write_json(manifest_path, manifest)


def validate_runtime_bounds(
    label: str,
    payload: dict[str, list[float]],
    maximum: Vector,
) -> None:
    size = Vector(payload["size"])
    for axis, axis_name in enumerate(("X", "Y", "Z")):
        if size[axis] > maximum[axis] + 1e-5:
            raise RuntimeError(
                f"{label} {axis_name} bound {size[axis]:.6f} exceeds {maximum[axis]:.6f}"
            )


def main() -> None:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    torso_path = output_dir / TORSO_FILE
    limbs_path = output_dir / LIMBS_FILE
    torso_report_path = torso_path.with_suffix(".report.json")
    limbs_report_path = limbs_path.with_suffix(".report.json")
    protected = [torso_path, limbs_path, torso_report_path, limbs_report_path]
    if any(path.exists() for path in protected) and not args.force:
        raise FileExistsError("Refusing to replace banquet victim outputs without --force")
    if not input_path.is_file():
        raise FileNotFoundError(f"Input GLB not found: {input_path}")
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Banquet manifest not found: {manifest_path}")
    if args.texture_size < 128:
        raise ValueError("--texture-size must be at least 128")

    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    skinned = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and any(modifier.type == "ARMATURE" for modifier in obj.modifiers)
    ]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(skinned) != 1 or len(armatures) != 1:
        raise RuntimeError(
            f"Expected one skinned mesh and one armature; got {len(skinned)} / {len(armatures)}"
        )
    source = skinned[0]
    source_triangles = triangle_count([source])
    image = base_color_image(source)
    if image and not image.has_data:
        try:
            _ = image.pixels[0]
        except (IndexError, RuntimeError):
            pass
    weights = vertex_weights(source)
    torso_core = extract_faces(
        source,
        select_torso_faces(source, weights),
        "Banquet_Victim_Meshy_Torso_Core",
    )
    limb_specs = (
        (
            "Banquet_Victim_Meshy_Left_Arm_Core",
            1.0,
            LEFT_ARM_GROUPS,
            RIGHT_ARM_GROUPS,
            "arm",
        ),
        (
            "Banquet_Victim_Meshy_Right_Arm_Core",
            -1.0,
            RIGHT_ARM_GROUPS,
            LEFT_ARM_GROUPS,
            "arm",
        ),
        (
            "Banquet_Victim_Meshy_Left_Leg_Core",
            1.0,
            LEFT_LEG_GROUPS,
            RIGHT_LEG_GROUPS,
            "leg",
        ),
        (
            "Banquet_Victim_Meshy_Right_Leg_Core",
            -1.0,
            RIGHT_LEG_GROUPS,
            LEFT_LEG_GROUPS,
            "leg",
        ),
    )
    limb_cores: list[bpy.types.Object] = []
    for name, side, family, other_family, kind in limb_specs:
        limb_cores.append(extract_faces(
            source,
            select_limb_faces(
                source,
                weights,
                side=side,
                family=family,
                other_family=other_family,
                kind=kind,
            ),
            name,
        ))
    for obj in [torso_core, *limb_cores]:
        bake_static_mesh(obj)
    hard_clip_mesh(
        torso_core,
        plane_point=Vector((0, 0, HIP_CUT_HEIGHT)),
        keep_normal=Vector((0, 0, 1)),
    )
    hard_clip_mesh(
        torso_core,
        plane_point=Vector((0, 0, 1.535)),
        keep_normal=Vector((0, 0, -1)),
    )
    hard_clip_mesh(
        limb_cores[0],
        plane_point=Vector((SHOULDER_CUT_LATERAL, 0, 0)),
        keep_normal=Vector((1, 0, 0)),
    )
    hard_clip_mesh(
        limb_cores[1],
        plane_point=Vector((-SHOULDER_CUT_LATERAL, 0, 0)),
        keep_normal=Vector((-1, 0, 0)),
    )
    for leg_core in limb_cores[2:]:
        hard_clip_mesh(
            leg_core,
            plane_point=Vector((0, 0, HIP_CUT_HEIGHT)),
            keep_normal=Vector((0, 0, -1)),
        )
    transform_vertices(
        torso_core,
        lambda point: source_world_to_runtime(point, depth_scale=0.56),
    )
    for obj in limb_cores:
        transform_vertices(
            obj,
            lambda point: source_world_to_runtime(point, depth_scale=0.52),
        )

    dressing, socket_caps = make_torso_dressing()
    bandage_material = bpy.data.materials["Banquet_Victim_Bandage_Ivory"]
    torso_objects = [
        torso_core,
        *dressing,
        *socket_caps,
    ]
    torso_fit_scale = fit_runtime_bounds(
        torso_objects,
        TORSO_MAX_RUNTIME_BOUNDS,
    )

    limb_caps = (
        add_runtime_rounded_cap(
            "Banquet_Victim_Left_Arm_Proximal_Bandage",
            Vector((0.68, 0.0, 0.176)),
            Vector((0, 0, -1)),
            0.088,
            0.075,
            bandage_material,
        ),
        add_runtime_rounded_cap(
            "Banquet_Victim_Right_Arm_Proximal_Bandage",
            Vector((0.68, 0.0, -0.176)),
            Vector((0, 0, 1)),
            0.088,
            0.075,
            bandage_material,
        ),
        add_runtime_rounded_cap(
            "Banquet_Victim_Left_Leg_Proximal_Bandage",
            Vector((0.009, 0.0, 0.085)),
            Vector((1, 0, 0)),
            0.115,
            0.080,
            bandage_material,
        ),
        add_runtime_rounded_cap(
            "Banquet_Victim_Right_Leg_Proximal_Bandage",
            Vector((0.009, 0.0, -0.085)),
            Vector((1, 0, 0)),
            0.115,
            0.080,
            bandage_material,
        ),
    )
    limb_groups = tuple(
        [limb_cores[index], limb_caps[index]]
        for index in range(4)
    )
    limb_arrangement = (
        (limb_groups[0], -0.82, 0.45, -0.10, 0.145),
        (limb_groups[1], 0.82, 0.64, 0.10, 0.185),
        (limb_groups[2], 0.04, 0.55, -0.17, 0.005),
        (limb_groups[3], -0.04, 0.56, 0.17, 0.035),
    )
    for group, angle, center_x, center_z, layer_y in limb_arrangement:
        arrange_limb_group(
            group,
            angle=angle,
            center_x=center_x,
            center_z=center_z,
            layer_y=layer_y,
        )
    limb_objects = [
        obj
        for group in limb_groups
        for obj in group
    ]
    limbs_fit_scale = fit_runtime_bounds(
        limb_objects,
        LIMBS_MAX_RUNTIME_BOUNDS,
    )

    all_runtime_objects = [*torso_objects, *limb_objects]
    material_names = polish_source_materials(all_runtime_objects)
    images = resize_and_pack_images(args.texture_size)
    output_dir.mkdir(parents=True, exist_ok=True)
    export_glb(torso_path, torso_objects)
    export_glb(limbs_path, limb_objects)

    generated_at = datetime.now(timezone.utc).isoformat()
    torso_bounds = bounds_payload(torso_objects)
    limbs_bounds = bounds_payload(limb_objects)
    validate_runtime_bounds("Torso", torso_bounds, TORSO_MAX_RUNTIME_BOUNDS)
    validate_runtime_bounds("Detached limbs", limbs_bounds, LIMBS_MAX_RUNTIME_BOUNDS)
    source_dir = input_path.parent
    trace = meshy_trace(source_dir)
    if trace["selectedSourceCredits"] != 35:
        raise RuntimeError(
            "Expected the selected Meshy image-to-3D plus rig source to consume "
            f"35 credits, got {trace['selectedSourceCredits']}"
        )
    if trace["rejectedAttempt"]["consumedCredits"] != 40:
        raise RuntimeError(
            "Expected the rejected victim attempt to consume 40 credits, got "
            f"{trace['rejectedAttempt']['consumedCredits']}"
        )
    if trace["consumedCredits"] != 75:
        raise RuntimeError(
            f"Expected all victim attempts to consume 75 credits, got {trace['consumedCredits']}"
        )

    common = {
        "generatedAt": generated_at,
        "pipeline": (
            "one selected Meshy image-to-3D/rig source -> "
            "Blender weighted source-face partition and hard planar cuts -> "
            "static standard glTF export"
        ),
        "blenderVersion": bpy.app.version_string,
        "source": str(input_path),
        "sourceTriangles": source_triangles,
        "sourceTexture": image.name if image else None,
        "textureMaxSize": args.texture_size,
        "images": images,
        "meshy": trace,
        "static": True,
        "skins": 0,
        "animations": 0,
        "compressionExtensions": [],
        "validatedFor": "Three.js r128 standard GLTFLoader",
    }
    torso_report = {
        **common,
        "output": torso_path.name,
        "report": str(torso_report_path),
        "orientation": {
            "headAxis": "+X",
            "faceUpAxis": "+Y",
            "lateralAxis": "+Z",
        },
        "garmentCleanup": {
            "removed": [
                "head geometry because the first-person camera occupies the victim viewpoint",
                "arm and leg geometry partitioned into the detached-limb prop",
            ],
            "retained": (
                "original Meshy v2 bare torso, opaque oxblood boxer briefs, "
                "body proportions, UVs, and PBR atlas"
            ),
            "added": "four non-graphic ivory bandage caps only; no added underwear geometry",
        },
        "visibleMeshyDerivedCore": {
            "mesh": torso_core.name,
            "triangles": triangle_count([torso_core]),
            "method": (
                "direct rig-weight and coordinate-selected Meshy v2 source faces "
                "with original UVs and materials retained, then hard-bisected at "
                "the hip and first-person neck planes"
            ),
        },
        "nonGraphicSocketTreatment": {
            "material": "ivory cloth",
            "torsoSocketBandageCaps": 4,
            "locations": [
                "left shoulder",
                "right shoulder",
                "left hip",
                "right hip",
            ],
            "bloodOrExposedAnatomy": False,
        },
        "fitScaleXYZ": vector_list(torso_fit_scale),
        "boundsMeters": torso_bounds,
        "triangles": triangle_count(torso_objects),
        "meshCount": len(torso_objects),
        "meshes": collect_mesh_names(torso_objects),
        "materials": collect_material_names(torso_objects),
        "preservedSourceMaterials": material_names,
        "sourceMaterialPolicy": (
            "original Meshy v2 PBR atlas retained and resized to a packed "
            f"{args.texture_size}px maximum"
        ),
        "fileBytes": torso_path.stat().st_size,
    }
    limbs_report = {
        **common,
        "output": limbs_path.name,
        "report": str(limbs_report_path),
        "arrangement": "two arms and two legs in a compact layered platter pile",
        "pieceCount": 4,
        "pieces": [
            "left-arm",
            "right-arm",
            "left-leg",
            "right-leg",
        ],
        "fitScaleXYZ": vector_list(limbs_fit_scale),
        "boundsMeters": limbs_bounds,
        "triangles": triangle_count(limb_objects),
        "meshCount": len(limb_objects),
        "meshes": collect_mesh_names(limb_objects),
        "materials": collect_material_names(limb_objects),
        "preservedSourceMaterials": material_names,
        "fileBytes": limbs_path.stat().st_size,
        "garmentCleanup": {
            "removed": [
                "torso and head geometry partitioned into the companion torso prop",
            ],
            "retained": (
                "original Meshy v2 bare arms and hands plus bare legs and feet, "
                "including UVs and PBR atlas"
            ),
            "added": "four non-graphic ivory proximal bandage caps only",
        },
        "visibleMeshyDerivedCore": {
            "meshes": [obj.name for obj in limb_cores],
            "triangles": triangle_count(limb_cores),
            "method": (
                "direct rig-weight and coordinate-selected Meshy v2 source faces "
                "with original UVs and materials retained, then hard-bisected at "
                "all four proximal cut planes"
            ),
        },
        "nonGraphicProximalTreatment": {
            "limbBandageCaps": 4,
            "bloodOrExposedAnatomy": False,
        },
        "sourceMaterialPolicy": (
            "original Meshy v2 PBR atlas retained and resized to a packed "
            f"{args.texture_size}px maximum"
        ),
        "bloodOrExposedAnatomy": False,
    }
    write_json(torso_report_path, torso_report)
    write_json(limbs_report_path, limbs_report)
    update_manifest(
        manifest_path,
        torso_report=torso_report,
        limbs_report=limbs_report,
        trace=trace,
    )

    print(json.dumps({
        "torso": {
            "file": str(torso_path),
            "triangles": torso_report["triangles"],
            "bounds": torso_bounds["size"],
            "bytes": torso_report["fileBytes"],
        },
        "detachedLimbs": {
            "file": str(limbs_path),
            "triangles": limbs_report["triangles"],
            "bounds": limbs_bounds["size"],
            "bytes": limbs_report["fileBytes"],
        },
        "meshyCredits": trace["consumedCredits"],
    }, indent=2))


if __name__ == "__main__":
    main()
