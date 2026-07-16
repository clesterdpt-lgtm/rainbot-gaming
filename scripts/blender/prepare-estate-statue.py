#!/usr/bin/env python3
"""Turn one Meshy statue master into a grounded browser-safe static GLB.

Run through Blender 4.5+, for example:

    blender --background --python scripts/blender/prepare-estate-statue.py -- \
      --input assets/models/mr-feast/source/statues/foyer-listening-host-master.glb \
      --output assets/models/mr-feast/statues/foyer-listening-host.glb \
      --target-height 1.72 --target-triangles 14000 --force

The output deliberately avoids Draco, Meshopt, KTX2, rigs, morph targets, and
animations because the mansion ships Three.js r128 with the plain GLTFLoader.
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
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--target-height", required=True, type=float)
    parser.add_argument("--target-triangles", type=int, default=14_000)
    parser.add_argument("--texture-size", type=int, default=1_024)
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
    ):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def world_bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    if not points:
        raise RuntimeError("The Meshy GLB contains no mesh bounds")
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


def detach_and_delete_non_meshes(meshes: list[bpy.types.Object]) -> None:
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        obj.animation_data_clear()
        if obj.data.shape_keys:
            obj.shape_key_clear()
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)

    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH":
            continue
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def normalize(meshes: list[bpy.types.Object], target_height: float) -> tuple[float, tuple[Vector, Vector]]:
    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(meshes)
    height = maximum.z - minimum.z
    if not math.isfinite(height) or height <= 0:
        raise RuntimeError("The imported statue has invalid or zero height")
    scale = target_height / height
    center_x = (minimum.x + maximum.x) * 0.5
    center_y = (minimum.y + maximum.y) * 0.5
    transform = Matrix.Translation(Vector((-center_x * scale, -center_y * scale, -minimum.z * scale))) @ Matrix.Scale(scale, 4)
    for obj in meshes:
        obj.matrix_world = transform @ obj.matrix_world
    bpy.context.view_layer.update()

    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.select_set(False)
    bpy.context.view_layer.update()
    return scale, (minimum, maximum)


def tune_materials(meshes: list[bpy.types.Object]) -> list[str]:
    materials = sorted(
        {material for obj in meshes for material in obj.data.materials if material},
        key=lambda material: material.name,
    )
    names = []
    for index, material in enumerate(materials, start=1):
        material.name = f"Estate_Statue_Material_{index:02d}"
        material.blend_method = "OPAQUE"
        material.use_backface_culling = False
        if material.use_nodes and material.node_tree:
            for node in material.node_tree.nodes:
                if node.type != "BSDF_PRINCIPLED":
                    continue
                emission_color = node.inputs.get("Emission Color") or node.inputs.get("Emission")
                emission_strength = node.inputs.get("Emission Strength")
                roughness = node.inputs.get("Roughness")
                if emission_color and not emission_color.is_linked:
                    emission_color.default_value = (0.0, 0.0, 0.0, 1.0)
                if emission_strength:
                    emission_strength.default_value = 0.0
                if roughness and not roughness.is_linked:
                    roughness.default_value = max(float(roughness.default_value), 0.48)
        names.append(material.name)
    return names


def prepare_meshes(meshes: list[bpy.types.Object], slug: str, target_triangles: int) -> tuple[int, int]:
    before = triangle_count(meshes)
    ratio = min(1.0, target_triangles / max(1, before))
    for index, obj in enumerate(sorted(meshes, key=lambda item: item.name), start=1):
        obj.name = f"{slug}_Mesh_{index:02d}"
        obj.data.name = f"{slug}_Geometry_{index:02d}"
        obj.data.validate(verbose=False)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        if ratio < 0.999:
            modifier = obj.modifiers.new(name="Estate_Statue_Decimate", type="DECIMATE")
            modifier.decimate_type = "COLLAPSE"
            modifier.ratio = max(0.05, ratio)
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        triangulate = obj.modifiers.new(name="Estate_Statue_Triangulate", type="TRIANGULATE")
        triangulate.keep_custom_normals = True
        bpy.ops.object.modifier_apply(modifier=triangulate.name)
        obj.select_set(False)
    return before, triangle_count(meshes)


def resize_images(max_size: int) -> list[dict[str, int | str]]:
    results = []
    for image in bpy.data.images:
        if image.type not in {"IMAGE", "UV_TEST"}:
            continue
        width, height = (int(image.size[0]), int(image.size[1]))
        if width <= 0 or height <= 0:
            continue
        largest = max(width, height)
        if largest > max_size:
            factor = max_size / largest
            image.scale(max(1, round(width * factor)), max(1, round(height * factor)))
            image.update()
        try:
            image.pack()
        except RuntimeError:
            pass
        results.append({"name": image.name, "width": int(image.size[0]), "height": int(image.size[1])})
    print(f"[Estate statue] prepared {len(results)} embedded texture images")
    return results


def select_only(meshes: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]


def export_glb(output: Path, meshes: list[bpy.types.Object]) -> None:
    select_only(meshes)
    requested = {
        "filepath": str(output),
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
    bpy.ops.export_scene.gltf(**{key: value for key, value in requested.items() if key in available})


def vector_list(value: Vector) -> list[float]:
    return [round(float(component), 6) for component in value]


def main() -> None:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    report_path = output_path.with_suffix(".report.json")
    if not input_path.is_file():
        raise FileNotFoundError(f"Input GLB not found: {input_path}")
    if output_path.exists() and not args.force:
        raise FileExistsError(f"Refusing to replace {output_path} without --force")
    if args.target_height <= 0 or not math.isfinite(args.target_height):
        raise ValueError("--target-height must be positive and finite")
    if args.target_triangles < 500:
        raise ValueError("--target-triangles must be at least 500")
    if args.texture_size < 128:
        raise ValueError("--texture-size must be at least 128")

    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("The Meshy GLB contains no mesh objects")
    detach_and_delete_non_meshes(meshes)
    normalization_scale, source_bounds = normalize(meshes, args.target_height)
    material_names = tune_materials(meshes)
    source_triangles, final_triangles = prepare_meshes(meshes, output_path.stem.replace("-", "_"), args.target_triangles)
    resized_images = resize_images(args.texture_size)
    final_bounds = world_bounds(meshes)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_glb(output_path, meshes)
    if args.save_blend:
        blend_path = args.save_blend.expanduser().resolve()
        blend_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pipeline": "Meshy master -> Blender 4.5 static prop cleanup -> standard GLB",
        "source": str(input_path),
        "output": output_path.name,
        "normalizationScale": normalization_scale,
        "targetHeightMeters": args.target_height,
        "targetTriangles": args.target_triangles,
        "sourceTriangles": source_triangles,
        "finalTriangles": final_triangles,
        "meshCount": len(meshes),
        "materials": material_names,
        "images": resized_images,
        "sourceBounds": {"min": vector_list(source_bounds[0]), "max": vector_list(source_bounds[1])},
        "runtimeBounds": {"min": vector_list(final_bounds[0]), "max": vector_list(final_bounds[1])},
        "fileBytes": output_path.stat().st_size,
        "features": {
            "animations": False,
            "skins": False,
            "morphTargets": False,
            "draco": False,
            "meshopt": False,
            "ktx2": False,
        },
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
