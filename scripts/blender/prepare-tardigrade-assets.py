#!/usr/bin/env python3
"""Prepare one Meshy Tardigrade: Micro Mayhem asset for Three.js r128.

This script deliberately treats Meshy as a source-mesh generator and Blender as
the authority for geometry cleanup, scale/orientation, non-humanoid rigging,
animation, texture budgets, and browser-safe GLB export.

Example animated asset:

    blender --background --factory-startup \
      --python scripts/blender/prepare-tardigrade-assets.py -- \
      --input assets/models/tardigrade/source/hero-tardigrade-master.glb \
      --output assets/models/tardigrade/hero-tardigrade.glb \
      --asset hero-tardigrade --profile hero \
      --target-triangles 14000 --texture-size 512 \
      --save-blend assets/models/tardigrade/source/hero-tardigrade-working.blend \
      --force

Example static prop:

    blender --background --factory-startup \
      --python scripts/blender/prepare-tardigrade-assets.py -- \
      --input assets/models/tardigrade/source/prop-algae-master.glb \
      --output assets/models/tardigrade/prop-algae.glb \
      --asset prop-algae --profile prop \
      --target-triangles 5000 --texture-size 512 --force

Animated exports contain one custom armature/skin and embedded rotation-only,
in-place Actions. Static props contain neither skins nor animations. Outputs use
core glTF 2.0 data without Draco, Meshopt, KTX2, or glTFpack so the repository's
vendored Three.js r128 GLTFLoader can read them without extra decoders.
"""

from __future__ import annotations

import argparse
import bmesh
import hashlib
import json
import math
import os
import struct
import sys
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Matrix, Vector


ANIMATED_PROFILES = {"hero", "rotifer", "ciliate", "waterbearling"}
# Meshy does not promise a front-axis convention. These signs were verified
# from Blender turntable renders of the accepted masters; their faces are at
# source -Y. Blender +Y exports as glTF -Z, so each accepted master needs a
# half-turn before rig/socket placement.
ASSET_FRONT_AXES = {
    "hero-tardigrade": "-Y",
    "creature-rotifer": "-Y",
    "creature-ciliate": "-Y",
    "creature-waterbearling": "-Y",
}
HERO_SKIN_MATERIALS = ("SkinPrimary",)
PROFILE_CLIPS = {
    "hero": ("idle", "scuttle", "dash", "curl", "airborne"),
    "rotifer": ("idle", "locomotion", "startled"),
    "ciliate": ("idle", "locomotion", "startled"),
    "waterbearling": ("idle", "locomotion", "startled"),
    "prop": (),
}
PROFILE_TARGETS = {
    # Blender's +Y becomes glTF -Z. Horizontal animated creatures are fitted by
    # their longitudinal +Y dimension, then exported facing local -Z.
    "hero": {"length": 6.60, "byteBudget": 4 * 1024 * 1024},
    "rotifer": {"length": 3.60, "byteBudget": 3 * 1024 * 1024},
    "ciliate": {"length": 3.40, "byteBudget": 3 * 1024 * 1024},
    "waterbearling": {"length": 2.45, "byteBudget": 3 * 1024 * 1024},
    "prop": {"length": 2.00, "byteBudget": int(1.5 * 1024 * 1024)},
}
HERO_LEG_CLEANUP = {
    # Meshy v3's raw source has five rows. Source front is -Y, so compressing
    # the connected high-Y rear span merges its last two rows without cutting
    # the irregular generated surface or exposing holes.
    "rearCompressionStartFraction": 0.68,
    "rearCompressionEndFraction": 0.73,
}
PROP_TARGETS = {
    "prop-algae": 1.60,
    "prop-bacteria": 2.35,
    "prop-droplet": 3.10,
    "prop-pollen": 2.70,
}
MAX_TEXTURES = 4
MAX_INFLUENCES = 4
EPSILON = 1e-8


@dataclass
class Bounds:
    minimum: Vector
    maximum: Vector

    @property
    def size(self) -> Vector:
        return self.maximum - self.minimum

    @property
    def center(self) -> Vector:
        return (self.minimum + self.maximum) * 0.5

    def to_json(self) -> dict[str, list[float]]:
        return {"min": vector_list(self.minimum), "max": vector_list(self.maximum)}


@dataclass
class RigResult:
    armature: bpy.types.Object
    body_bones: list[str]
    appendage_bones: list[str]
    deform_bones: list[str]
    sockets: list[str]
    appendage_rows: list[float]


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--asset", required=True)
    parser.add_argument(
        "--profile",
        required=True,
        choices=("hero", "rotifer", "ciliate", "waterbearling", "prop"),
    )
    parser.add_argument("--target-triangles", required=True, type=int)
    parser.add_argument("--texture-size", required=True, type=int)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--save-blend", type=Path)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def vector_list(value: Vector) -> list[float]:
    return [round(float(component), 6) for component in value]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
        bpy.data.lights,
        bpy.data.meshes,
    ):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def is_importer_helper(obj: bpy.types.Object) -> bool:
    return any(collection.name == "glTF_not_exported" for collection in obj.users_collection)


def object_bounds(objects: Iterable[bpy.types.Object]) -> Bounds:
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not points:
        raise RuntimeError("Asset has no finite mesh bounds")
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    if not all(math.isfinite(value) for value in (*minimum, *maximum)):
        raise RuntimeError("Asset bounds contain non-finite values")
    if max(maximum - minimum) <= EPSILON:
        raise RuntimeError("Asset bounds have zero usable extent")
    return Bounds(minimum, maximum)


def mesh_bounds(mesh: bpy.types.Object) -> Bounds:
    return object_bounds([mesh])


def triangle_count(objects: Iterable[bpy.types.Object]) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        data = evaluated.to_mesh()
        try:
            data.calc_loop_triangles()
            total += len(data.loop_triangles)
        finally:
            evaluated.to_mesh_clear()
    return total


def select_only(objects: Iterable[bpy.types.Object], active: bpy.types.Object | None = None) -> list[bpy.types.Object]:
    selected = list(objects)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected:
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)
    if selected:
        bpy.context.view_layer.objects.active = active or selected[0]
    return selected


def import_and_join_mesh(input_path: Path, asset: str) -> tuple[bpy.types.Object, dict[str, object]]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH" and not is_importer_helper(obj)]
    if not meshes:
        raise RuntimeError("Meshy source contains no exportable mesh objects")

    source_object_count = len(imported)
    source_mesh_count = len(meshes)
    source_material_count = len({material for obj in meshes for material in obj.data.materials if material})

    # Preserve each mesh in world space, remove any source rig/morph/action
    # baggage, and bake object transforms before joining disconnected pieces.
    for obj in meshes:
        world_matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world_matrix
        obj.animation_data_clear()
        if obj.data.shape_keys:
            obj.shape_key_clear()
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        obj.vertex_groups.clear()
        select_only([obj], obj)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    retained = set(meshes)
    for obj in imported:
        if obj not in retained and obj.name in bpy.context.scene.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    if len(meshes) > 1:
        select_only(meshes, meshes[0])
        bpy.ops.object.join()
        mesh = bpy.context.view_layer.objects.active
    else:
        mesh = meshes[0]
        select_only([mesh], mesh)
    if not mesh or mesh.type != "MESH":
        raise RuntimeError("Blender failed to join the Meshy source meshes")
    mesh.name = f"{asset}_Mesh"
    mesh.data.name = f"{asset}_Geometry"
    mesh.data.validate(verbose=False)
    mesh.data.update()
    return mesh, {
        "objects": source_object_count,
        "meshes": source_mesh_count,
        "materials": source_material_count,
    }


