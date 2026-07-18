#!/usr/bin/env python3
"""Prepare one Meshy-rigged mansion contestant for Three.js r128.

Run through Blender 4.5, not the system Python:

    blender --background --factory-startup \
      --python scripts/blender/prepare-mansion-contestant.py -- \
      --input assets/models/mr-feast/source/contestants/mara-voss-rigged.glb \
      --output assets/models/mr-feast/contestants/mara-voss.glb \
      --slug mara-voss --target-height 1.72 --force

The output keeps the humanoid armature and skin, bakes a grounded uniform fit,
caps texture resolution, removes embedded animation, and records a reproducible
browser-budget report beside the GLB. Raw Meshy assets stay in the ignored
source directory.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector


NORMAL_WELD_DISTANCE_METERS = 1e-4


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--target-height", required=True, type=float)
    parser.add_argument("--target-triangles", type=int, default=26_000)
    parser.add_argument("--texture-size", type=int, default=512)
    parser.add_argument("--save-blend", type=Path)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


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
        bpy.data.materials,
    ):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def is_exportable(obj: bpy.types.Object) -> bool:
    return not any(collection.name == "glTF_not_exported" for collection in obj.users_collection)


def world_bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    if not points:
        raise RuntimeError("The imported contestant contains no mesh bounds")
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


def normalize_roots(
    exportable: list[bpy.types.Object],
    meshes: list[bpy.types.Object],
    target_height: float,
) -> tuple[float, tuple[Vector, Vector]]:
    # Blender imports glTF Y-up into Blender Z-up. Detach skinned meshes while
    # retaining world space because glTF requires them as scene roots.
    for mesh in meshes:
        if not any(modifier.type == "ARMATURE" for modifier in mesh.modifiers):
            continue
        world_matrix = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = world_matrix

    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(meshes)
    height = maximum.z - minimum.z
    if not math.isfinite(height) or height <= 0:
        raise RuntimeError("The imported contestant has invalid height")
    scale = target_height / height
    center_x = (minimum.x + maximum.x) * 0.5
    center_y = (minimum.y + maximum.y) * 0.5
    normalization = Matrix.Translation(Vector((-center_x * scale, -center_y * scale, -minimum.z * scale))) @ Matrix.Scale(scale, 4)
    export_set = set(exportable)
    roots = [obj for obj in exportable if obj.parent is None or obj.parent not in export_set]
    for root in roots:
        root.matrix_world = normalization @ root.matrix_world
    bpy.context.view_layer.update()
    return scale, (minimum, maximum)


def move_modifier_to_front(obj: bpy.types.Object, modifier_name: str) -> None:
    bpy.context.view_layer.objects.active = obj
    while obj.modifiers.find(modifier_name) > 0:
        bpy.ops.object.modifier_move_up(modifier=modifier_name)


def decimate(meshes: list[bpy.types.Object], target_triangles: int) -> list[str]:
    source_triangles = triangle_count(meshes)
    if source_triangles <= target_triangles:
        return []
    ratio = max(0.03, min(1.0, target_triangles / source_triangles))
    warnings: list[str] = []
    for mesh in meshes:
        if mesh.data.shape_keys:
            warnings.append(f"Skipped {mesh.name}: shape keys would be destroyed")
            continue
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        modifier = mesh.modifiers.new(name="Contestant_Game_Decimate", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        move_modifier_to_front(mesh, modifier.name)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return warnings


def smooth_skinned_meshes(meshes: list[bpy.types.Object]) -> dict[str, int]:
    """Rebuild organic character shading after destructive decimation.

    Meshy exports can contain isolated flat polygons across faces and limbs.
    Collapse decimation preserves and can amplify those split normals, which
    reads as torn or black facial geometry under the mansion's spotlights.
    Contestant bodies are organic skinned meshes, so their exported polygons
    should share smooth vertex normals; unskinned helper geometry is left
    untouched.
    """
    smoothed = 0
    flat = 0
    welded = 0
    for mesh in meshes:
        if not any(modifier.type == "ARMATURE" for modifier in mesh.modifiers):
            continue
        # glTF represents hard/split normals as duplicate vertices. Merely
        # toggling smooth polygons cannot reconnect those normals, so weld only
        # coincident duplicates before rebuilding the organic surface shading.
        edit_mesh = bmesh.new()
        edit_mesh.from_mesh(mesh.data)
        before_vertices = len(edit_mesh.verts)
        bmesh.ops.remove_doubles(
            edit_mesh,
            verts=list(edit_mesh.verts),
            dist=NORMAL_WELD_DISTANCE_METERS,
        )
        welded += before_vertices - len(edit_mesh.verts)
        edit_mesh.to_mesh(mesh.data)
        edit_mesh.free()
        for polygon in mesh.data.polygons:
            polygon.use_smooth = True
        mesh.data.update()
        smoothed += sum(1 for polygon in mesh.data.polygons if polygon.use_smooth)
        flat += sum(1 for polygon in mesh.data.polygons if not polygon.use_smooth)
    return {
        "smoothPolygons": smoothed,
        "flatPolygons": flat,
        "weldedVertices": welded,
        "weldDistanceMeters": NORMAL_WELD_DISTANCE_METERS,
    }


def rename_assets(slug: str, meshes: list[bpy.types.Object]) -> tuple[list[str], list[str]]:
    prefix = "Contestant_" + "_".join(part.title() for part in slug.split("-"))
    for index, mesh in enumerate(sorted(meshes, key=lambda item: item.name), start=1):
        mesh.name = f"{prefix}_Mesh_{index:02d}"
        mesh.data.name = f"{prefix}_Geometry_{index:02d}"
    materials = sorted(
        {material for mesh in meshes for material in mesh.data.materials if material},
        key=lambda material: material.name,
    )
    for index, material in enumerate(materials, start=1):
        material.name = f"{prefix}_Material_{index:02d}"
        material.blend_method = "OPAQUE"
        material.use_backface_culling = False
        if not material.use_nodes or not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            emission = node.inputs.get("Emission Strength")
            roughness = node.inputs.get("Roughness")
            metallic = node.inputs.get("Metallic")
            if emission:
                emission.default_value = 0.0
            if roughness and not roughness.is_linked:
                roughness.default_value = max(float(roughness.default_value), 0.55)
            if metallic and not metallic.is_linked:
                metallic.default_value = min(float(metallic.default_value), 0.35)
    return [mesh.name for mesh in meshes], [material.name for material in materials]


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
            # Embedded glTF images are lazy-loaded by Blender. Touching one
            # pixel materializes the packed PNG so image.scale() resamples it
            # instead of silently preserving the original 2K payload.
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
        images.append({"name": image.name, "width": int(image.size[0]), "height": int(image.size[1])})
    return images


def select_only(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    armature = next((obj for obj in objects if obj.type == "ARMATURE"), None)
    bpy.context.view_layer.objects.active = armature or objects[0]


def export_glb(output: Path, objects: list[bpy.types.Object]) -> None:
    select_only(objects)
    requested = {
        "filepath": str(output),
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_animations": False,
        "export_skins": True,
        "export_morph": False,
        "export_cameras": False,
        "export_lights": False,
        "export_draco_mesh_compression_enable": False,
        "export_use_gltfpack": False,
    }
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    result = bpy.ops.export_scene.gltf(**{key: value for key, value in requested.items() if key in available})
    if "FINISHED" not in result:
        raise RuntimeError("Blender failed to export the contestant GLB")


def vector_list(value: Vector) -> list[float]:
    return [round(float(component), 6) for component in value]


def main() -> None:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    report_path = output_path.with_suffix(".report.json")
    protected = [output_path, report_path]
    if args.save_blend:
        protected.append(args.save_blend.expanduser().resolve())
    if any(path.exists() for path in protected) and not args.force:
        raise FileExistsError("Refusing to replace contestant outputs without --force")
    if not input_path.is_file():
        raise FileNotFoundError(f"Input GLB not found: {input_path}")
    if args.target_height <= 0 or not math.isfinite(args.target_height):
        raise ValueError("--target-height must be positive and finite")
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
    armatures = [obj for obj in exportable if obj.type == "ARMATURE"]
    if not meshes:
        raise RuntimeError("The contestant contains no exportable mesh")
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one humanoid armature, found {len(armatures)}")
    if not any(any(modifier.type == "ARMATURE" for modifier in mesh.modifiers) for mesh in meshes):
        raise RuntimeError("The contestant mesh is not skinned")

    normalization_scale, source_bounds = normalize_roots(exportable, meshes, args.target_height)
    mesh_names, material_names = rename_assets(args.slug, meshes)
    source_triangles = triangle_count(meshes)
    warnings = decimate(meshes, args.target_triangles)
    shading = smooth_skinned_meshes(meshes)
    images = resize_and_pack_images(args.texture_size)
    final_triangles = triangle_count(meshes)
    final_bounds = world_bounds(meshes)
    bone_count = len(armatures[0].data.bones)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_glb(output_path, exportable)
    if args.save_blend:
        blend_path = args.save_blend.expanduser().resolve()
        blend_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pipeline": "Meshy textured humanoid -> Meshy auto-rig -> Blender 4.5 browser preparation",
        "blenderVersion": bpy.app.version_string,
        "source": str(input_path),
        "output": output_path.name,
        "slug": args.slug,
        "rigged": True,
        "bones": bone_count,
        "skinnedMeshes": sum(1 for mesh in meshes if any(modifier.type == "ARMATURE" for modifier in mesh.modifiers)),
        "normalizationStrategy": "baked-scene-roots",
        "normalizationScale": normalization_scale,
        "targetHeightMeters": args.target_height,
        "targetTriangles": args.target_triangles,
        "textureMaxSize": args.texture_size,
        "sourceBounds": {"min": vector_list(source_bounds[0]), "max": vector_list(source_bounds[1])},
        "game": {
            "file": output_path.name,
            "triangles": final_triangles,
            "boundsMin": vector_list(final_bounds[0]),
            "boundsMax": vector_list(final_bounds[1]),
            "fileBytes": output_path.stat().st_size,
        },
        "sourceTriangles": source_triangles,
        "meshes": mesh_names,
        "materials": material_names,
        "images": images,
        "warnings": warnings,
        "shading": shading,
        "features": {
            "animations": False,
            "skins": True,
            "draco": False,
            "meshopt": False,
            "validatedFor": "Three.js r128",
        },
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
