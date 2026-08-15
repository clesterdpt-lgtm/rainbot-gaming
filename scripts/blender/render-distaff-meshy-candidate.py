#!/usr/bin/env python3
"""Render and measure a Meshy Distaff candidate before it touches production.

Usage:
  blender --background --factory-startup \
    --python scripts/blender/render-distaff-meshy-candidate.py -- \
    --input assets/models/saintfall/source/distaff-meshy-v2/distaff-meshy-v2-remeshed.glb \
    --output-dir output/saintfall/distaff-meshy-v2-turntable
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--size", type=int, default=768)
    return parser.parse_args(argv)


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    low = Vector((float("inf"),) * 3)
    high = Vector((float("-inf"),) * 3)
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            low.x, low.y, low.z = min(low.x, point.x), min(low.y, point.y), min(low.z, point.z)
            high.x, high.y, high.z = max(high.x, point.x), max(high.y, point.y), max(high.z, point.z)
    return low, high


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def add_area(name: str, location, target: Vector, energy: float, size: float, color) -> None:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.input.resolve()))

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("candidate contains no meshes")

    low, high = world_bounds(meshes)
    center = (low + high) * 0.5
    dimensions = high - low
    root_objects = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    for obj in root_objects:
        obj.location.x -= center.x
        obj.location.y -= center.y
        obj.location.z -= low.z
    bpy.context.view_layer.update()
    low, high = world_bounds(meshes)
    dimensions = high - low
    center = (low + high) * 0.5

    world = bpy.context.scene.world or bpy.data.worlds.new("Distaff Candidate World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.018, 0.025, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.22

    floor_mat = bpy.data.materials.new("Glass Scar Floor")
    floor_mat.diffuse_color = (0.025, 0.045, 0.05, 1)
    bpy.ops.mesh.primitive_plane_add(size=max(dimensions.x, dimensions.y) * 4.0)
    floor = bpy.context.object
    floor.data.materials.append(floor_mat)

    extent = max(dimensions.x, dimensions.y, dimensions.z)
    light_target = Vector((0, 0, dimensions.z * 0.46))
    energy_scale = max(1.0, extent * extent * 0.52)
    add_area("Key", (extent * 1.7, -extent * 1.8, extent * 1.8), light_target, 1150 * energy_scale, extent * 0.95, (0.62, 0.92, 1.0))
    add_area("Rim", (-extent * 1.5, extent * 1.2, extent * 1.5), light_target, 900 * energy_scale, extent * 0.75, (0.20, 0.78, 0.82))
    add_area("Fill", (0, extent * 1.8, extent * 0.55), light_target, 650 * energy_scale, extent * 1.1, (0.32, 0.42, 0.55))

    camera_data = bpy.data.cameras.new("Distaff Candidate Camera")
    camera = bpy.data.objects.new("Distaff Candidate Camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera_data.lens = 58

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = args.size
    scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"

    radius = extent * 2.15
    target = Vector((0, 0, dimensions.z * 0.38))
    views = {
        "front": (0.0, -radius, dimensions.z * 0.58),
        "front-left": (-radius * 0.74, -radius * 0.74, dimensions.z * 0.62),
        "left": (-radius, 0.0, dimensions.z * 0.55),
        "rear": (0.0, radius, dimensions.z * 0.58),
        "right": (radius, 0.0, dimensions.z * 0.55),
        "top": (0.0, -radius * 0.25, radius * 0.92),
    }
    for name, location in views.items():
        camera.location = location
        point_camera(camera, target)
        scene.render.filepath = str((args.output_dir / f"{name}.png").resolve())
        bpy.ops.render.render(write_still=True)

    triangles = sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons)
    report = {
        "source": str(args.input),
        "meshObjects": len(meshes),
        "materials": len({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material}),
        "triangles": triangles,
        "dimensions": {"x": round(dimensions.x, 5), "y": round(dimensions.y, 5), "z": round(dimensions.z, 5)},
        "renders": [f"{name}.png" for name in views],
    }
    (args.output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