def repair_geometry(mesh: bpy.types.Object, profile: str, asset: str) -> dict[str, object]:
    edit_mesh = bmesh.new()
    edit_mesh.from_mesh(mesh.data)
    before_vertices = len(edit_mesh.verts)
    before_faces = len(edit_mesh.faces)
    bmesh.ops.remove_doubles(edit_mesh, verts=list(edit_mesh.verts), dist=1e-6)
    if edit_mesh.faces:
        bmesh.ops.recalc_face_normals(edit_mesh, faces=list(edit_mesh.faces))

    # Preserve a chunky silhouette while keeping biological assets readable.
    flat_prop = profile == "prop" and asset in {"prop-bacteria", "prop-pollen"}
    for face in edit_mesh.faces:
        face.smooth = not flat_prop
    if not flat_prop:
        sharp_angle = math.radians(58 if profile in ANIMATED_PROFILES else 64)
        for edge in edit_mesh.edges:
            if edge.is_manifold:
                try:
                    edge.smooth = edge.calc_face_angle(0.0) < sharp_angle
                except ValueError:
                    edge.smooth = True

    edit_mesh.to_mesh(mesh.data)
    final_vertices = len(edit_mesh.verts)
    final_faces = len(edit_mesh.faces)
    edit_mesh.free()
    mesh.data.validate(verbose=False)
    mesh.data.update()
    return {
        "verticesBeforeWeld": before_vertices,
        "verticesAfterWeld": final_vertices,
        "facesBefore": before_faces,
        "facesAfter": final_faces,
        "weldDistance": 1e-6,
        "flatShaded": flat_prop,
    }


def move_modifier_first(obj: bpy.types.Object, modifier_name: str) -> None:
    bpy.context.view_layer.objects.active = obj
    while obj.modifiers.find(modifier_name) > 0:
        bpy.ops.object.modifier_move_up(modifier=modifier_name)


