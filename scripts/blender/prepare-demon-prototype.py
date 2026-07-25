#!/usr/bin/env python3
"""Polish one Meshy-rigged demon prototype for the Three.js r128 mansion.

Run through Blender, not the system Python:

    blender --background --factory-startup \
      --python scripts/blender/prepare-demon-prototype.py -- \
      --input assets/models/mr-feast/source/demon-prototypes/meshy/pale-maw-rigged.glb \
      --output assets/models/mr-feast/demon-prototypes/pale-maw.glb \
      --slug pale-maw --target-height 2.18 --preview-dir output/iterate/demon-prototypes \
      --save-blend assets/models/mr-feast/source/demon-prototypes/blender/pale-maw.blend

The runtime GLB keeps the Meshy humanoid skeleton and skin, removes embedded
animation, normalizes scale and grounding, rebuilds smooth organic shading,
caps texture resolution, and records a reproducible browser-budget report.
Raw masters and editable Blender files remain in the ignored source tree.
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
    parser.add_argument("--slug", required=True, choices=("pale-maw", "banquet-saint"))
    parser.add_argument("--target-height", required=True, type=float)
    parser.add_argument("--target-triangles", type=int, default=30_000)
    parser.add_argument("--texture-size", type=int, default=768)
    parser.add_argument("--preview-dir", type=Path)
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
        raise RuntimeError("The imported demon contains no mesh bounds")
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
    # Blender converts glTF Y-up into Z-up. Keep skinned meshes as scene roots
    # and apply one common world-space transform to every imported root.
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
        raise RuntimeError("The imported demon has invalid height")
    scale = target_height / height
    center_x = (minimum.x + maximum.x) * 0.5
    center_y = (minimum.y + maximum.y) * 0.5
    normalization = (
        Matrix.Translation(Vector((-center_x * scale, -center_y * scale, -minimum.z * scale)))
        @ Matrix.Scale(scale, 4)
    )
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
    ratio = max(0.04, min(1.0, target_triangles / source_triangles))
    warnings: list[str] = []
    for mesh in meshes:
        if mesh.data.shape_keys:
            warnings.append(f"Skipped {mesh.name}: shape keys would be destroyed")
            continue
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        modifier = mesh.modifiers.new(name="Demon_Game_Decimate", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        move_modifier_to_front(mesh, modifier.name)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return warnings


def smooth_skinned_meshes(meshes: list[bpy.types.Object]) -> dict[str, int | float]:
    smoothed = 0
    welded = 0
    for mesh in meshes:
        if not any(modifier.type == "ARMATURE" for modifier in mesh.modifiers):
            continue
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
        smoothed += len(mesh.data.polygons)
    return {
        "smoothPolygons": smoothed,
        "weldedVertices": welded,
        "weldDistanceMeters": NORMAL_WELD_DISTANCE_METERS,
    }


def rename_and_polish_assets(
    slug: str,
    meshes: list[bpy.types.Object],
) -> tuple[list[str], list[str]]:
    prefix = "Demon_" + "_".join(part.title() for part in slug.split("-"))
    for index, mesh in enumerate(sorted(meshes, key=lambda item: item.name), start=1):
        mesh.name = f"{prefix}_Mesh_{index:02d}"
        mesh.data.name = f"{prefix}_Geometry_{index:02d}"
    materials = sorted(
        {material for mesh in meshes for material in mesh.data.materials if material},
        key=lambda material: material.name,
    )
    for index, material in enumerate(materials, start=1):
        material.name = f"{prefix}_Material_{index:02d}"
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        if hasattr(material, "use_transparency_overlap"):
            material.use_transparency_overlap = False
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
                roughness_floor = 0.62 if slug == "pale-maw" else 0.48
                roughness.default_value = max(float(roughness.default_value), roughness_floor)
            if metallic and not metallic.is_linked:
                metallic_ceiling = 0.08 if slug == "pale-maw" else 0.42
                metallic.default_value = min(float(metallic.default_value), metallic_ceiling)
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
        raise RuntimeError("Blender failed to export the demon GLB")


def aim_camera(camera: bpy.types.Object, target: Vector) -> None:
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def make_preview_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = 0.86
    return material


def render_previews(
    slug: str,
    meshes: list[bpy.types.Object],
    bounds: tuple[Vector, Vector],
    preview_dir: Path,
) -> list[str]:
    preview_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.world.color = (0.008, 0.01, 0.016)
    scene.view_settings.look = "AgX - Medium High Contrast"

    minimum, maximum = bounds
    height = maximum.z - minimum.z
    center = Vector((0, 0, minimum.z + height * 0.5))

    bpy.ops.mesh.primitive_plane_add(size=max(7, height * 4), location=(0, 0, -0.006))
    floor = bpy.context.object
    floor.name = "Demon_Preview_Floor"
    floor.data.materials.append(make_preview_material("Demon_Preview_Floor_Material", (0.018, 0.021, 0.026, 1)))

    bpy.ops.object.light_add(type="AREA", location=(-height * 1.5, -height * 1.2, height * 1.8))
    key = bpy.context.object
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = height * 1.25
    key.data.color = (0.68, 0.78, 1.0)
    aim_camera(key, center)

    bpy.ops.object.light_add(type="AREA", location=(height * 1.2, height * 0.7, height * 1.25))
    rim = bpy.context.object
    rim.data.energy = 760
    rim.data.size = height
    rim.data.color = (1.0, 0.48, 0.27)
    aim_camera(rim, center)

    bpy.ops.object.light_add(type="AREA", location=(0, -height * 0.2, height * 2.2))
    top = bpy.context.object
    top.data.energy = 520
    top.data.size = height * 0.7
    aim_camera(top, center)

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.lens = 58
    scene.camera = camera
    distance = height * 2.15
    views = {
        "front": Vector((0, -distance, center.z + height * 0.02)),
        "right": Vector((distance, 0, center.z + height * 0.02)),
        "back": Vector((0, distance, center.z + height * 0.02)),
    }
    output_files: list[str] = []
    for label, location in views.items():
        camera.location = location
        aim_camera(camera, center)
        output_path = preview_dir / f"{slug}-neutral-{label}.png"
        scene.render.filepath = str(output_path)
        bpy.ops.render.render(write_still=True)
        output_files.append(str(output_path))

    # Keep the editable file focused on the asset; preview-only objects should
    # never be selected for the runtime export.
    for obj in (floor, key, rim, top, camera):
        obj.hide_render = True
    select_only(meshes)
    return output_files


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
        raise FileExistsError("Refusing to replace demon outputs without --force")
    if not input_path.is_file():
        raise FileNotFoundError(f"Input GLB not found: {input_path}")
    if args.target_height <= 0 or not math.isfinite(args.target_height):
        raise ValueError("--target-height must be positive and finite")
    if args.target_triangles < 1_000:
        raise ValueError("--target-triangles must be at least 1000")
    if args.texture_size < 128 or args.texture_size > 1024:
        raise ValueError("--texture-size must be between 128 and 1024")

    reset_scene()
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    exportable = [obj for obj in imported if is_exportable(obj)]
    meshes = [obj for obj in exportable if obj.type == "MESH"]
    armatures = [obj for obj in exportable if obj.type == "ARMATURE"]
    if not meshes:
        raise RuntimeError("The demon contains no exportable mesh")
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one humanoid armature, found {len(armatures)}")
    skinned_meshes = [
        mesh for mesh in meshes
        if any(modifier.type == "ARMATURE" for modifier in mesh.modifiers)
    ]
    if not skinned_meshes:
        raise RuntimeError("The demon mesh is not skinned")

    # Runtime clips are separate files. A clean bind model avoids duplicate
    # animation payloads and prevents an imported action from winning on load.
    for armature in armatures:
        armature.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    bpy.context.scene.frame_set(0)

    normalization_scale, source_bounds = normalize_roots(exportable, meshes, args.target_height)
    mesh_names, material_names = rename_and_polish_assets(args.slug, meshes)
    source_triangles = triangle_count(meshes)
    warnings = decimate(meshes, args.target_triangles)
    shading = smooth_skinned_meshes(meshes)
    images = resize_and_pack_images(args.texture_size)
    final_triangles = triangle_count(meshes)
    final_bounds = world_bounds(meshes)
    height = final_bounds[1].z - final_bounds[0].z
    ground_y = final_bounds[0].z
    bone_count = len(armatures[0].data.bones)
    max_texture_dimension = max(
        (max(int(image["width"]), int(image["height"])) for image in images),
        default=0,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_glb(output_path, exportable)
    preview_files: list[str] = []
    if args.preview_dir:
        preview_files = render_previews(
            args.slug,
            meshes,
            final_bounds,
            args.preview_dir.expanduser().resolve(),
        )
    if args.save_blend:
        blend_path = args.save_blend.expanduser().resolve()
        blend_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pipeline": "approved concept -> Meshy image-to-3D -> Meshy auto-rig -> Blender 4.5 demon browser preparation",
        "blenderVersion": bpy.app.version_string,
        "source": str(input_path),
        "output": output_path.name,
        "slug": args.slug,
        "rigged": True,
        "boneCount": bone_count,
        "skinnedMeshCount": len(skinned_meshes),
        "normalizationStrategy": "baked-scene-roots",
        "normalizationScale": normalization_scale,
        "targetHeightMeters": args.target_height,
        "height": round(float(height), 6),
        "groundY": round(float(ground_y), 6),
        "targetTriangles": args.target_triangles,
        "triangles": final_triangles,
        "textureMaxSize": args.texture_size,
        "maxTextureDimension": max_texture_dimension,
        "sourceBounds": {"min": vector_list(source_bounds[0]), "max": vector_list(source_bounds[1])},
        "boundsMin": vector_list(final_bounds[0]),
        "boundsMax": vector_list(final_bounds[1]),
        "fileBytes": output_path.stat().st_size,
        "sourceTriangles": source_triangles,
        "meshes": mesh_names,
        "materials": material_names,
        "images": images,
        "warnings": warnings,
        "shading": shading,
        "previews": preview_files,
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
