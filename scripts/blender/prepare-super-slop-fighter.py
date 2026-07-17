#!/usr/bin/env python3
"""Prepare and render one Meshy-rigged Super Slop Brothers fighter.

This script is intentionally run by Blender 4.5 in background mode, not by the
system Python.  It keeps the reusable rig and the browser sprite render in one
verified pipeline so the two artifacts cannot silently drift apart.

Example:

    blender --background --factory-startup \
      --python scripts/blender/prepare-super-slop-fighter.py -- \
      --fighter rainbot \
      --base assets/models/super-slop-brothers/source/rainbot-rigged.glb \
      --run assets/models/super-slop-brothers/source/rainbot-run.glb \
      --idle assets/models/super-slop-brothers/animations/rainbot-idle.glb \
      --hit assets/models/super-slop-brothers/animations/rainbot-hit.glb \
      --special-neutral assets/models/super-slop-brothers/animations/rainbot-special-neutral.glb \
      --special-side assets/models/super-slop-brothers/animations/rainbot-special-side.glb \
      --special-up assets/models/super-slop-brothers/animations/rainbot-special-up.glb \
      --special-down assets/models/super-slop-brothers/animations/rainbot-special-down.glb \
      --output-dir assets/models/super-slop-brothers/processed \
      --frames-dir output/blender/super-slop-brothers/rainbot \
      --force

The processed GLB contains the cleaned mesh, armature, and skin but deliberately
contains no animation clips.  The source actions are sampled into thirteen
eight-frame RGBA rows for the existing Canvas2D runtime.  Root translation is
removed on all three axes before sampling because the Canvas physics layer owns
world-space horizontal and vertical displacement.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Matrix, Vector


FRAME_SIZE = 192
FRAMES_PER_CLIP = 8
TARGET_HEIGHT_METERS = 1.8
MAX_PROCESSED_RIG_BYTES = 15 * 1024 * 1024

CAMERA_LOCATION = Vector((4.2, -7.0, 3.35))
CAMERA_TARGET = Vector((0.0, 0.0, 0.94))
CAMERA_ORTHO_SCALE = 3.3

SOURCE_MOTION_NAMES = (
    "run",
    "idle",
    "hit",
    "special-neutral",
    "special-side",
    "special-up",
    "special-down",
)


@dataclass(frozen=True)
class ClipSpec:
    name: str
    row: int
    source_motion: str
    samples: tuple[float, ...]
    derived: bool
    loop: bool
    derivation: str


def linear_samples(*, loop: bool = False) -> tuple[float, ...]:
    divisor = FRAMES_PER_CLIP if loop else FRAMES_PER_CLIP - 1
    return tuple(index / divisor for index in range(FRAMES_PER_CLIP))


# The four combat fundamentals are intentionally derived from the available
# fighter-specific Meshy motions.  This retains each fighter's body language
# instead of falling back to generic procedural bone rotations.
CLIP_SPECS = (
    ClipSpec("idle", 0, "idle", linear_samples(loop=True), False, True, "direct looping source motion"),
    ClipSpec("run", 1, "run", linear_samples(loop=True), False, True, "direct looping source motion"),
    ClipSpec(
        "jump",
        2,
        "special-up",
        (0.00, 0.08, 0.17, 0.27, 0.36, 0.44, 0.50, 0.56),
        True,
        False,
        "launch and ascent phase of special-up",
    ),
    ClipSpec(
        "fall",
        3,
        "special-up",
        (0.56, 0.64, 0.71, 0.78, 0.85, 0.91, 0.96, 1.00),
        True,
        True,
        "apex and descent phase of special-up",
    ),
    ClipSpec("hit", 4, "hit", linear_samples(), False, False, "direct source motion"),
    ClipSpec(
        "shield",
        5,
        "special-down",
        (0.00, 0.10, 0.20, 0.30, 0.38, 0.38, 0.34, 0.28),
        True,
        True,
        "anticipation and held brace from special-down",
    ),
    ClipSpec(
        "dodge",
        6,
        "special-side",
        (0.00, 0.09, 0.20, 0.34, 0.49, 0.64, 0.79, 0.92),
        True,
        False,
        "fast displacement pose sequence from special-side",
    ),
    ClipSpec(
        "grab",
        7,
        "special-neutral",
        (0.00, 0.07, 0.15, 0.25, 0.37, 0.50, 0.64, 0.78),
        True,
        False,
        "reach and hold phase from special-neutral",
    ),
    ClipSpec("attack", 8, "special-side", linear_samples(), True, False, "full special-side strike used as normal attack"),
    ClipSpec("special-neutral", 9, "special-neutral", linear_samples(), False, False, "direct source motion"),
    ClipSpec("special-side", 10, "special-side", linear_samples(), False, False, "direct source motion"),
    ClipSpec("special-up", 11, "special-up", linear_samples(), False, False, "direct source motion"),
    ClipSpec("special-down", 12, "special-down", linear_samples(), False, False, "direct source motion"),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fighter", required=True, help="Stable fighter id, for example rainbot")
    parser.add_argument("--base", required=True, type=Path, help="Meshy rigged character GLB")
    for source_name in SOURCE_MOTION_NAMES:
        parser.add_argument(f"--{source_name}", required=True, type=Path, dest=source_name.replace("-", "_"))
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--frames-dir", required=True, type=Path)
    parser.add_argument("--output-rig", type=Path, help="Override <output-dir>/<fighter>-rigged.glb")
    parser.add_argument("--report", type=Path, help="Override <output-dir>/<fighter>-blender-report.json")
    parser.add_argument("--target-height", type=float, default=TARGET_HEIGHT_METERS)
    parser.add_argument("--texture-size", type=int, default=1_024)
    parser.add_argument("--save-blend", type=Path, help="Optional ignored working file for manual review")
    parser.add_argument("--force", action="store_true", help="Replace this fighter's prior outputs")
    return parser.parse_args(argv)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def display_path(path: Path) -> str:
    resolved = path.expanduser().resolve()
    try:
        return resolved.relative_to(repo_root()).as_posix()
    except ValueError:
        return str(resolved)


def vector_list(value: Vector) -> list[float]:
    return [round(float(component), 6) for component in value]


def reset_scene() -> None:
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


def import_gltf(path: Path) -> tuple[list[bpy.types.Object], list[bpy.types.Action]]:
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    requested = {
        "filepath": str(path),
        "disable_bone_shape": True,
        "guess_original_bind_pose": True,
        "import_scene_as_collection": False,
        "import_select_created_objects": True,
    }
    available = set(bpy.ops.import_scene.gltf.get_rna_type().properties.keys())
    result = bpy.ops.import_scene.gltf(**{key: value for key, value in requested.items() if key in available})
    if "FINISHED" not in result:
        raise RuntimeError(f"Blender could not import {path}")
    return (
        [obj for obj in bpy.data.objects if obj not in before_objects],
        [action for action in bpy.data.actions if action not in before_actions],
    )


def is_importer_helper(obj: bpy.types.Object) -> bool:
    return any(collection.name == "glTF_not_exported" for collection in obj.users_collection)


def remove_objects(objects: Iterable[bpy.types.Object]) -> None:
    for obj in list(objects):
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)


def purge_unused_import_data() -> None:
    # Order matters: meshes own material slots, and materials own image nodes.
    for collection in (
        bpy.data.meshes,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def world_bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    if not points:
        raise RuntimeError("The base GLB contains no mesh bounds")
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def triangle_count(meshes: list[bpy.types.Object]) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            total += len(mesh.loop_triangles)
        finally:
            evaluated.to_mesh_clear()
    return total


def clear_armature_animation(armature: bpy.types.Object) -> None:
    armature.animation_data_clear()
    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()


def prepare_base_rig(
    fighter_id: str,
    imported: list[bpy.types.Object],
    target_height: float,
) -> tuple[bpy.types.Object, list[bpy.types.Object], dict[str, object]]:
    armatures = [obj for obj in imported if obj.type == "ARMATURE" and not is_importer_helper(obj)]
    meshes = [obj for obj in imported if obj.type == "MESH" and not is_importer_helper(obj)]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected exactly one exportable armature; found {len(armatures)}")
    if not meshes:
        raise RuntimeError("The base GLB contains no exportable mesh")
    armature = armatures[0]

    skinned_meshes = []
    for mesh in meshes:
        armature_modifiers = [modifier for modifier in mesh.modifiers if modifier.type == "ARMATURE"]
        if armature_modifiers and any(modifier.object == armature for modifier in armature_modifiers):
            skinned_meshes.append(mesh)
    if not skinned_meshes:
        raise RuntimeError("The base GLB mesh is not skinned to its armature")
    if any(not mesh.vertex_groups for mesh in skinned_meshes):
        raise RuntimeError("At least one skinned mesh has no vertex groups")

    # Cameras, lights, custom bone shapes, and unrelated empties from the glTF
    # importer are scene baggage.  Only the armature and its render meshes are
    # retained.  Blender 4.5's glTF exporter expects the armature to remain the
    # parent of every skinned mesh, so preserve that hierarchy and normalize at
    # the armature scene root instead of baking transforms into bones or skin.
    retained = {armature, *meshes}
    remove_objects(obj for obj in imported if obj not in retained)
    clear_armature_animation(armature)
    armature.data.pose_position = "REST"

    world_matrices = {obj: obj.matrix_world.copy() for obj in [armature, *meshes]}
    armature.parent = None
    armature.matrix_world = world_matrices[armature]
    for mesh in meshes:
        mesh.parent = armature
        mesh.matrix_world = world_matrices[mesh]

    source_minimum, source_maximum = world_bounds(meshes)
    source_height = source_maximum.z - source_minimum.z
    if not math.isfinite(source_height) or source_height <= 0:
        raise RuntimeError("The base GLB has invalid or zero height")
    scale = target_height / source_height
    center = (source_minimum + source_maximum) * 0.5
    normalization = Matrix.Translation(
        Vector((-center.x * scale, -center.y * scale, -source_minimum.z * scale))
    ) @ Matrix.Scale(scale, 4)
    armature.matrix_world = normalization @ armature.matrix_world
    bpy.context.view_layer.update()

    armature.name = f"{fighter_id}_Armature"
    armature.data.name = f"{fighter_id}_Skeleton"
    for index, mesh in enumerate(sorted(meshes, key=lambda item: item.name), start=1):
        mesh.name = f"{fighter_id}_Mesh_{index:02d}"
        mesh.data.name = f"{fighter_id}_Geometry_{index:02d}"
        mesh.data.validate(verbose=False)
        for polygon in mesh.data.polygons:
            polygon.use_smooth = True

    materials = sorted(
        {material for mesh in meshes for material in mesh.data.materials if material},
        key=lambda material: material.name,
    )
    for index, material in enumerate(materials, start=1):
        material.name = f"{fighter_id}_Material_{index:02d}"
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        material.use_backface_culling = False

    armature.data.pose_position = "POSE"
    runtime_minimum, runtime_maximum = world_bounds(meshes)
    return armature, meshes, {
        "normalizationScale": scale,
        "sourceBounds": {"min": vector_list(source_minimum), "max": vector_list(source_maximum)},
        "runtimeBounds": {"min": vector_list(runtime_minimum), "max": vector_list(runtime_maximum)},
        "materials": [material.name for material in materials],
    }


def resize_images(max_size: int) -> list[dict[str, int | str]]:
    images: list[dict[str, int | str]] = []
    for image in bpy.data.images:
        if image.type not in {"IMAGE", "UV_TEST"} or not image.has_data:
            continue
        width, height = int(image.size[0]), int(image.size[1])
        if width <= 0 or height <= 0:
            continue
        if max(width, height) > max_size:
            factor = max_size / max(width, height)
            image.scale(max(1, round(width * factor)), max(1, round(height * factor)))
            image.update()
        try:
            image.pack()
        except RuntimeError:
            pass
        images.append({"name": image.name, "width": int(image.size[0]), "height": int(image.size[1])})
    return images


def select_only(objects: Iterable[bpy.types.Object]) -> None:
    objects = list(objects)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next((obj for obj in objects if obj.type == "ARMATURE"), objects[0])


def export_processed_rig(path: Path, armature: bpy.types.Object, meshes: list[bpy.types.Object]) -> None:
    select_only([armature, *meshes])
    requested = {
        "filepath": str(path),
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_animations": False,
        "export_skins": True,
        "export_morph": True,
        "export_cameras": False,
        "export_lights": False,
        "export_draco_mesh_compression_enable": False,
        "export_use_gltfpack": False,
        "export_apply": False,
        "export_def_bones": False,
        "export_leaf_bone": False,
    }
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    result = bpy.ops.export_scene.gltf(**{key: value for key, value in requested.items() if key in available})
    if "FINISHED" not in result or not path.is_file():
        raise RuntimeError(f"Blender did not produce the processed rig: {path}")


def inspect_glb(path: Path) -> dict[str, int]:
    with path.open("rb") as handle:
        header = handle.read(12)
        if len(header) != 12:
            raise RuntimeError(f"Processed rig is not a complete GLB: {path}")
        magic, version, total_length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or total_length != path.stat().st_size:
            raise RuntimeError(f"Processed rig has an invalid GLB header: {path}")
        document = None
        while handle.tell() < total_length:
            chunk_header = handle.read(8)
            if len(chunk_header) != 8:
                raise RuntimeError(f"Processed rig has a truncated GLB chunk: {path}")
            chunk_length, chunk_type = struct.unpack("<II", chunk_header)
            payload = handle.read(chunk_length)
            if chunk_type == 0x4E4F534A:
                document = json.loads(payload.decode("utf-8").rstrip(" \t\r\n\0"))
        if document is None:
            raise RuntimeError("Processed rig GLB has no JSON document")
    result = {
        "meshes": len(document.get("meshes", [])),
        "skins": len(document.get("skins", [])),
        "animations": len(document.get("animations", [])),
        "nodes": len(document.get("nodes", [])),
    }
    if result["meshes"] < 1 or result["skins"] < 1:
        raise RuntimeError(f"Processed GLB lost its mesh or skin: {result}")
    if result["animations"] != 0:
        raise RuntimeError(f"Processed GLB unexpectedly contains animation clips: {result}")
    return result


def action_fcurves(action: bpy.types.Action) -> Iterable[bpy.types.FCurve]:
    # Blender 4.5's imported glTF Actions are layered, but Action.fcurves is a
    # compatibility view over the active slot and is stable for this use case.
    return action.fcurves


def root_bone_name(armature: bpy.types.Object) -> str:
    for candidate in ("Hips", "hips", "Root", "root", "mixamorig:Hips"):
        if candidate in armature.data.bones:
            return candidate
    roots = [bone.name for bone in armature.data.bones if bone.parent is None]
    if not roots:
        raise RuntimeError("The imported armature has no root bone")
    return roots[0]


def strip_root_translation(action: bpy.types.Action, bone_name: str) -> list[dict[str, object]]:
    bone_location_path = f'pose.bones["{bone_name}"].location'
    stripped: list[dict[str, object]] = []
    for fcurve in action_fcurves(action):
        if fcurve.data_path not in {bone_location_path, "location"} or fcurve.array_index not in {0, 1, 2}:
            continue
        if not fcurve.keyframe_points:
            continue
        original_values = [float(point.co[1]) for point in fcurve.keyframe_points]
        source_start_value = float(fcurve.evaluate(float(action.frame_range[0])))
        # Every source action must share one in-place origin.  Anchoring each
        # clip to its own first key removes drift but still makes the rendered
        # character shift between rows—and can double Canvas-owned jumps—
        # because Meshy actions carry different baked offsets.  Pose-bone
        # location zero is the armature's neutral/rest anchor and keeps all
        # thirteen rows camera- and physics-consistent.
        anchored_value = 0.0
        for point in fcurve.keyframe_points:
            point.co[1] = anchored_value
            point.handle_left[1] = anchored_value
            point.handle_right[1] = anchored_value
        fcurve.update()
        stripped.append(
            {
                "dataPath": fcurve.data_path,
                "axis": "xyz"[fcurve.array_index],
                "anchoredValue": anchored_value,
                "sourceStartValue": source_start_value,
                "removedRange": max(original_values) - min(original_values),
            }
        )
    return stripped


def import_motion(
    motion_name: str,
    path: Path,
    base_armature: bpy.types.Object,
    base_meshes: list[bpy.types.Object],
) -> tuple[bpy.types.Action, dict[str, object]]:
    imported_objects, imported_actions = import_gltf(path)
    source_armatures = [obj for obj in imported_objects if obj.type == "ARMATURE" and not is_importer_helper(obj)]
    if len(source_armatures) != 1:
        remove_objects(imported_objects)
        raise RuntimeError(f"{motion_name} must contain exactly one armature; found {len(source_armatures)}")
    source_bones = {bone.name for bone in source_armatures[0].data.bones}
    base_bones = {bone.name for bone in base_armature.data.bones}
    if source_bones != base_bones:
        missing = sorted(base_bones - source_bones)
        extra = sorted(source_bones - base_bones)
        remove_objects(imported_objects)
        raise RuntimeError(f"{motion_name} skeleton mismatch; missing={missing}, extra={extra}")
    if not imported_actions:
        remove_objects(imported_objects)
        raise RuntimeError(f"{motion_name} GLB contains no animation Action")

    action = max(imported_actions, key=lambda item: float(item.frame_range[1] - item.frame_range[0]))
    action.name = f"{base_armature.name}_{motion_name}"
    action.use_fake_user = True
    for other_action in imported_actions:
        if other_action != action and other_action.users == 0:
            bpy.data.actions.remove(other_action)

    original_action_name = action.name
    source_range = [float(action.frame_range[0]), float(action.frame_range[1])]
    stripped_channels = strip_root_translation(action, root_bone_name(base_armature))
    remove_objects(imported_objects)
    purge_unused_import_data()

    # Ensure cleanup never consumed the base render objects.
    if base_armature.name not in bpy.data.objects or any(mesh.name not in bpy.data.objects for mesh in base_meshes):
        raise RuntimeError(f"Internal cleanup error while importing {motion_name}")
    return action, {
        "sourceAction": original_action_name,
        "frameRange": source_range,
        "durationFrames": source_range[1] - source_range[0],
        "rootMotion": {
            "strategy": "freeze Blender X/Y/Z root channels at common neutral zero; Canvas physics owns world displacement",
            "removedAxes": ["x", "y", "z"],
            "strippedChannels": stripped_channels,
        },
    }


def aim_object(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def create_area_light(
    name: str,
    location: tuple[float, float, float],
    target: tuple[float, float, float],
    energy: float,
    size: float,
    color: tuple[float, float, float],
) -> bpy.types.Object:
    data = bpy.data.lights.new(name=f"{name}_Data", type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    aim_object(obj, Vector(target))
    return obj


def configure_render_scene(frame_size: int) -> dict[str, object]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = frame_size
    scene.render.resolution_y = frame_size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.use_file_extension = True
    scene.render.image_settings.compression = 35
    scene.render.filepath = ""
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    world.use_nodes = True
    background = next((node for node in world.node_tree.nodes if node.type == "BACKGROUND"), None)
    if background:
        background.inputs["Color"].default_value = (0.035, 0.045, 0.07, 1.0)
        background.inputs["Strength"].default_value = 0.32
    scene.world = world

    camera_data = bpy.data.cameras.new("SuperSlop_Ortho_Camera_Data")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = CAMERA_ORTHO_SCALE
    camera_data.lens = 58
    camera = bpy.data.objects.new("SuperSlop_Ortho_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = CAMERA_LOCATION
    aim_object(camera, CAMERA_TARGET)
    scene.camera = camera

    lights = [
        create_area_light(
            "SuperSlop_Key",
            (-3.8, -4.6, 6.2),
            (0.0, 0.0, 1.0),
            900.0,
            4.0,
            (1.0, 0.80, 0.66),
        ),
        create_area_light(
            "SuperSlop_Fill",
            (4.7, -2.4, 3.5),
            (0.0, 0.0, 0.95),
            520.0,
            4.5,
            (0.45, 0.72, 1.0),
        ),
        create_area_light(
            "SuperSlop_Rim",
            (-3.0, 3.8, 5.2),
            (0.0, 0.0, 1.05),
            760.0,
            3.0,
            (1.0, 0.22, 0.62),
        ),
    ]
    return {
        "projection": "orthographic",
        "view": "front-right three-quarter",
        "location": vector_list(CAMERA_LOCATION),
        "target": vector_list(CAMERA_TARGET),
        "orthoScale": CAMERA_ORTHO_SCALE,
        "lights": [
            {
                "name": light.name,
                "type": "AREA",
                "location": vector_list(light.location),
                "energy": float(light.data.energy),
                "size": float(light.data.size),
                "color": [round(float(value), 6) for value in light.data.color],
            }
            for light in lights
        ],
        "worldStrength": 0.32,
        "colorManagement": "AgX medium-high contrast",
    }


def assign_action(armature: bpy.types.Object, action: bpy.types.Action) -> None:
    armature.animation_data_create()
    armature.animation_data.action = None
    armature.animation_data.action = action
    if action.slots:
        armature.animation_data.action_slot = action.slots[0]


def render_clips(
    fighter_id: str,
    armature: bpy.types.Object,
    actions: dict[str, bpy.types.Action],
    motion_details: dict[str, dict[str, object]],
    frames_dir: Path,
) -> list[dict[str, object]]:
    scene = bpy.context.scene
    clips: list[dict[str, object]] = []
    for spec in CLIP_SPECS:
        action = actions[spec.source_motion]
        assign_action(armature, action)
        source_start, source_end = (float(value) for value in action.frame_range)
        source_duration = max(0.000001, source_end - source_start)
        clip_dir = frames_dir / spec.name
        clip_dir.mkdir(parents=True, exist_ok=True)
        rendered_frames: list[str] = []
        sampled_frames: list[float] = []
        for frame_index, normalized_time in enumerate(spec.samples):
            sample_frame = source_start + source_duration * normalized_time
            whole_frame = math.floor(sample_frame)
            scene.frame_set(whole_frame, subframe=sample_frame - whole_frame)
            bpy.context.view_layer.update()
            output_path = clip_dir / f"frame-{frame_index:02d}.png"
            scene.render.filepath = str(output_path)
            bpy.ops.render.render(write_still=True)
            if not output_path.is_file() or output_path.stat().st_size < 256:
                raise RuntimeError(f"Render did not produce a usable frame: {output_path}")
            rendered_frames.append(display_path(output_path))
            sampled_frames.append(round(sample_frame, 6))
        clips.append(
            {
                "name": spec.name,
                "row": spec.row,
                "frames": FRAMES_PER_CLIP,
                "loop": spec.loop,
                "sourceMotion": spec.source_motion,
                "sourceFile": motion_details[spec.source_motion]["sourceFile"],
                "sourceAction": motion_details[spec.source_motion]["sourceAction"],
                "derived": spec.derived,
                "derivation": spec.derivation,
                "normalizedSamples": list(spec.samples),
                "sampledSourceFrames": sampled_frames,
                "frameStart": min(sampled_frames),
                "frameEnd": max(sampled_frames),
                "renderedFrames": rendered_frames,
            }
        )
        print(f"[Super Slop] rendered row {spec.row:02d} {spec.name} from {spec.source_motion}")
    armature.animation_data_clear()
    return clips


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_safe_outputs(paths: Iterable[Path], frames_dir: Path, force: bool) -> None:
    paths = list(paths)
    existing = [path for path in paths if path.exists()]
    existing_frames = [frames_dir / spec.name / f"frame-{index:02d}.png" for spec in CLIP_SPECS for index in range(FRAMES_PER_CLIP)]
    existing.extend(path for path in existing_frames if path.exists())
    if existing and not force:
        preview = "\n  ".join(str(path) for path in existing[:12])
        suffix = f"\n  ... and {len(existing) - 12} more" if len(existing) > 12 else ""
        raise FileExistsError(f"Refusing to replace prior outputs without --force:\n  {preview}{suffix}")
    if force:
        for path in [*paths, *existing_frames]:
            if path.is_file():
                path.unlink()


def validate_args(args: argparse.Namespace) -> tuple[Path, dict[str, Path], Path, Path, Path]:
    if bpy.app.version[:2] < (4, 5):
        raise RuntimeError(f"Blender 4.5+ is required; found {bpy.app.version_string}")
    if not bpy.app.background:
        raise RuntimeError("Run this pipeline with Blender --background")
    fighter_id = args.fighter.strip().lower()
    if not fighter_id or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for character in fighter_id):
        raise ValueError("--fighter must be a lowercase filesystem-safe id")
    args.fighter = fighter_id
    if not math.isfinite(args.target_height) or args.target_height <= 0:
        raise ValueError("--target-height must be positive and finite")
    if args.texture_size < 128 or args.texture_size > 4096:
        raise ValueError("--texture-size must be between 128 and 4096")

    base_path = args.base.expanduser().resolve()
    source_paths = {
        source_name: Path(getattr(args, source_name.replace("-", "_"))).expanduser().resolve()
        for source_name in SOURCE_MOTION_NAMES
    }
    missing = [path for path in [base_path, *source_paths.values()] if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing input GLBs:\n  " + "\n  ".join(str(path) for path in missing))
    if len({base_path, *source_paths.values()}) != 1 + len(source_paths):
        raise ValueError("Each base and motion input must be a distinct GLB")

    output_dir = args.output_dir.expanduser().resolve()
    frames_dir = args.frames_dir.expanduser().resolve()
    output_rig = (args.output_rig or output_dir / f"{fighter_id}-rigged.glb").expanduser().resolve()
    report_path = (args.report or output_dir / f"{fighter_id}-blender-report.json").expanduser().resolve()
    save_blend = args.save_blend.expanduser().resolve() if args.save_blend else None
    output_paths = [output_rig, report_path]
    if save_blend:
        output_paths.append(save_blend)
    ensure_safe_outputs(output_paths, frames_dir, args.force)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_rig.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    frames_dir.mkdir(parents=True, exist_ok=True)
    if save_blend:
        save_blend.parent.mkdir(parents=True, exist_ok=True)
    return base_path, source_paths, output_rig, report_path, frames_dir


def main() -> None:
    args = parse_args()
    base_path, source_paths, output_rig, report_path, frames_dir = validate_args(args)

    reset_scene()
    imported_base, imported_base_actions = import_gltf(base_path)
    armature, meshes, normalization = prepare_base_rig(args.fighter, imported_base, args.target_height)
    for action in imported_base_actions:
        if action.users == 0:
            bpy.data.actions.remove(action)
    images = resize_images(args.texture_size)
    triangles = triangle_count(meshes)
    export_processed_rig(output_rig, armature, meshes)
    rig_bytes = output_rig.stat().st_size
    if rig_bytes > MAX_PROCESSED_RIG_BYTES:
        raise RuntimeError(
            f"Processed rig is {rig_bytes / 1024 / 1024:.2f} MiB; "
            f"budget is {MAX_PROCESSED_RIG_BYTES / 1024 / 1024:.0f} MiB"
        )
    glb_validation = inspect_glb(output_rig)

    actions: dict[str, bpy.types.Action] = {}
    motion_details: dict[str, dict[str, object]] = {}
    for motion_name, source_path in source_paths.items():
        action, details = import_motion(motion_name, source_path, armature, meshes)
        details["sourceFile"] = display_path(source_path)
        actions[motion_name] = action
        motion_details[motion_name] = details
        print(f"[Super Slop] loaded {motion_name}: {details['frameRange']}")

    camera = configure_render_scene(FRAME_SIZE)
    clips = render_clips(args.fighter, armature, actions, motion_details, frames_dir)

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(args.save_blend.expanduser().resolve()))

    report = {
        "generatedAt": utc_now(),
        "fighterId": args.fighter,
        "pipeline": "Meshy rig and motions -> Blender 4.5 cleanup and fixed sprite render",
        "blenderVersion": bpy.app.version_string,
        "sourceFiles": {
            "base": display_path(base_path),
            **{name: display_path(path) for name, path in source_paths.items()},
        },
        "processedRig": {
            "file": display_path(output_rig),
            "fileBytes": rig_bytes,
            "sha256": file_sha256(output_rig),
            "meshCount": len(meshes),
            "armature": armature.name,
            "bones": len(armature.data.bones),
            "triangles": triangles,
            "materials": normalization["materials"],
            "images": images,
            "targetHeightMeters": args.target_height,
            "textureMaxSize": args.texture_size,
            "normalizationScale": normalization["normalizationScale"],
            "sourceBounds": normalization["sourceBounds"],
            "runtimeBounds": normalization["runtimeBounds"],
            "validation": glb_validation,
            "features": {
                "mesh": True,
                "armature": True,
                "skin": True,
                "animations": False,
                "draco": False,
                "meshopt": False,
            },
        },
        "motions": motion_details,
        "render": {
            "frameSize": FRAME_SIZE,
            "framesPerClip": FRAMES_PER_CLIP,
            "columns": FRAMES_PER_CLIP,
            "rows": len(CLIP_SPECS),
            "pixelFormat": "PNG RGBA 8-bit",
            "transparent": True,
            "engine": "BLENDER_EEVEE_NEXT",
            "framesDir": display_path(frames_dir),
            "camera": camera,
            "lighting": "fixed three-area-light rig plus fixed world fill",
        },
        "clips": clips,
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(
        f"[Super Slop] completed {args.fighter}: {len(clips)} clips, "
        f"{len(clips) * FRAMES_PER_CLIP} RGBA frames, {rig_bytes / 1024 / 1024:.2f} MiB rig"
    )
    print(json.dumps({"processedRig": display_path(output_rig), "report": display_path(report_path)}, indent=2))


if __name__ == "__main__":
    main()