def decimate_and_triangulate(mesh: bpy.types.Object, target_triangles: int) -> dict[str, object]:
    source_triangles = triangle_count([mesh])
    passes: list[dict[str, float | int]] = []
    current = source_triangles
    for pass_index in range(3):
        if current <= target_triangles:
            break
        ratio = max(0.02, min(0.98, target_triangles / max(1, current) * 0.985))
        modifier = mesh.modifiers.new(name=f"Tardigrade_Decimate_{pass_index + 1}", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        move_modifier_first(mesh, modifier.name)
        select_only([mesh], mesh)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        next_count = triangle_count([mesh])
        passes.append({"pass": pass_index + 1, "ratio": ratio, "before": current, "after": next_count})
        if next_count >= current:
            break
        current = next_count

    triangulate = mesh.modifiers.new(name="Tardigrade_Triangulate", type="TRIANGULATE")
    triangulate.keep_custom_normals = True
    select_only([mesh], mesh)
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    final_triangles = triangle_count([mesh])
    if final_triangles > target_triangles:
        raise RuntimeError(
            f"Geometry remains above triangle budget after safe decimation: "
            f"{final_triangles} > {target_triangles}"
        )
    return {"sourceTriangles": source_triangles, "finalTriangles": final_triangles, "passes": passes}


def orient_and_normalize(mesh: bpy.types.Object, profile: str, asset: str) -> dict[str, object]:
    source = mesh_bounds(mesh)
    orientation_axis = "unchanged"
    orientation_matrix = Matrix.Identity(4)
    source_front_axis = None

    if profile in ANIMATED_PROFILES:
        dimensions = source.size
        longitudinal_axis = max(range(3), key=lambda axis: dimensions[axis])
        inferred_axis = f"+{'XYZ'[longitudinal_axis]}"
        source_front_axis = ASSET_FRONT_AXES.get(asset, inferred_axis)
        front_axis_index = "XYZ".index(source_front_axis[-1])
        if front_axis_index != longitudinal_axis:
            raise RuntimeError(
                f"Configured front axis {source_front_axis} for {asset} is not its longest axis "
                f"({inferred_axis}); inspect the accepted Meshy master before export"
            )
        rotations = {
            "+X": Matrix.Rotation(math.pi / 2, 4, "Z"),
            "-X": Matrix.Rotation(-math.pi / 2, 4, "Z"),
            "+Y": Matrix.Identity(4),
            "-Y": Matrix.Rotation(math.pi, 4, "Z"),
            "+Z": Matrix.Rotation(-math.pi / 2, 4, "X"),
            "-Z": Matrix.Rotation(math.pi / 2, 4, "X"),
        }
        orientation_matrix = rotations[source_front_axis]
        orientation_axis = f"{source_front_axis} to Blender +Y / glTF -Z"
        mesh.data.transform(orientation_matrix)
        mesh.data.update()

    oriented = mesh_bounds(mesh)
    if profile in ANIMATED_PROFILES:
        source_measure = oriented.size.y
        target_measure = float(PROFILE_TARGETS[profile]["length"])
        fit_dimension = "length"
    else:
        source_measure = max(oriented.size)
        target_measure = float(PROP_TARGETS.get(asset, PROFILE_TARGETS["prop"]["length"]))
        fit_dimension = "maximumDimension"
    if not math.isfinite(source_measure) or source_measure <= EPSILON:
        raise RuntimeError("Cannot normalize an asset with zero target-axis extent")

    scale = target_measure / source_measure
    mesh.data.transform(Matrix.Scale(scale, 4))
    mesh.data.update()
    scaled = mesh_bounds(mesh)
    offset = Vector((-scaled.center.x, -scaled.center.y, -scaled.minimum.z))
    mesh.data.transform(Matrix.Translation(offset))
    mesh.data.update()
    normalized = mesh_bounds(mesh)
    return {
        "sourceBounds": source.to_json(),
        "orientedBounds": oriented.to_json(),
        "blenderBounds": normalized.to_json(),
        "runtimeBounds": blender_to_gltf_bounds(normalized).to_json(),
        "orientationStrategy": orientation_axis,
        "sourceFrontAxis": source_front_axis,
        "forward": "-Z",
        "up": "+Y",
        "fitDimension": fit_dimension,
        "targetDimension": target_measure,
        "uniformScale": scale,
        "grounded": abs(normalized.minimum.z) <= 1e-5,
        "centeredXZ": abs(normalized.center.x) <= 1e-5 and abs(normalized.center.y) <= 1e-5,
    }


def measure_planted_leg_rows(mesh: bpy.types.Object) -> list[float]:
    bounds = mesh_bounds(mesh)
    size = bounds.size
    bins = 48
    counts = [0] * bins
    center_x = bounds.center.x
    for vertex in mesh.data.vertices:
        coordinate = vertex.co
        is_low_appendage = coordinate.z <= bounds.minimum.z + size.z * 0.48
        is_lateral = abs(coordinate.x - center_x) >= size.x * 0.22
        if not is_low_appendage or not is_lateral:
            continue
        index = min(
            bins - 1,
            max(0, int((coordinate.y - bounds.minimum.y) / max(size.y, EPSILON) * bins)),
        )
        counts[index] += 1
    root_counts = [math.sqrt(count) for count in counts]
    smoothed = [
        count
        + (root_counts[index - 1] if index > 0 else 0.0)
        + (root_counts[index + 1] if index + 1 < bins else 0.0)
        for index, count in enumerate(root_counts)
    ]
    threshold = max(smoothed, default=0) * 0.45
    candidates = [
        index
        for index, value in enumerate(smoothed)
        if value >= threshold
        and value >= (smoothed[index - 1] if index > 0 else -1.0)
        and value >= (smoothed[index + 1] if index + 1 < bins else -1.0)
    ]
    selected: list[int] = []
    for index in sorted(candidates, key=lambda candidate: smoothed[candidate], reverse=True):
        if all(abs(index - other) >= 5 for other in selected):
            selected.append(index)
    selected.sort()
    return [
        bounds.minimum.y + size.y * ((index + 0.5) / bins)
        for index in selected
    ]


def correct_hero_anatomy(mesh: bpy.types.Object, profile: str, asset: str) -> dict[str, object] | None:
    if profile != "hero" or asset != "hero-tardigrade":
        return None

    bounds = mesh_bounds(mesh)
    size = bounds.size
    before_rows = measure_planted_leg_rows(mesh)
    if len(before_rows) == 4:
        return {
            "method": "source-already-has-four-planted-rows",
            "legRowsBefore": [round(value, 6) for value in before_rows],
            "legRowsAfter": [round(value, 6) for value in before_rows],
            "compressedVertices": 0,
            "crossSectionCompensation": 1.0,
            "targetLegPairs": 4,
        }
    if len(before_rows) != 5:
        raise RuntimeError(f"Hero source must expose four or five measurable planted leg rows; found {before_rows}")
    cleanup = HERO_LEG_CLEANUP
    compression_start = bounds.minimum.y + size.y * cleanup["rearCompressionStartFraction"]
    compression_end = bounds.minimum.y + size.y * cleanup["rearCompressionEndFraction"]
    compression_scale = (compression_end - compression_start) / max(bounds.maximum.y - compression_start, EPSILON)
    cross_section_compensation = (compression_end - bounds.minimum.y) / max(size.y, EPSILON)
    compressed_vertices = 0

    edit_mesh = bmesh.new()
    edit_mesh.from_mesh(mesh.data)
    for vertex in edit_mesh.verts:
        if vertex.co.y > compression_start:
            vertex.co.y = compression_start + (vertex.co.y - compression_start) * compression_scale
            compressed_vertices += 1
    edit_mesh.to_mesh(mesh.data)
    edit_mesh.free()
    mesh.data.validate(verbose=False)
    mesh.data.update()
    after_rows = measure_planted_leg_rows(mesh)
    if len(after_rows) != 4:
        raise RuntimeError(
            "Hero anatomical cleanup must reduce five visible planted leg rows to exactly four; "
            f"measured {before_rows} before and {after_rows} after while compressing {compressed_vertices} vertices"
        )
    return {
        "method": "compress-extra-rear-row-into-adjacent-pair",
        "legRowsBefore": [round(value, 6) for value in before_rows],
        "legRowsAfter": [round(value, 6) for value in after_rows],
        "compressedVertices": compressed_vertices,
        "crossSectionCompensation": cross_section_compensation,
        "targetLegPairs": 4,
    }


def compensate_hero_cross_section(
    mesh: bpy.types.Object,
    anatomy_report: dict[str, object] | None,
    normalization: dict[str, object],
) -> None:
    if not anatomy_report:
        return
    factor = float(anatomy_report["crossSectionCompensation"])
    for vertex in mesh.data.vertices:
        vertex.co.x *= factor
        vertex.co.z *= factor
    mesh.data.update()
    bounds = mesh_bounds(mesh)
    normalization["blenderBounds"] = bounds.to_json()
    normalization["runtimeBounds"] = blender_to_gltf_bounds(bounds).to_json()
    normalization["crossSectionCompensation"] = factor


def blender_to_gltf_bounds(bounds: Bounds) -> Bounds:
    # Blender glTF export maps (x, y, z) -> (x, z, -y).
    return Bounds(
        Vector((bounds.minimum.x, bounds.minimum.z, -bounds.maximum.y)),
        Vector((bounds.maximum.x, bounds.maximum.z, -bounds.minimum.y)),
    )


def material_image_nodes(material: bpy.types.Material) -> list[bpy.types.ShaderNodeTexImage]:
    if not material.use_nodes or not material.node_tree:
        return []
    return [node for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image]


def image_priority(node: bpy.types.ShaderNodeTexImage) -> tuple[int, str]:
    name = f"{node.name} {node.label} {node.image.name if node.image else ''}".lower()
    outgoing = " ".join(link.to_socket.name.lower() for output in node.outputs for link in output.links)
    combined = f"{name} {outgoing}"
    if any(token in combined for token in ("base color", "albedo", "diffuse", "color")):
        return (0, name)
    if any(token in combined for token in ("rough", "metal", "orm", "occlusion")):
        return (1, name)
    if "normal" in combined:
        return (2, name)
    return (3, name)


def add_hero_oral_inset(mesh: bpy.types.Object) -> dict[str, object]:
    """Add a shallow dark cavity that survives the game's bright lab light."""
    bounds = mesh_bounds(mesh)
    size = bounds.size
    radius = min(size.x, size.z) * 0.085
    depth = size.y * 0.012
    center_z = bounds.minimum.z + size.z * 0.48
    center_y = bounds.maximum.y + depth * 0.10
    front_protrusion = depth * 0.60

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24,
        radius=radius,
        depth=depth,
        end_fill_type="NGON",
        location=(0.0, center_y, center_z),
        rotation=(math.pi / 2, 0.0, 0.0),
    )
    inset = bpy.context.object
    inset.name = "hero-tardigrade_OralInset"
    select_only([inset], inset)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    material = bpy.data.materials.new("MouthDark")
    material.diffuse_color = (0.055, 0.018, 0.012, 1.0)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF") if material.node_tree else None
    if principled:
        base_color = principled.inputs.get("Base Color")
        roughness = principled.inputs.get("Roughness")
        metallic = principled.inputs.get("Metallic")
        if base_color:
            base_color.default_value = (0.055, 0.018, 0.012, 1.0)
        if roughness:
            roughness.default_value = 0.72
        if metallic:
            metallic.default_value = 0.0
    inset.data.materials.append(material)
    inset_triangles = sum(max(0, len(polygon.vertices) - 2) for polygon in inset.data.polygons)

    # Keep one skinned mesh so the inset follows Head and retains the existing
    # SkeletonUtils clone/runtime path without a second attachment system.
    select_only([mesh, inset], mesh)
    bpy.ops.object.join()
    mesh.data.validate(verbose=False, clean_customdata=True)
    mesh.data.update()
    return {
        "material": material.name,
        "radius": radius,
        "depth": depth,
        "center": vector_list(Vector((0.0, center_y, center_z))),
        "frontProtrusion": front_protrusion,
        "triangles": inset_triangles,
    }


