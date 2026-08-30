#!/usr/bin/env python3
"""Add a restrained facial rig to the optimized Mr. Feast Blender asset.

Run through Blender after ``prepare-mr-feast-model.py`` has produced the
65k-triangle working blend::

    blender --background --python scripts/blender/add-mr-feast-facial-shapes.py -- \
      --input-blend assets/models/mr-feast/processed/mr-feast-working.blend \
      --output assets/models/mr-feast/processed/mr-feast-game-faced.glb \
      --report assets/models/mr-feast/processed/mr-feast-facial-report.json \
      --preview-dir output/blender/mr-feast-face --force

Meshy's head is a texture-painted polygon soup rather than animation-ready
facial topology. This pass uses readable 4–13mm contour movement for brows,
cheeks, mouth corners, and jaw while keeping lids and lip separation bounded.
Blinks remain intentional squints: a true lid closure tears open the
disconnected eye fragments and requires future face retopology.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector


FACIAL_TARGETS = (
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

EYES = {
    # Blender +X is anatomical left; the face points down -Y.
    "left": {"center": (0.020, 1.795), "radii": (0.033, 0.022)},
    "right": {"center": (-0.043, 1.795), "radii": (0.036, 0.022)},
}

def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-blend", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--preview-dir", type=Path)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


def exportable(obj: bpy.types.Object) -> bool:
    return not any(collection.name == "glTF_not_exported" for collection in obj.users_collection)


def group_weight(obj: bpy.types.Object, vertex: bpy.types.MeshVertex, name: str) -> float:
    group = obj.vertex_groups.get(name)
    if group is None:
        return 0.0
    for membership in vertex.groups:
        if membership.group == group.index:
            return membership.weight
    return 0.0


def smooth_ellipse(x: float, z: float, cx: float, cz: float, rx: float, rz: float) -> float:
    radius_squared = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2
    return max(0.0, 1.0 - radius_squared) ** 2


def source_face_vertices(obj: bpy.types.Object) -> list[tuple[int, Vector, Vector]]:
    normal_matrix = obj.matrix_world.to_3x3()
    candidates: list[tuple[int, Vector, Vector]] = []
    for vertex in obj.data.vertices:
        head_weight = group_weight(obj, vertex, "Head") + group_weight(obj, vertex, "neck")
        if head_weight <= 0.15:
            continue
        position = obj.matrix_world @ vertex.co
        normal = (normal_matrix @ vertex.normal).normalized()
        if normal.y >= -0.15 or position.y < -0.20 or position.y > -0.04:
            continue
        if position.z < 1.64 or position.z > 1.86:
            continue
        candidates.append((vertex.index, position, normal))
    if not candidates:
        raise RuntimeError("Could not identify the front face on the optimized mesh")
    return candidates


def add_world_delta(obj: bpy.types.Object, key: bpy.types.ShapeKey, index: int, delta: Vector) -> None:
    local_delta = obj.matrix_world.inverted_safe().to_3x3() @ delta
    key.data[index].co += local_delta


def author_shape_keys(
    obj: bpy.types.Object,
    original_vertex_count: int,
    face_vertices: list[tuple[int, Vector, Vector]],
) -> dict[str, dict[str, float | int]]:
    if obj.data.shape_keys:
        raise RuntimeError("Input working mesh already has shape keys; rebuild it before facialization")
    obj.shape_key_add(name="Basis")
    keys = {name: obj.shape_key_add(name=name) for name in FACIAL_TARGETS}
    for key in keys.values():
        key.interpolation = "KEY_LINEAR"

    changed: dict[str, set[int]] = {name: set() for name in FACIAL_TARGETS}
    maximum_delta: dict[str, float] = {name: 0.0 for name in FACIAL_TARGETS}

    def move(name: str, index: int, delta: Vector, weight: float) -> None:
        if weight <= 0:
            return
        weighted = delta * weight
        add_world_delta(obj, keys[name], index, weighted)
        changed[name].add(index)
        maximum_delta[name] = max(maximum_delta[name], weighted.length)

    for index, position, _normal in face_vertices:
        if index >= original_vertex_count:
            continue
        x, y, z = position

        brow_left = smooth_ellipse(x, z, 0.020, 1.825, 0.048, 0.023)
        brow_right = smooth_ellipse(x, z, -0.045, 1.825, 0.052, 0.023)
        brow = max(brow_left, brow_right)
        move("brow_raise", index, Vector((0.0010 * (1 if x >= 0 else -1), -0.0004, 0.0080)), brow)
        inner_brow = brow * max(0.15, 1.0 - abs(x) / 0.075)
        move("brow_compress", index, Vector((-0.0045 * (1 if x >= 0 else -1), -0.0010, -0.0040)), inner_brow)

        corner_left = smooth_ellipse(x, z, 0.030, 1.715, 0.038, 0.032)
        corner_right = smooth_ellipse(x, z, -0.047, 1.715, 0.039, 0.032)
        corner = max(corner_left, corner_right)
        outward = 1 if x >= -0.008 else -1
        move("smile", index, Vector((0.0045 * outward, -0.0010, 0.0045)), corner)
        move("smile_wide", index, Vector((0.0100 * outward, -0.0020, 0.0080)), corner)
        move("sneer_left", index, Vector((0.0015, -0.0010, 0.0080)), corner_left)
        move("sneer_right", index, Vector((-0.0015, -0.0010, 0.0080)), corner_right)

        lower_lip = smooth_ellipse(x, z, -0.010, 1.700, 0.062, 0.022)
        upper_lip = smooth_ellipse(x, z, -0.010, 1.720, 0.062, 0.018)
        move("mouth_open", index, Vector((0, -0.0010, -0.0060)), lower_lip)
        move("mouth_open", index, Vector((0, -0.0004, 0.0012)), upper_lip)
        jaw = smooth_ellipse(x, z, -0.010, 1.675, 0.082, 0.052)
        move("jaw_shift", index, Vector((0.0070, -0.0010, -0.0015)), jaw)

        eye_left = smooth_ellipse(x, z, *EYES["left"]["center"], *EYES["left"]["radii"])
        eye_right = smooth_ellipse(x, z, *EYES["right"]["center"], *EYES["right"]["radii"])
        if z >= 1.795:
            move("blink_left", index, Vector((0, 0.0005, -0.0060)), eye_left)
            move("blink_right", index, Vector((0, 0.0005, -0.0060)), eye_right)
        else:
            move("blink_left", index, Vector((0, -0.0002, 0.0020)), eye_left)
            move("blink_right", index, Vector((0, -0.0002, 0.0020)), eye_right)

    return {
        name: {
            "changedVertices": len(changed[name]),
            "maxDeltaMillimeters": round(maximum_delta[name] * 1000, 3),
        }
        for name in FACIAL_TARGETS
    }


def triangle_count(obj: bpy.types.Object) -> int:
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def select_for_export(mesh: bpy.types.Object, armature: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature


def export_glb(path: Path, mesh: bpy.types.Object, armature: bpy.types.Object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    select_for_export(mesh, armature)
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


def render_previews(obj: bpy.types.Object, preview_dir: Path) -> list[str]:
    preview_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.0
    world = scene.world or bpy.data.worlds.new("MrFeastFacePreviewWorld")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.003, 0.003, 0.005, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.18

    camera_data = bpy.data.cameras.new("MrFeastFacePreviewCamera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 0.43
    camera = bpy.data.objects.new("MrFeastFacePreviewCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = Vector((0.0, -2.5, 1.76))
    look_at(camera, Vector((-0.01, -0.06, 1.76)))
    scene.camera = camera

    light_specs = (
        ("FaceKey", (-0.8, -1.3, 2.25), 300.0, 1.6, (1.0, 0.78, 0.62)),
        ("FaceFill", (0.9, -0.8, 1.75), 120.0, 1.3, (0.58, 0.68, 1.0)),
        ("FaceRim", (0.2, 1.0, 2.2), 360.0, 1.1, (0.45, 0.58, 1.0)),
    )
    for name, location, energy, size, color in light_specs:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(light)
        light.location = Vector(location)
        look_at(light, Vector((0.0, -0.05, 1.76)))

    poses = {
        "neutral": {},
        "friendly": {"smile": 0.55, "brow_raise": 0.28},
        "watching": {"brow_compress": 0.68, "smile": 0.10, "jaw_shift": 0.12},
        "threatened": {"smile_wide": 0.95, "brow_compress": 0.85, "sneer_left": 0.60, "sneer_right": 0.35, "jaw_shift": 0.45, "mouth_open": 0.28},
        "blink_left": {"blink_left": 1.0},
        "blink_both": {"blink_left": 1.0, "blink_right": 1.0},
    }
    rendered: list[str] = []
    for pose_name, values in poses.items():
        for target in FACIAL_TARGETS:
            obj.data.shape_keys.key_blocks[target].value = values.get(target, 0.0)
        scene.render.filepath = str(preview_dir / f"mr-feast-face-{pose_name}.png")
        bpy.ops.render.render(write_still=True)
        rendered.append(scene.render.filepath)
    for target in FACIAL_TARGETS:
        obj.data.shape_keys.key_blocks[target].value = 0.0
    return rendered


def main() -> None:
    args = parse_args()
    input_blend = args.input_blend.expanduser().resolve()
    output = args.output.expanduser().resolve()
    report_path = args.report.expanduser().resolve() if args.report else output.with_suffix(".report.json")
    preview_dir = args.preview_dir.expanduser().resolve() if args.preview_dir else None
    if not input_blend.is_file():
        raise FileNotFoundError(f"Working blend not found: {input_blend}")
    protected = [output, report_path]
    existing = [path for path in protected if path.exists()]
    if existing and not args.force:
        raise FileExistsError("Refusing to replace outputs without --force: " + ", ".join(str(path) for path in existing))

    bpy.ops.wm.open_mainfile(filepath=str(input_blend))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and exportable(obj)]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE" and exportable(obj)]
    if len(meshes) != 1 or len(armatures) != 1:
        raise RuntimeError(f"Expected one export mesh and one armature, found {len(meshes)} and {len(armatures)}")
    obj = meshes[0]
    armature = armatures[0]
    original_vertex_count = len(obj.data.vertices)
    original_triangles = triangle_count(obj)
    face_vertices = source_face_vertices(obj)
    shape_report = author_shape_keys(obj, original_vertex_count, face_vertices)
    final_triangles = triangle_count(obj)

    export_glb(output, obj, armature)
    previews = render_previews(obj, preview_dir) if preview_dir else []
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "input": str(input_blend),
        "output": str(output),
        "topologyPolicy": "optimized-source readable expressions",
        "morphNormalExported": False,
        "vertexCountBefore": original_vertex_count,
        "vertexCountAfter": len(obj.data.vertices),
        "trianglesBefore": original_triangles,
        "trianglesAfter": final_triangles,
        "skinnedMeshes": 1,
        "bones": len(armature.data.bones),
        "targets": list(FACIAL_TARGETS),
        "targetStats": shape_report,
        "previews": previews,
        "limitations": [
            "Source face has no animation-ready eyelid loops, oral cavity, separate eyes, or facial bones.",
            "blink targets are restrained squints; full eyelid closure requires face retopology.",
            "mouth_open is a restrained lip-parting micro-expression, not a speech-capable jaw opening.",
        ],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
