#!/usr/bin/env python3
"""Render an exact transparent silhouette mask from a runtime demon GLB.

Run through Blender:

    blender --background --factory-startup \
      --python scripts/blender/render-demon-silhouette.py -- \
      --input assets/models/mr-feast/demon-prototypes/banquet-saint.glb \
      --output assets/img/mr-feast/feast-father-static-silhouette.png \
      --visible-height 2.34
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=1024)
    parser.add_argument("--padding", type=float, default=1.06)
    parser.add_argument("--visible-height", type=float)
    return parser.parse_args(argv)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def world_bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points: list[Vector] = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        try:
            points.extend(evaluated.matrix_world @ vertex.co for vertex in evaluated_mesh.vertices)
        finally:
            evaluated.to_mesh_clear()
    if not points:
        raise RuntimeError("The imported model has no renderable mesh bounds")
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def black_silhouette_material() -> bpy.types.Material:
    material = bpy.data.materials.new("Exact_Model_Silhouette_Black")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    emission.inputs["Strength"].default_value = 1.0
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    material.diffuse_color = (0.0, 0.0, 0.0, 1.0)
    material.use_backface_culling = False
    return material


def aim_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"Missing input model: {input_path}")
    if args.width < 64 or args.height < 64:
        raise ValueError("Silhouette resolution must be at least 64 pixels per side")
    if args.padding < 1.0:
        raise ValueError("Silhouette padding cannot crop the model")
    if args.visible_height is not None and args.visible_height <= 0:
        raise ValueError("Visible model height must be positive")

    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("The imported GLB contains no meshes")

    material = black_silhouette_material()
    for mesh in meshes:
        mesh.data.materials.clear()
        mesh.data.materials.append(material)

    minimum, maximum = world_bounds(meshes)
    center = (minimum + maximum) * 0.5
    model_height = args.visible_height or (maximum.z - minimum.z)
    if args.visible_height is not None:
        # Prepared runtime characters are grounded at z=0. Some imported GLBs
        # retain unused armature-space bounds below the rendered skinned mesh;
        # the preparation report's measured height is authoritative for framing.
        center.z = model_height * 0.5
    model_depth = maximum.y - minimum.y

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "Exact_Model_Silhouette_Camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = model_height * args.padding
    camera.location = Vector((center.x, minimum.y - max(4.0, model_depth * 6.0), center.z))
    aim_camera(camera, center)

    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    scene.view_settings.look = "AgX - Medium High Contrast"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)

    print(
        f"Rendered exact silhouette {output_path} from {input_path.name} "
        f"at {args.width}x{args.height}; bounds={tuple(round(v, 4) for v in minimum)}.."
        f"{tuple(round(v, 4) for v in maximum)}"
    )


if __name__ == "__main__":
    main()