def tune_materials(mesh: bpy.types.Object, asset: str) -> dict[str, object]:
    materials = sorted({material for material in mesh.data.materials if material}, key=lambda item: item.name)
    semantic_face_counts: dict[str, int] = {}
    oral_inset_report: dict[str, object] | None = None
    if asset == "hero-tardigrade":
        if not materials:
            raise RuntimeError("Hero source has no material to preserve for store skin variants")
        base = materials[0]
        # The accepted Meshy master has one texture atlas. Preserve that single
        # mobile-efficient material and give it the semantic name consumed by
        # applyAuthoredHeroSkin(); duplicating the atlas into three glTF
        # materials would create nine texture entries and break the <=4 budget.
        base.name = HERO_SKIN_MATERIALS[0]
        mesh.data.materials.clear()
        mesh.data.materials.append(base)
        for polygon in mesh.data.polygons:
            polygon.material_index = 0
        oral_inset_report = add_hero_oral_inset(mesh)
        materials = [material for material in mesh.data.materials if material]
    else:
        for index, material in enumerate(materials, start=1):
            material.name = f"{asset}_Material_{index:02d}"

    for material in materials:
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        elif hasattr(material, "blend_method"):
            material.blend_method = "OPAQUE"
        material.use_backface_culling = False
        if not material.use_nodes or not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            emission_color = node.inputs.get("Emission Color") or node.inputs.get("Emission")
            emission_strength = node.inputs.get("Emission Strength")
            roughness = node.inputs.get("Roughness")
            metallic = node.inputs.get("Metallic")
            if emission_color:
                for link in list(emission_color.links):
                    material.node_tree.links.remove(link)
                emission_color.default_value = (0.0, 0.0, 0.0, 1.0)
            if emission_strength:
                for link in list(emission_strength.links):
                    material.node_tree.links.remove(link)
                emission_strength.default_value = 0.0
            if roughness and not roughness.is_linked:
                roughness.default_value = max(float(roughness.default_value), 0.48)
            if metallic and not metallic.is_linked:
                metallic.default_value = min(float(metallic.default_value), 0.25)

    # Meshy sometimes retains image nodes that no longer contribute to the
    # material. Keep the four most useful maps and remove surplus image nodes
    # before export so mobile texture budgets remain deterministic.
    nodes = [(material, node) for material in materials for node in material_image_nodes(material)]
    unique_images: dict[int, tuple[bpy.types.Material, bpy.types.ShaderNodeTexImage]] = {}
    for material, node in sorted(nodes, key=lambda item: image_priority(item[1])):
        unique_images.setdefault(node.image.as_pointer(), (material, node))
    keep_ids = set(list(unique_images.keys())[:MAX_TEXTURES])
    removed_images: list[str] = []
    for material, node in nodes:
        if node.image.as_pointer() in keep_ids:
            continue
        removed_images.append(node.image.name)
        material.node_tree.nodes.remove(node)

    # Drop unused material slots left behind by joined Meshy fragments.
    used_indices = sorted({polygon.material_index for polygon in mesh.data.polygons})
    if not used_indices and mesh.data.materials:
        used_indices = [0]
    if used_indices:
        remap = {old: new for new, old in enumerate(used_indices)}
        retained = [mesh.data.materials[index] for index in used_indices if index < len(mesh.data.materials)]
        remapped_indices = [remap.get(polygon.material_index, 0) for polygon in mesh.data.polygons]
        mesh.data.materials.clear()
        for material in retained:
            mesh.data.materials.append(material)
        for polygon, material_index in zip(mesh.data.polygons, remapped_indices, strict=True):
            polygon.material_index = material_index

    final_materials = [material for material in mesh.data.materials if material]
    if asset == "hero-tardigrade":
        semantic_face_counts = {
            material.name: sum(1 for polygon in mesh.data.polygons if polygon.material_index == index)
            for index, material in enumerate(final_materials)
        }
    return {
        "names": [material.name for material in final_materials],
        "count": len(final_materials),
        "removedTextureNodes": sorted(set(removed_images)),
        "semanticFaceCounts": semantic_face_counts,
        "oralInset": oral_inset_report,
    }


def resize_and_pack_images(mesh: bpy.types.Object, max_size: int) -> list[dict[str, object]]:
    images = sorted(
        {node.image for material in mesh.data.materials if material for node in material_image_nodes(material)},
        key=lambda image: image.name,
    )
    results: list[dict[str, object]] = []
    for image in images:
        width, height = int(image.size[0]), int(image.size[1])
        if width <= 0 or height <= 0:
            continue
        original = (width, height)
        if max(width, height) > max_size:
            if not image.has_data:
                try:
                    _ = image.pixels[0]
                except (IndexError, RuntimeError):
                    pass
            factor = max_size / max(width, height)
            image.scale(max(1, round(width * factor)), max(1, round(height * factor)))
            image.update()
        try:
            image.pack()
        except RuntimeError as error:
            raise RuntimeError(f"Could not pack runtime texture {image.name}: {error}") from error
        runtime_size = (int(image.size[0]), int(image.size[1]))
        if max(runtime_size) > max_size:
            raise RuntimeError(
                f"Runtime texture {image.name} remains above --texture-size: {runtime_size} > {max_size}"
            )
        if not image.packed_file:
            raise RuntimeError(f"Runtime texture {image.name} was not packed into the Blender export")
        results.append(
            {
                "name": image.name,
                "sourceSize": [original[0], original[1]],
                "runtimeSize": [runtime_size[0], runtime_size[1]],
                "packed": bool(image.packed_file),
            }
        )
    if len(results) > MAX_TEXTURES:
        raise RuntimeError(f"Texture pruning failed: {len(results)} images remain (budget {MAX_TEXTURES})")
    return results


def new_edit_bone(
    armature: bpy.types.Object,
    name: str,
    head: Vector,
    tail: Vector,
    parent: bpy.types.EditBone | None = None,
    *,
    connected: bool = False,
    deform: bool = True,
) -> bpy.types.EditBone:
    bone = armature.data.edit_bones.new(name)
    bone.head = head
    bone.tail = tail if (tail - head).length > 1e-4 else head + Vector((0.0, 0.08, 0.0))
    bone.parent = parent
    bone.use_connect = connected and parent is not None
    bone.use_deform = deform
    return bone


