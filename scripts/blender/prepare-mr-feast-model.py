#!/usr/bin/env python3
"""Normalize and optimize a downloaded Mr. Feast GLB with Blender.

Run this script through Blender, not the system Python:

    blender --background --python scripts/blender/prepare-mr-feast-model.py -- \
      --input assets/models/mr-feast/mr-feast-rigged.glb \
      --output-dir assets/models/mr-feast/processed \
      --force

The source model is preserved as a normalized master. A second GLB is reduced
to the browser budget and its embedded textures are capped at 1024 pixels.
Rigged Meshy imports are normalized without adding a transform-bearing wrapper
above the skinned mesh, which keeps inverse bind matrices and external clips
compatible with Three.js.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Downloaded Meshy GLB")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--slug", default="mr-feast")
    parser.add_argument("--target-height", type=float, default=1.92, help="Meters")
    parser.add_argument("--target-triangles", type=int, default=65_000)
    parser.add_argument("--texture-size", type=int, default=1_024)
    parser.add_argument("--save-blend", action="store_true")
    parser.add_argument("--force", action="store_true", help="Replace prior pipeline outputs")
    return parser.parse_args(argv)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def is_exportable(obj: bpy.types.Object) -> bool:
    """Ignore Blender glTF importer helpers, including custom bone shapes."""
    return not any(collection.name == "glTF_not_exported" for collection in obj.users_collection)


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points: list[Vector] = []
    for obj in objects:
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        raise RuntimeError("The imported GLB does not contain a mesh")
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def triangle_count(objects: list[bpy.types.Object]) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            total += len(mesh.loop_triangles)
        finally:
            evaluated.to_mesh_clear()
    return total


def normalize_export_objects(
    objects: list[bpy.types.Object],
    meshes: list[bpy.types.Object],
    target_height: float,
) -> tuple[float, tuple[Vector, Vector]]:
    """Bake one uniform scene transform without wrapping a skinned mesh.

    Blender imports Meshy's skinned mesh below its armature. glTF requires a
    skinned mesh to be a scene root, so detach it while preserving world space.
    The same normalization matrix is then applied to every export scene root.
    Bone-local transforms are intentionally left untouched.
    """
    for obj in meshes:
        if not any(modifier.type == "ARMATURE" for modifier in obj.modifiers):
            continue
        world_matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world_matrix

    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(meshes)
    # Blender imports glTF's Y-up coordinates into its native Z-up space.
    current_height = maximum.z - minimum.z
    if current_height <= 0:
        raise RuntimeError("The imported GLB has zero height")

    uniform_scale = target_height / current_height
    center = (minimum + maximum) * 0.5
    normalization = (
        Matrix.Translation(
            Vector(
                (
                    -uniform_scale * center.x,
                    -uniform_scale * center.y,
                    -uniform_scale * minimum.z,
                )
            )
        )
        @ Matrix.Scale(uniform_scale, 4)
    )

    object_set = set(objects)
    roots = [obj for obj in objects if obj.parent is None or obj.parent not in object_set]
    for root in roots:
        root.matrix_world = normalization @ root.matrix_world

    bpy.context.view_layer.update()
    return uniform_scale, (minimum, maximum)


def rename_assets(meshes: list[bpy.types.Object]) -> None:
    for index, obj in enumerate(sorted(meshes, key=lambda item: item.name), start=1):
        obj.name = f"MrFeast_Mesh_{index:02d}"
        if obj.data:
            obj.data.name = f"MrFeast_Geometry_{index:02d}"
    materials = {
        material
        for obj in meshes
        for material in obj.data.materials
        if material is not None
    }
    for index, material in enumerate(sorted(materials, key=lambda item: item.name), start=1):
        material.name = f"MrFeast_Material_{index:02d}"


def select_export_objects(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    armature = next((obj for obj in objects if obj.type == "ARMATURE"), None)
    bpy.context.view_layer.objects.active = armature or objects[0]


def export_glb(path: Path, objects: list[bpy.types.Object]) -> None:
    select_export_objects(objects)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        # Meshy motions are shipped as separate, animation-only GLBs. The
        # rigged base otherwise contains a useless zero-duration clip0 action.
        export_animations=False,
    )


def move_modifier_to_front(obj: bpy.types.Object, modifier_name: str) -> None:
    bpy.context.view_layer.objects.active = obj
    while obj.modifiers.find(modifier_name) > 0:
        bpy.ops.object.modifier_move_up(modifier=modifier_name)


def decimate_meshes(meshes: list[bpy.types.Object], target_triangles: int) -> list[str]:
    current_triangles = triangle_count(meshes)
    if current_triangles <= target_triangles:
        return []

    ratio = max(0.03, min(1.0, target_triangles / current_triangles))
    warnings: list[str] = []
    for obj in meshes:
        if obj.data.shape_keys:
            warnings.append(f"Skipped {obj.name}: shape keys would be destroyed by decimation")
            continue

        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new(name="MrFeast_Game_Decimate", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        move_modifier_to_front(obj, modifier.name)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return warnings


def resize_images(max_size: int) -> list[dict[str, int | str]]:
    resized: list[dict[str, int | str]] = []
    for image in bpy.data.images:
        if image.type not in {"IMAGE", "UV_TEST"} or not image.has_data:
            continue
        width, height = image.size
        largest = max(width, height)
        if largest <= max_size or largest == 0:
            continue
        scale = max_size / largest
        new_width = max(1, round(width * scale))
        new_height = max(1, round(height * scale))
        image.scale(new_width, new_height)
        try:
            image.pack()
        except RuntimeError:
            pass
        resized.append({"name": image.name, "width": new_width, "height": new_height})
    return resized


def output_paths(args: argparse.Namespace, rigged: bool) -> tuple[Path, Path, Path, Path]:
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    master = output_dir / f"{args.slug}-master.glb"
    state = "rigged" if rigged else "unrigged"
    game = output_dir / f"{args.slug}-game-{state}.glb"
    manifest = output_dir / f"{args.slug}-model-report.json"
    blend = output_dir / f"{args.slug}-working.blend"
    return master, game, manifest, blend


def ensure_outputs_are_safe(paths: list[Path], force: bool) -> None:
    existing = [path for path in paths if path.exists()]
    if existing and not force:
        joined = "\n  ".join(str(path) for path in existing)
        raise FileExistsError(f"Refusing to replace existing outputs without --force:\n  {joined}")


def main() -> None:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"Input GLB not found: {input_path}")
    if args.target_height <= 0 or not math.isfinite(args.target_height):
        raise ValueError("--target-height must be a positive finite number")
    if args.target_triangles < 1_000:
        raise ValueError("--target-triangles must be at least 1000")
    if args.texture_size < 128:
        raise ValueError("--texture-size must be at least 128")

    reset_scene()
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    exportable = [obj for obj in imported if is_exportable(obj)]
    meshes = [obj for obj in exportable if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("The imported GLB does not contain an exportable mesh")
    rigged = any(obj.type == "ARMATURE" for obj in exportable)
    normalization_scale, source_bounds = normalize_export_objects(
        exportable,
        meshes,
        args.target_height,
    )
    rename_assets(meshes)

    master_path, game_path, report_path, blend_path = output_paths(args, rigged)
    protected_outputs = [master_path, game_path, report_path]
    if args.save_blend:
        protected_outputs.append(blend_path)
    ensure_outputs_are_safe(protected_outputs, args.force)

    master_triangles = triangle_count(meshes)
    master_bounds = world_bounds(meshes)
    export_glb(master_path, exportable)

    warnings = decimate_meshes(meshes, args.target_triangles)
    resized_images = resize_images(args.texture_size)
    game_triangles = triangle_count(meshes)
    game_bounds = world_bounds(meshes)
    export_glb(game_path, exportable)

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(input_path),
        "rigged": rigged,
        "normalizationStrategy": "baked-scene-roots",
        "normalizationScale": normalization_scale,
        "targetHeightMeters": args.target_height,
        "targetTriangles": args.target_triangles,
        "textureMaxSize": args.texture_size,
        "preNormalizationBounds": {
            "min": list(source_bounds[0]),
            "max": list(source_bounds[1]),
        },
        "master": {
            "file": master_path.name,
            "triangles": master_triangles,
            "boundsMin": list(master_bounds[0]),
            "boundsMax": list(master_bounds[1]),
        },
        "game": {
            "file": game_path.name,
            "triangles": game_triangles,
            "boundsMin": list(game_bounds[0]),
            "boundsMax": list(game_bounds[1]),
        },
        "resizedImages": resized_images,
        "warnings": warnings,
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(report, indent=2))
    if not rigged:
        print("WARNING: The optimized character is still unrigged and must not be integrated as a final NPC.")


if __name__ == "__main__":
    main()