def create_rig(mesh: bpy.types.Object, profile: str, asset: str) -> RigResult:
    bounds = mesh_bounds(mesh)
    size = bounds.size
    length = size.y
    height = size.z
    width = size.x
    center_z = bounds.minimum.z + height * 0.48

    data = bpy.data.armatures.new(f"{asset}_Skeleton")
    armature = bpy.data.objects.new(f"{asset}_Armature", data)
    bpy.context.scene.collection.objects.link(armature)
    armature.show_in_front = True
    select_only([armature], armature)
    bpy.ops.object.mode_set(mode="EDIT")

    root = new_edit_bone(
        armature,
        "Root",
        Vector((0.0, 0.0, 0.0)),
        Vector((0.0, 0.0, max(0.12, height * 0.16))),
        deform=False,
    )

    body_bones: list[str] = []
    body_objects: list[bpy.types.EditBone] = []
    segments = 4 if profile in {"hero", "waterbearling"} else 3
    rear = bounds.minimum.y + length * 0.05
    front = bounds.maximum.y - length * 0.13
    boundaries = [rear + (front - rear) * index / segments for index in range(segments + 1)]
    parent: bpy.types.EditBone = root
    for index in range(segments):
        name = f"Body_{index + 1:02d}"
        bone = new_edit_bone(
            armature,
            name,
            Vector((0.0, boundaries[index], center_z)),
            Vector((0.0, boundaries[index + 1], center_z)),
            parent,
            connected=index > 0,
        )
        body_bones.append(name)
        body_objects.append(bone)
        parent = bone

    head = new_edit_bone(
        armature,
        "Head",
        Vector((0.0, front, center_z)),
        Vector((0.0, bounds.maximum.y, center_z + height * 0.03)),
        parent,
        connected=True,
    )
    body_bones.append("Head")
    body_objects.append(head)

    appendage_bones: list[str] = []
    appendage_rows: list[float] = []
    legged = profile in {"hero", "waterbearling"}
    if legged:
        if profile == "hero":
            appendage_rows = measure_planted_leg_rows(mesh)
            if len(appendage_rows) != 4:
                raise RuntimeError(f"Hero rig requires four measured planted leg rows; found {appendage_rows}")
        else:
            appendage_rows = [
                bounds.minimum.y + length * fraction
                for fraction in (0.20, 0.40, 0.61, 0.79)
            ]
        for row_index, row_y in enumerate(appendage_rows, start=1):
            body_index = min(
                range(len(body_objects)),
                key=lambda index: abs(((body_objects[index].head.y + body_objects[index].tail.y) * 0.5) - row_y),
            )
            for side_name, side in (("L", -1.0), ("R", 1.0)):
                inner = Vector((side * width * 0.13, row_y, bounds.minimum.z + height * 0.43))
                knee = Vector((side * width * 0.34, row_y, bounds.minimum.z + height * 0.25))
                foot = Vector((side * width * 0.48, row_y + length * 0.015, bounds.minimum.z + height * 0.035))
                upper_name = f"Leg_{side_name}{row_index}_Upper"
                lower_name = f"Leg_{side_name}{row_index}_Lower"
                upper = new_edit_bone(armature, upper_name, inner, knee, body_objects[body_index])
                new_edit_bone(armature, lower_name, knee, foot, upper, connected=True)
                appendage_bones.extend((upper_name, lower_name))
    else:
        appendage_rows = [bounds.minimum.y + length * 0.34, bounds.minimum.y + length * 0.66]
        for row_index, row_y in enumerate(appendage_rows, start=1):
            body_index = min(
                range(len(body_objects)),
                key=lambda index: abs(((body_objects[index].head.y + body_objects[index].tail.y) * 0.5) - row_y),
            )
            for side_name, side in (("L", -1.0), ("R", 1.0)):
                name = f"Fin_{side_name}{row_index}"
                new_edit_bone(
                    armature,
                    name,
                    Vector((side * width * 0.10, row_y, center_z)),
                    Vector((side * width * 0.48, row_y, center_z + height * 0.02)),
                    body_objects[body_index],
                )
                appendage_bones.append(name)

    sockets: list[str] = []
    if profile == "hero":
        face = new_edit_bone(
            armature,
            "Face",
            Vector((0.0, bounds.maximum.y - length * 0.04, center_z + height * 0.05)),
            Vector((0.0, bounds.maximum.y + length * 0.04, center_z + height * 0.05)),
            head,
            deform=False,
        )
        back_parent = body_objects[max(0, len(body_objects) // 2 - 1)]
        back = new_edit_bone(
            armature,
            "Back",
            Vector((0.0, bounds.center.y, bounds.maximum.z - height * 0.14)),
            Vector((0.0, bounds.center.y, bounds.maximum.z + height * 0.02)),
            back_parent,
            deform=False,
        )
        new_edit_bone(
            armature,
            "Camera",
            Vector((width * 0.14, bounds.center.y + length * 0.05, bounds.maximum.z - height * 0.06)),
            Vector((width * 0.14, bounds.center.y + length * 0.05, bounds.maximum.z + height * 0.08)),
            back,
            deform=False,
        )
        sockets = ["Head", "Face", "Back", "Camera"]

    bpy.ops.object.mode_set(mode="OBJECT")
    deform_bones = [bone.name for bone in armature.data.bones if bone.use_deform]
    return RigResult(armature, body_bones, appendage_bones, deform_bones, sockets, appendage_rows)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def assign_skin_weights(mesh: bpy.types.Object, rig: RigResult, profile: str) -> dict[str, object]:
    mesh.vertex_groups.clear()
    groups = {name: mesh.vertex_groups.new(name=name) for name in rig.deform_bones}
    bounds = mesh_bounds(mesh)
    size = bounds.size
    body_centers = {
        name: (rig.armature.data.bones[name].head_local.y + rig.armature.data.bones[name].tail_local.y) * 0.5
        for name in rig.body_bones
    }
    sigma = max(size.y / max(2, len(rig.body_bones) - 1), 0.05)
    influenced_vertices = 0
    maximum_influences = 0

    for vertex in mesh.data.vertices:
        coordinate = vertex.co
        body_candidates = sorted(
            (
                (name, math.exp(-((coordinate.y - center) / sigma) ** 2))
                for name, center in body_centers.items()
            ),
            key=lambda item: item[1],
            reverse=True,
        )[:2]
        weights: dict[str, float] = {name: value for name, value in body_candidates}

        half_width = max(size.x * 0.5, 0.01)
        lateral = abs(coordinate.x) / half_width
        low = 1.0 - clamp01((coordinate.z - bounds.minimum.z) / max(size.z * 0.82, 0.01))
        appendage_factor = clamp01((lateral - 0.34) / 0.48) * clamp01(low * 1.35)
        if rig.appendage_rows and appendage_factor > 0.01:
            row_index = min(range(len(rig.appendage_rows)), key=lambda index: abs(coordinate.y - rig.appendage_rows[index])) + 1
            side_name = "L" if coordinate.x < 0 else "R"
            upper_name = (
                f"Leg_{side_name}{row_index}_Upper"
                if profile in {"hero", "waterbearling"}
                else f"Fin_{side_name}{row_index}"
            )
            lower_name = f"Leg_{side_name}{row_index}_Lower"
            for name in list(weights):
                weights[name] *= 1.0 - appendage_factor
            if upper_name in groups:
                if lower_name in groups:
                    lower_mix = clamp01((lateral - 0.56) / 0.36) * clamp01(low * 1.2)
                    weights[upper_name] = appendage_factor * (1.0 - lower_mix)
                    weights[lower_name] = appendage_factor * lower_mix
                else:
                    weights[upper_name] = appendage_factor

        weights = {name: value for name, value in weights.items() if value > 1e-5 and name in groups}
        if not weights:
            nearest = min(body_centers, key=lambda name: abs(coordinate.y - body_centers[name]))
            weights = {nearest: 1.0}
        ordered = sorted(weights.items(), key=lambda item: item[1], reverse=True)[:MAX_INFLUENCES]
        total = sum(value for _, value in ordered)
        for name, value in ordered:
            groups[name].add([vertex.index], value / total, "REPLACE")
        influenced_vertices += 1
        maximum_influences = max(maximum_influences, len(ordered))

    modifier = mesh.modifiers.new(name="Tardigrade_Armature", type="ARMATURE")
    modifier.object = rig.armature
    modifier.use_vertex_groups = True
    mesh.parent = rig.armature
    mesh.matrix_parent_inverse = rig.armature.matrix_world.inverted()
    return {
        "vertices": len(mesh.data.vertices),
        "influencedVertices": influenced_vertices,
        "maximumInfluences": maximum_influences,
        "groups": sorted(groups),
    }


def reset_pose(armature: bpy.types.Object) -> None:
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = (0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)
        pose_bone.scale = (1.0, 1.0, 1.0)


def clip_frames(name: str) -> list[int]:
    if name in {"dash", "startled"}:
        return [1, 5, 9, 13, 17]
    return [1, 7, 13, 19, 25]


def pose_clip(
    armature: bpy.types.Object,
    rig: RigResult,
    profile: str,
    clip: str,
    phase: float,
) -> list[str]:
    keyed: list[str] = []
    body = [armature.pose.bones[name] for name in rig.body_bones if name in armature.pose.bones]
    appendages = [armature.pose.bones[name] for name in rig.appendage_bones if name in armature.pose.bones]
    wave = math.sin(phase * math.tau)
    pulse = math.sin(phase * math.pi)

    for index, bone in enumerate(body):
        offset = phase * math.tau + index * 0.72
        if clip == "idle":
            bone.rotation_euler.x = math.sin(offset) * 0.045
            bone.rotation_euler.z = math.cos(offset * 0.8) * 0.025
        elif clip in {"scuttle", "locomotion"}:
            bone.rotation_euler.x = math.sin(offset * 1.6) * 0.09
            bone.rotation_euler.z = math.sin(offset) * 0.075
        elif clip == "dash":
            bone.rotation_euler.x = -pulse * (0.18 + index * 0.025)
            bone.rotation_euler.z = math.sin(phase * math.tau) * 0.025
        elif clip == "curl":
            # Tuck into a compact tun-like defensive pose without stacking a
            # large constant bend across the complete body chain. The former
            # pose accumulated roughly 2.45 radians and stood the creature on
            # end in a tall U instead of reading as a small curled water bear.
            bone.rotation_euler.x = pulse * (0.055 + index * 0.006)
            bone.rotation_euler.z = math.sin(offset) * pulse * 0.012
        elif clip == "airborne":
            bone.rotation_euler.x = 0.12 + math.sin(offset) * 0.035
            bone.rotation_euler.z = math.cos(offset) * 0.025
        elif clip == "startled":
            direction = -1.0 if index % 2 else 1.0
            bone.rotation_euler.x = direction * pulse * 0.24
            bone.rotation_euler.z = direction * pulse * 0.18
        keyed.append(bone.name)

    for index, bone in enumerate(appendages):
        alternating = -1.0 if index % 2 else 1.0
        if clip == "idle":
            bone.rotation_euler.y = math.sin(phase * math.tau + index * 0.55) * 0.08
        elif clip in {"scuttle", "locomotion"}:
            bone.rotation_euler.x = math.sin(phase * math.tau * 2 + index * 0.92) * 0.52
            bone.rotation_euler.z = alternating * 0.08
        elif clip == "dash":
            bone.rotation_euler.x = alternating * pulse * 0.32
            bone.rotation_euler.z = alternating * pulse * 0.24
        elif clip == "curl":
            bone.rotation_euler.x = alternating * pulse * 0.28
            bone.rotation_euler.z = alternating * pulse * 0.24
        elif clip == "airborne":
            bone.rotation_euler.x = alternating * (0.62 + wave * 0.05)
            bone.rotation_euler.z = alternating * 0.38
        elif clip == "startled":
            bone.rotation_euler.x = alternating * pulse * 0.75
            bone.rotation_euler.z = alternating * pulse * 0.45
        keyed.append(bone.name)
    return keyed


def create_action(
    armature: bpy.types.Object,
    rig: RigResult,
    profile: str,
    clip: str,
) -> dict[str, object]:
    action = bpy.data.actions.new(name=clip)
    action.use_fake_user = True
    if not armature.animation_data:
        armature.animation_data_create()
    armature.animation_data.action = action
    frames = clip_frames(clip)
    periodic = clip in {"idle", "scuttle", "locomotion"}
    keyed_names: set[str] = set()
    for frame_index, frame in enumerate(frames):
        bpy.context.scene.frame_set(frame)
        reset_pose(armature)
        # Write the closing sample from the exact same phase as the opening
        # sample. This avoids a visible hitch even for pose formulae whose
        # internal frequencies are intentionally non-integer.
        phase = 0.0 if periodic and frame_index == len(frames) - 1 else frame_index / max(1, len(frames) - 1)
        keyed_names.update(pose_clip(armature, rig, profile, clip, phase))
        for bone_name in sorted(keyed_names):
            bone = armature.pose.bones.get(bone_name)
            if bone:
                bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
    action.frame_start = frames[0]
    action.frame_end = frames[-1]
    armature.animation_data.action = None
    return {
        "name": clip,
        "frameStart": frames[0],
        "frameEnd": frames[-1],
        "frames": len(frames),
        "fps": 24,
        "durationSeconds": round((frames[-1] - frames[0]) / 24, 6),
        "channels": len(keyed_names),
        "periodic": periodic,
        "loopEndpointsExact": periodic,
        "worldRootTranslation": False,
    }


def create_animations(armature: bpy.types.Object, rig: RigResult, profile: str) -> list[dict[str, object]]:
    bpy.context.scene.render.fps = 24
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 25
    clips = [create_action(armature, rig, profile, clip) for clip in PROFILE_CLIPS[profile]]
    bpy.context.scene.frame_set(1)
    reset_pose(armature)
    if armature.animation_data:
        armature.animation_data.action = None
    return clips


def export_glb(
    output: Path,
    mesh: bpy.types.Object,
    armature: bpy.types.Object | None,
    animated: bool,
) -> None:
    objects = [mesh] if armature is None else [armature, mesh]
    select_only(objects, armature or mesh)
    requested: dict[str, object] = {
        "filepath": str(output),
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_animations": animated,
        "export_animation_mode": "ACTIONS",
        "export_merge_animation": "ACTION",
        "export_force_sampling": False,
        "export_bake_animation": False,
        "export_optimize_animation_size": True,
        "export_anim_slide_to_zero": True,
        "export_skins": animated,
        "export_influence_nb": MAX_INFLUENCES,
        "export_all_influences": False,
        "export_morph": False,
        "export_morph_animation": False,
        "export_cameras": False,
        "export_lights": False,
        "export_draco_mesh_compression_enable": False,
        "export_use_gltfpack": False,
        "export_apply": False,
        "export_def_bones": False,
        "export_leaf_bone": False,
        "export_extras": True,
    }
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    result = bpy.ops.export_scene.gltf(**{key: value for key, value in requested.items() if key in available})
    if "FINISHED" not in result or not output.is_file():
        raise RuntimeError(f"Blender did not produce the runtime GLB: {output}")


def parse_glb(path: Path) -> tuple[dict[str, object], bytes, bytes]:
    payload = path.read_bytes()
    if len(payload) < 20:
        raise RuntimeError("Exported GLB is too small")
    magic, version, declared_length = struct.unpack_from("<4sII", payload, 0)
    if magic != b"glTF" or version != 2 or declared_length != len(payload):
        raise RuntimeError("Exported file has an invalid GLB 2.0 header")
    offset = 12
    document: dict[str, object] | None = None
    binary_chunk = b""
    while offset + 8 <= len(payload):
        chunk_length, chunk_type = struct.unpack_from("<II", payload, offset)
        offset += 8
        end = offset + chunk_length
        if end > len(payload):
            raise RuntimeError("Exported GLB contains a truncated chunk")
        if chunk_type == 0x4E4F534A:
            document = json.loads(payload[offset:end].decode("utf-8").rstrip(" \t\r\n\0"))
        elif chunk_type == 0x004E4942:
            binary_chunk = payload[offset:end]
        offset = end
    if document is None:
        raise RuntimeError("Exported GLB has no JSON document")
    return document, payload, binary_chunk


def encoded_image_dimensions(data: bytes, mime_type: str) -> tuple[int, int] | None:
    if mime_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack_from(">II", data, 16)
    if mime_type in {"image/jpeg", "image/jpg"} and data.startswith(b"\xff\xd8"):
        position = 2
        start_of_frame = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
        while position + 4 <= len(data):
            if data[position] != 0xFF:
                position += 1
                continue
            while position < len(data) and data[position] == 0xFF:
                position += 1
            if position >= len(data):
                break
            marker = data[position]
            position += 1
            if marker in {0x01, 0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
                continue
            if position + 2 > len(data):
                break
            segment_length = struct.unpack_from(">H", data, position)[0]
            if segment_length < 2 or position + segment_length > len(data):
                break
            if marker in start_of_frame and segment_length >= 7:
                height, width = struct.unpack_from(">HH", data, position + 3)
                return width, height
            position += segment_length
    return None


def glb_image_dimensions(document: dict[str, object], binary_chunk: bytes) -> list[dict[str, object]]:
    views = document.get("bufferViews", [])
    dimensions: list[dict[str, object]] = []
    for index, image in enumerate(document.get("images", [])):
        mime_type = str(image.get("mimeType", ""))
        if mime_type not in {"image/png", "image/jpeg", "image/jpg"}:
            raise RuntimeError(f"Runtime GLB image {index} uses unsupported MIME type: {mime_type or 'unknown'}")
        view_index = image.get("bufferView")
        if not isinstance(view_index, int) or view_index >= len(views):
            raise RuntimeError(f"Runtime GLB image {index} is not embedded in a valid bufferView")
        view = views[view_index]
        start = int(view.get("byteOffset", 0))
        end = start + int(view.get("byteLength", 0))
        encoded = binary_chunk[start:end]
        size = encoded_image_dimensions(encoded, mime_type)
        if not size:
            raise RuntimeError(f"Could not inspect embedded dimensions for runtime GLB image {index}")
        dimensions.append(
            {
                "name": image.get("name", f"Image_{index}"),
                "mimeType": mime_type,
                "width": int(size[0]),
                "height": int(size[1]),
            }
        )
    return dimensions


def glb_float_accessor(
    document: dict[str, object],
    binary_chunk: bytes,
    accessor_index: int,
) -> list[list[float]]:
    accessors = document.get("accessors", [])
    views = document.get("bufferViews", [])
    accessor = accessors[accessor_index]
    if accessor.get("componentType") != 5126:
        raise RuntimeError(f"Animation accessor {accessor_index} is not FLOAT data")
    component_counts = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
    component_count = component_counts.get(accessor.get("type"))
    view_index = accessor.get("bufferView")
    if not component_count or not isinstance(view_index, int) or view_index >= len(views):
        raise RuntimeError(f"Animation accessor {accessor_index} has an unsupported layout")
    view = views[view_index]
    stride = int(view.get("byteStride", component_count * 4))
    start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    values: list[list[float]] = []
    for sample_index in range(int(accessor.get("count", 0))):
        sample_start = start + sample_index * stride
        values.append(
            [struct.unpack_from("<f", binary_chunk, sample_start + component * 4)[0] for component in range(component_count)]
        )
    return values


def validate_periodic_animation_endpoints(
    document: dict[str, object],
    binary_chunk: bytes,
) -> dict[str, dict[str, object]]:
    evidence: dict[str, dict[str, object]] = {}
    periodic_names = {"idle", "scuttle", "locomotion"}
    for animation in document.get("animations", []):
        name = str(animation.get("name", ""))
        if name not in periodic_names:
            continue
        maximum_value_delta = 0.0
        maximum_tangent_delta = 0.0
        maximum_samples = 0
        start_time = math.inf
        end_time = -math.inf
        for sampler in animation.get("samplers", []):
            times = glb_float_accessor(document, binary_chunk, int(sampler["input"]))
            outputs = glb_float_accessor(document, binary_chunk, int(sampler["output"]))
            interpolation = str(sampler.get("interpolation", "LINEAR"))
            if not times or not outputs:
                raise RuntimeError(f"Periodic animation {name} contains an empty sampler")
            maximum_samples = max(maximum_samples, len(times))
            start_time = min(start_time, float(times[0][0]))
            end_time = max(end_time, float(times[-1][0]))
            if interpolation == "CUBICSPLINE":
                if len(outputs) != len(times) * 3:
                    raise RuntimeError(f"Periodic animation {name} has malformed cubic-spline samples")
                first_value, last_value = outputs[1], outputs[-2]
                first_out_tangent, last_in_tangent = outputs[2], outputs[-3]
                maximum_tangent_delta = max(
                    maximum_tangent_delta,
                    max(abs(a - b) for a, b in zip(first_out_tangent, last_in_tangent, strict=True)),
                )
            else:
                first_value, last_value = outputs[0], outputs[-1]
            maximum_value_delta = max(
                maximum_value_delta,
                max(abs(a - b) for a, b in zip(first_value, last_value, strict=True)),
            )
        if maximum_value_delta > 1e-7 or maximum_tangent_delta > 1e-6:
            raise RuntimeError(
                f"Periodic animation {name} has a loop seam: value delta {maximum_value_delta}, "
                f"tangent delta {maximum_tangent_delta}"
            )
        evidence[name] = {
            "samples": maximum_samples,
            "startSeconds": round(start_time, 6),
            "endSeconds": round(end_time, 6),
            "endpointValueMaxDelta": maximum_value_delta,
            "endpointTangentMaxDelta": maximum_tangent_delta,
        }
    return evidence


def glb_triangle_count(document: dict[str, object]) -> int:
    accessors = document.get("accessors", [])
    total = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4:
                continue
            accessor_index = primitive.get("indices")
            if accessor_index is None:
                accessor_index = primitive.get("attributes", {}).get("POSITION")
            if isinstance(accessor_index, int) and accessor_index < len(accessors):
                total += int(accessors[accessor_index].get("count", 0)) // 3
    return total


def validate_glb(
    output: Path,
    profile: str,
    asset: str,
    target_triangles: int,
    texture_size: int,
) -> dict[str, object]:
    document, payload, binary_chunk = parse_glb(output)
    triangles = glb_triangle_count(document)
    meshes = len(document.get("meshes", []))
    skins = len(document.get("skins", []))
    materials = len(document.get("materials", []))
    material_names = [material.get("name", "") for material in document.get("materials", [])]
    textures = len(document.get("textures", []))
    image_dimensions = glb_image_dimensions(document, binary_chunk)
    loop_endpoint_evidence = validate_periodic_animation_endpoints(document, binary_chunk)
    animation_names = [animation.get("name", "") for animation in document.get("animations", [])]
    node_names = {node.get("name", "") for node in document.get("nodes", [])}
    extensions = sorted(set(document.get("extensionsUsed", [])) | set(document.get("extensionsRequired", [])))
    forbidden = {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu", "EXT_texture_webp"}

    if meshes < 1 or triangles <= 0:
        raise RuntimeError("Runtime GLB lost its visible mesh geometry")
    if triangles > target_triangles:
        raise RuntimeError(f"Runtime GLB exceeds triangle budget: {triangles} > {target_triangles}")
    if textures > MAX_TEXTURES:
        raise RuntimeError(f"Runtime GLB exceeds texture budget: {textures} > {MAX_TEXTURES}")
    oversized_images = [
        image for image in image_dimensions if max(int(image["width"]), int(image["height"])) > texture_size
    ]
    if oversized_images:
        raise RuntimeError(f"Runtime GLB contains textures above --texture-size {texture_size}: {oversized_images}")
    if forbidden.intersection(extensions):
        raise RuntimeError(f"Runtime GLB requires unsupported extensions: {sorted(forbidden.intersection(extensions))}")

    expected_clips = list(PROFILE_CLIPS[profile])
    animated = profile in ANIMATED_PROFILES
    if animated:
        if skins != 1:
            raise RuntimeError(f"Animated GLB must contain exactly one skin; found {skins}")
        missing = [clip for clip in expected_clips if clip not in animation_names]
        if missing:
            raise RuntimeError(f"Animated GLB is missing clips: {', '.join(missing)}")
        if profile == "hero":
            missing_sockets = [name for name in ("Head", "Face", "Back", "Camera") if name not in node_names]
            if missing_sockets:
                raise RuntimeError(f"Hero GLB is missing attachment sockets: {', '.join(missing_sockets)}")
            missing_materials = [name for name in HERO_SKIN_MATERIALS if name not in material_names]
            if missing_materials:
                raise RuntimeError(f"Hero GLB is missing semantic store-skin materials: {', '.join(missing_materials)}")
    elif skins or animation_names:
        raise RuntimeError("Static prop GLB unexpectedly contains a skin or animation")

    root_node_indices = {
        index
        for index, node in enumerate(document.get("nodes", []))
        if node.get("name") in {"Root", f"{asset}_Armature"}
    }
    root_translation_channels: list[dict[str, object]] = []
    for animation in document.get("animations", []):
        for channel in animation.get("channels", []):
            target = channel.get("target", {})
            if target.get("path") == "translation" and target.get("node") in root_node_indices:
                root_translation_channels.append({"animation": animation.get("name", ""), "node": target.get("node")})
    if root_translation_channels:
        raise RuntimeError(f"Runtime clips contain forbidden world-root translation: {root_translation_channels}")

    byte_budget = int(PROFILE_TARGETS[profile]["byteBudget"])
    if len(payload) > byte_budget:
        raise RuntimeError(
            f"Runtime GLB exceeds byte budget: {len(payload) / 1024 / 1024:.2f} MiB > "
            f"{byte_budget / 1024 / 1024:.2f} MiB"
        )
    return {
        "format": "GLB 2.0",
        "fileBytes": len(payload),
        "sha256": sha256_file(output),
        "meshes": meshes,
        "triangles": triangles,
        "materials": materials,
        "materialNames": material_names,
        "textures": textures,
        "imageDimensions": image_dimensions,
        "periodicAnimationEndpoints": loop_endpoint_evidence,
        "skins": skins,
        "animations": animation_names,
        "nodes": len(document.get("nodes", [])),
        "extensionsUsed": extensions,
        "compression": "none",
        "rootTranslationChannels": root_translation_channels,
        "requiredSockets": [name for name in ("Head", "Face", "Back", "Camera") if name in node_names],
    }


def validate_args(args: argparse.Namespace) -> tuple[Path, Path, Path, Path | None]:
    input_path = args.input.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    report_path = (args.report or output_path.with_suffix(".report.json")).expanduser().resolve()
    blend_path = args.save_blend.expanduser().resolve() if args.save_blend else None
    if not input_path.is_file():
        raise FileNotFoundError(f"Input GLB not found: {input_path}")
    if input_path.suffix.lower() != ".glb" or output_path.suffix.lower() != ".glb":
        raise ValueError("--input and --output must be .glb files")
    if report_path.suffix.lower() != ".json":
        raise ValueError("--report must be a .json file")
    if blend_path and blend_path.suffix.lower() != ".blend":
        raise ValueError("--save-blend must be a .blend file")
    named_paths = [
        ("Meshy source", input_path),
        ("runtime GLB", output_path),
        ("JSON report", report_path),
        *(([("working Blend", blend_path)]) if blend_path else []),
    ]
    seen: dict[Path, str] = {}
    for label, path in named_paths:
        if path in seen:
            raise ValueError(f"Path collision: {label} and {seen[path]} both resolve to {path}")
        seen[path] = label
    if not args.asset or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in args.asset):
        raise ValueError("--asset must use lowercase kebab-case letters, digits, and hyphens")
    if args.target_triangles < 100:
        raise ValueError("--target-triangles must be at least 100")
    if args.texture_size < 128 or args.texture_size > 2048:
        raise ValueError("--texture-size must be between 128 and 2048")
    protected = [output_path, report_path, *( [blend_path] if blend_path else [] )]
    if not args.force:
        existing = [path for path in protected if path and path.exists()]
        if existing:
            raise FileExistsError("Refusing to replace outputs without --force:\n  " + "\n  ".join(map(str, existing)))
    return input_path, output_path, report_path, blend_path


def main() -> None:
    args = parse_args()
    input_path, output_path, report_path, blend_path = validate_args(args)
    animated = args.profile in ANIMATED_PROFILES

    reset_scene()
    mesh, source_counts = import_and_join_mesh(input_path, args.asset)
    source_bounds = mesh_bounds(mesh)
    source_triangles = triangle_count([mesh])
    anatomy_report = correct_hero_anatomy(mesh, args.profile, args.asset)
    geometry_repair = repair_geometry(mesh, args.profile, args.asset)
    geometry_budget = decimate_and_triangulate(mesh, args.target_triangles)
    normalization = orient_and_normalize(mesh, args.profile, args.asset)
    compensate_hero_cross_section(mesh, anatomy_report, normalization)
    material_report = tune_materials(mesh, args.asset)
    image_report = resize_and_pack_images(mesh, args.texture_size)

    rig: RigResult | None = None
    skin_report: dict[str, object] | None = None
    clip_report: list[dict[str, object]] = []
    if animated:
        rig = create_rig(mesh, args.profile, args.asset)
        skin_report = assign_skin_weights(mesh, rig, args.profile)
        clip_report = create_animations(rig.armature, rig, args.profile)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    if blend_path:
        blend_path.parent.mkdir(parents=True, exist_ok=True)

    transaction_id = uuid.uuid4().hex

    def transaction_path(path: Path) -> Path:
        return path.with_name(f".{path.stem}.{transaction_id}.tmp{path.suffix}")

    temporary_output = transaction_path(output_path)
    temporary_report = transaction_path(report_path)
    temporary_blend = transaction_path(blend_path) if blend_path else None
    temporary_paths = [temporary_output, temporary_report, *([temporary_blend] if temporary_blend else [])]

    try:
        export_glb(temporary_output, mesh, rig.armature if rig else None, animated)
        validation = validate_glb(
            temporary_output,
            args.profile,
            args.asset,
            args.target_triangles,
            args.texture_size,
        )
        if temporary_blend:
            bpy.ops.wm.save_as_mainfile(filepath=str(temporary_blend))

        final_bounds = mesh_bounds(mesh)
        report = {
        "generatedAt": utc_now(),
        "pipeline": "Meshy textured low-poly master -> Blender 4.5 cleanup, custom rig/animation, and standard GLB",
        "blenderVersion": bpy.app.version_string,
        "asset": args.asset,
        "profile": args.profile,
        "source": {
            "file": str(input_path),
            "sha256": sha256_file(input_path),
            "fileBytes": input_path.stat().st_size,
            "counts": source_counts,
            "triangles": source_triangles,
            "bounds": source_bounds.to_json(),
        },
        "output": {
            "file": output_path.name,
            "path": str(output_path),
            "report": str(report_path),
            "workingBlend": str(blend_path) if blend_path else None,
            "targetTriangles": args.target_triangles,
            "textureMaxSize": args.texture_size,
            "blenderBounds": final_bounds.to_json(),
            "runtimeBounds": blender_to_gltf_bounds(final_bounds).to_json(),
            "triangles": validation["triangles"],
            "materials": validation["materials"],
            "textures": validation["textures"],
            "skins": validation["skins"],
            "clips": validation["animations"],
            "fileBytes": validation["fileBytes"],
            "sha256": validation["sha256"],
        },
        "geometry": {
            "repair": geometry_repair,
            "budget": geometry_budget,
            "anatomy": anatomy_report,
        },
        "normalization": normalization,
        "materials": material_report,
        "images": image_report,
        "rig": None
        if not rig
        else {
            "armatures": 1,
            "skins": validation["skins"],
            "bones": len(rig.armature.data.bones),
            "deformBones": rig.deform_bones,
            "bodyBones": rig.body_bones,
            "appendageBones": rig.appendage_bones,
            "sockets": rig.sockets,
            "weights": skin_report,
            "worldRootTranslation": False,
        },
        "clips": clip_report,
        "features": {
            "animated": animated,
            "skin": animated,
            "worldRootTranslation": False,
            "forward": "-Z",
            "up": "+Y",
            "draco": False,
            "meshopt": False,
            "ktx2": False,
            "webpTextures": False,
            "validatedFor": "Three.js r128 GLTFLoader",
        },
        "validation": validation,
        }
        with temporary_report.open("w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2)
            handle.write("\n")

        # The prior known-good GLB is untouched until export and validation
        # both succeed. Each final replacement is atomic on the same volume.
        os.replace(temporary_output, output_path)
        if temporary_blend and blend_path:
            os.replace(temporary_blend, blend_path)
        os.replace(temporary_report, report_path)
    finally:
        for temporary in temporary_paths:
            temporary.unlink(missing_ok=True)
    print(json.dumps({"asset": args.asset, "output": str(output_path), "report": str(report_path), "validation": validation}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
