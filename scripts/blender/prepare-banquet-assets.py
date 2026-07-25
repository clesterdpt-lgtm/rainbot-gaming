#!/usr/bin/env python3
"""Prepare the Meshy-generated Mr. Feast banquet body and mask variants.

Run through Blender 4.5:

    blender --background --factory-startup \
      --python scripts/blender/prepare-banquet-assets.py -- \
      --source-dir assets/models/mr-feast/source/banquet \
      --output-dir assets/models/mr-feast/banquet --force

The raw Meshy masters remain ignored. Runtime output is an uncompressed
Three.js-r128-compatible rigged body, six static mask variants, per-file
reports, and one provenance manifest.
"""

from __future__ import annotations

import argparse
import bmesh
import json
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


@dataclass(frozen=True)
class MaskVariant:
    id: str
    label: str
    source_slug: str
    target_height: float
    crop_bottom_ratio: float
    scale_xyz: tuple[float, float, float]
    ornament: str
    description: str


MASK_VARIANTS = (
    MaskVariant(
        id="stag-crown",
        label="The Stag Crown",
        source_slug="mask-stag-source",
        target_height=0.62,
        crop_bottom_ratio=0.0,
        scale_xyz=(1.0, 0.9, 1.0),
        ornament="stag-circlet",
        description="Tall branching antlers, bone-white skull, and a narrow brass circlet.",
    ),
    MaskVariant(
        id="ram-reliquary",
        label="The Ram Reliquary",
        source_slug="mask-stag-source",
        target_height=0.50,
        crop_bottom_ratio=0.0,
        scale_xyz=(1.12, 0.92, 0.82),
        ornament="ram-horns",
        description="A shortened bone face enclosed by two broad soot-black spiral horns.",
    ),
    MaskVariant(
        id="raven-mourning",
        label="The Mourning Raven",
        source_slug="mask-raven-source",
        target_height=0.54,
        crop_bottom_ratio=0.22,
        scale_xyz=(0.93, 0.86, 1.0),
        ornament="raven-chains",
        description="Long black beak, gold feather filigree, and paired mourning chains.",
    ),
    MaskVariant(
        id="moth-veil",
        label="The Veiled Moth",
        source_slug="mask-raven-source",
        target_height=0.46,
        crop_bottom_ratio=0.22,
        scale_xyz=(1.16, 0.43, 0.86),
        ornament="moth-wings",
        description="A compressed beak framed by broad oxblood moth wings and a fine veil.",
    ),
    MaskVariant(
        id="porcelain-grin",
        label="The Porcelain Grin",
        source_slug="mask-grin-source",
        target_height=0.48,
        crop_bottom_ratio=0.24,
        scale_xyz=(0.94, 0.9, 1.0),
        ornament="grin-tears",
        description="Warm porcelain, hollow eyes, a fixed red smile, and gold tear drops.",
    ),
    MaskVariant(
        id="eclipse-oracle",
        label="The Eclipse Oracle",
        source_slug="mask-grin-source",
        target_height=0.43,
        crop_bottom_ratio=0.24,
        scale_xyz=(0.92, 0.88, 0.94),
        ornament="eclipse-halo",
        description="A smaller polite face surrounded by a black-and-gold solar halo.",
    ),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--texture-size", type=int, default=512)
    parser.add_argument("--body-height", type=float, default=1.78)
    parser.add_argument("--body-triangles", type=int, default=16_000)
    parser.add_argument("--mask-triangles", type=int, default=6_500)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


def reset_scene() -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
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


def select_only(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = next(
            (obj for obj in objects if obj.type == "ARMATURE"),
            objects[0],
        )


def remove_everything_except(objects: list[bpy.types.Object]) -> None:
    keep = set(objects)
    for armature in [obj for obj in objects if obj.type == "ARMATURE"]:
        for pose_bone in armature.pose.bones:
            pose_bone.custom_shape = None
    for obj in list(bpy.context.scene.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    bpy.context.view_layer.update()
    points = [
        obj.matrix_world @ Vector(corner)
        for obj in objects
        if obj.type == "MESH"
        for corner in obj.bound_box
    ]
    if not points:
        raise RuntimeError("No mesh bounds were available")
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


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


def vector_list(value: Vector) -> list[float]:
    return [round(float(component), 6) for component in value]


def bounds_payload(objects: list[bpy.types.Object]) -> dict[str, list[float]]:
    minimum, maximum = world_bounds(objects)
    size = maximum - minimum
    return {
        "min": vector_list(minimum),
        "max": vector_list(maximum),
        "size": vector_list(size),
    }


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
            ratio = max_size / largest
            image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))
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


def decimate(objects: list[bpy.types.Object], target_triangles: int, modifier_name: str) -> None:
    source_triangles = triangle_count(objects)
    if source_triangles <= target_triangles:
        return
    ratio = max(0.05, min(1.0, target_triangles / source_triangles))
    for obj in objects:
        if obj.type != "MESH" or obj.data.shape_keys:
            continue
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new(name=modifier_name, type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        while obj.modifiers.find(modifier.name) > 0:
            bpy.ops.object.modifier_move_up(modifier=modifier.name)
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def polish_materials(objects: list[bpy.types.Object], prefix: str) -> list[str]:
    materials = sorted(
        {
            material
            for obj in objects
            if obj.type == "MESH"
            for material in obj.data.materials
            if material
        },
        key=lambda item: item.name,
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
            roughness = node.inputs.get("Roughness")
            metallic = node.inputs.get("Metallic")
            emission = node.inputs.get("Emission Strength")
            if roughness and not roughness.is_linked:
                roughness.default_value = max(float(roughness.default_value), 0.5)
            if metallic and not metallic.is_linked:
                metallic.default_value = min(float(metallic.default_value), 0.42)
            if emission:
                emission.default_value = 0.0
    return [material.name for material in materials]


def export_glb(
    output_path: Path,
    objects: list[bpy.types.Object],
    *,
    skins: bool,
) -> None:
    select_only(objects)
    requested = {
        "filepath": str(output_path),
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_animations": False,
        "export_skins": skins,
        "export_morph": False,
        "export_cameras": False,
        "export_lights": False,
        "export_draco_mesh_compression_enable": False,
        "export_use_gltfpack": False,
    }
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    result = bpy.ops.export_scene.gltf(**{
        key: value for key, value in requested.items() if key in available
    })
    if "FINISHED" not in result:
        raise RuntimeError(f"Failed to export {output_path.name}")


def normalize_roots(
    objects: list[bpy.types.Object],
    meshes: list[bpy.types.Object],
    target_height: float,
) -> float:
    for mesh in meshes:
        world_matrix = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = world_matrix
    minimum, maximum = world_bounds(meshes)
    height = maximum.z - minimum.z
    if height <= 0:
        raise RuntimeError("Invalid source height")
    scale = target_height / height
    center_x = (minimum.x + maximum.x) * 0.5
    center_y = (minimum.y + maximum.y) * 0.5
    normalization = (
        Matrix.Translation(Vector((-center_x * scale, -center_y * scale, -minimum.z * scale)))
        @ Matrix.Scale(scale, 4)
    )
    object_set = set(objects)
    for root in [obj for obj in objects if obj.parent is None or obj.parent not in object_set]:
        root.matrix_world = normalization @ root.matrix_world
    bpy.context.view_layer.update()
    return scale


def smooth_skinned_meshes(meshes: list[bpy.types.Object]) -> None:
    for mesh in meshes:
        edit_mesh = bmesh.new()
        edit_mesh.from_mesh(mesh.data)
        bmesh.ops.remove_doubles(edit_mesh, verts=list(edit_mesh.verts), dist=1e-4)
        edit_mesh.to_mesh(mesh.data)
        edit_mesh.free()
        for polygon in mesh.data.polygons:
            polygon.use_smooth = True
        mesh.data.update()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def task_credits(meta: dict) -> int:
    direct = meta.get("consumedCredits")
    if isinstance(direct, int):
        return direct
    return sum(
        int(meta.get(key, {}).get("consumedCredits") or 0)
        for key in ("preview", "refine")
    )


def prepare_body(
    source_dir: Path,
    output_dir: Path,
    *,
    target_height: float,
    target_triangles: int,
    texture_size: int,
) -> dict:
    reset_scene()
    input_path = source_dir / "cult-patron-body-rigged.glb"
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    skinned_meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and any(modifier.type == "ARMATURE" for modifier in obj.modifiers)
    ]
    if len(armatures) != 1 or not skinned_meshes:
        raise RuntimeError(
            f"Expected one rig and at least one skinned body mesh; got {len(armatures)} / {len(skinned_meshes)}"
        )
    exportable = [armatures[0], *skinned_meshes]
    for obj in exportable:
        obj.animation_data_clear()
    source_triangles = triangle_count(skinned_meshes)
    normalization_scale = normalize_roots(exportable, skinned_meshes, target_height)
    decimate(skinned_meshes, target_triangles, "Banquet_Body_Decimate")
    smooth_skinned_meshes(skinned_meshes)
    prefix = "Banquet_Cult_Patron"
    for index, mesh in enumerate(skinned_meshes, start=1):
        mesh.name = f"{prefix}_Mesh_{index:02d}"
        mesh.data.name = f"{prefix}_Geometry_{index:02d}"
    armatures[0].name = f"{prefix}_Rig"
    material_names = polish_materials(skinned_meshes, prefix)
    images = resize_and_pack_images(texture_size)
    output_path = output_dir / "cult-patron-body.glb"
    remove_everything_except(exportable)
    export_glb(output_path, exportable, skins=True)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pipeline": "Meshy text-to-3D -> Meshy rig -> Blender browser preparation",
        "source": str(input_path),
        "output": output_path.name,
        "rigged": True,
        "bones": [bone.name for bone in armatures[0].data.bones],
        "forwardAxis": "+Z",
        "targetHeightMeters": target_height,
        "normalizationScale": normalization_scale,
        "sourceTriangles": source_triangles,
        "triangles": triangle_count(skinned_meshes),
        "boundsMeters": bounds_payload(skinned_meshes),
        "textureMaxSize": texture_size,
        "images": images,
        "materials": material_names,
        "fileBytes": output_path.stat().st_size,
        "animationPolicy": "named runtime seated pose plus restrained procedural breathing",
        "validatedFor": "Three.js r128 SkeletonUtils",
    }
    write_json(output_dir / "cult-patron-body.report.json", report)
    return report


def actual_mask_meshes() -> list[bpy.types.Object]:
    meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and obj.name.lower() != "cube"
    ]
    preferred = [obj for obj in meshes if obj.name.startswith("Mesh")]
    return preferred or meshes


def crop_mesh_bottom(obj: bpy.types.Object, crop_ratio: float) -> None:
    if crop_ratio <= 0:
        return
    local_points = [Vector(corner) for corner in obj.bound_box]
    minimum_z = min(point.z for point in local_points)
    maximum_z = max(point.z for point in local_points)
    threshold = minimum_z + (maximum_z - minimum_z) * crop_ratio
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    remove = [vertex for vertex in mesh.verts if vertex.co.z < threshold]
    if remove and len(remove) < len(mesh.verts):
        bmesh.ops.delete(mesh, geom=remove, context="VERTS")
        mesh.to_mesh(obj.data)
        obj.data.update()
    mesh.free()


def normalize_mask(
    meshes: list[bpy.types.Object],
    target_height: float,
    scale_xyz: tuple[float, float, float],
) -> None:
    minimum, maximum = world_bounds(meshes)
    height = maximum.z - minimum.z
    if height <= 0:
        raise RuntimeError("Invalid mask source height")
    scale = target_height / height
    center = (minimum + maximum) * 0.5
    normalization = Matrix.Translation(-center * scale) @ Matrix.Scale(scale, 4)
    for obj in meshes:
        obj.matrix_world = normalization @ obj.matrix_world
    authored = Matrix.Diagonal((*scale_xyz, 1.0))
    for obj in meshes:
        obj.matrix_world = authored @ obj.matrix_world
    bpy.context.view_layer.update()


def make_material(name: str, color: tuple[float, float, float, float], metallic: float, roughness: float) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Metallic"].default_value = metallic
        principled.inputs["Roughness"].default_value = roughness
    return material


def add_curve(
    name: str,
    points: list[tuple[float, float, float]],
    material: bpy.types.Material,
    bevel_depth: float,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(name=f"{name}_Curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 2
    curve_data.bevel_depth = bevel_depth
    curve_data.bevel_resolution = 2
    spline = curve_data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, value in zip(spline.points, points):
        point.co = (*value, 1)
    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def add_wing(
    name: str,
    side: float,
    material: bpy.types.Material,
) -> bpy.types.Object:
    vertices = [
        (side * 0.10, 0.055, -0.02),
        (side * 0.30, 0.07, -0.15),
        (side * 0.42, 0.075, 0.03),
        (side * 0.35, 0.07, 0.23),
        (side * 0.13, 0.055, 0.14),
    ]
    mesh = bpy.data.meshes.new(f"{name}_Geometry")
    mesh.from_pydata(vertices, [], [[0, 1, 2, 3, 4]])
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    solidify = obj.modifiers.new(name="Moth_Wing_Thickness", type="SOLIDIFY")
    solidify.thickness = 0.008
    solidify.offset = 0
    return obj


def add_eclipse_halo(
    material_dark: bpy.types.Material,
    material_gold: bpy.types.Material,
) -> list[bpy.types.Object]:
    created: list[bpy.types.Object] = []
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.285,
        minor_radius=0.014,
        major_segments=32,
        minor_segments=8,
        location=(0, 0.075, 0.015),
        rotation=(math.pi / 2, 0, 0),
    )
    ring = bpy.context.object
    ring.name = "Eclipse_Oracle_Halo"
    ring.data.materials.append(material_dark)
    created.append(ring)
    for index in range(12):
        angle = index * math.tau / 12
        direction = Vector((math.sin(angle), 0, math.cos(angle)))
        location = direction * 0.345 + Vector((0, 0.08, 0.015))
        bpy.ops.mesh.primitive_cone_add(
            vertices=8,
            radius1=0.022,
            radius2=0.006,
            depth=0.12 if index % 2 == 0 else 0.085,
            location=location,
        )
        spike = bpy.context.object
        spike.name = f"Eclipse_Oracle_Ray_{index + 1:02d}"
        spike.rotation_mode = "QUATERNION"
        spike.rotation_quaternion = direction.to_track_quat("Z", "Y")
        spike.data.materials.append(material_gold)
        created.append(spike)
    return created


def add_ornaments(kind: str, variant_id: str) -> list[bpy.types.Object]:
    gold = make_material(
        f"{variant_id}_Antique_Gold",
        (0.42, 0.22, 0.055, 1),
        metallic=0.72,
        roughness=0.38,
    )
    soot = make_material(
        f"{variant_id}_Soot_Black",
        (0.018, 0.014, 0.02, 1),
        metallic=0.15,
        roughness=0.55,
    )
    oxblood = make_material(
        f"{variant_id}_Oxblood_Veil",
        (0.16, 0.015, 0.025, 1),
        metallic=0.05,
        roughness=0.64,
    )
    created: list[bpy.types.Object] = []
    if kind == "stag-circlet":
        created.append(add_curve(
            "Stag_Crown_Circlet",
            [(-0.18, 0.06, 0.13), (-0.1, 0.04, 0.18), (0, 0.035, 0.2), (0.1, 0.04, 0.18), (0.18, 0.06, 0.13)],
            gold,
            0.011,
        ))
        for x in (-0.1, 0, 0.1):
            bpy.ops.mesh.primitive_cone_add(
                vertices=8,
                radius1=0.018,
                radius2=0.004,
                depth=0.09,
                location=(x, 0.045, 0.235 + (0.02 if x == 0 else 0)),
            )
            jewel = bpy.context.object
            jewel.name = f"Stag_Crown_Point_{x:+.2f}"
            jewel.data.materials.append(gold)
            created.append(jewel)
    elif kind == "ram-horns":
        for side in (-1, 1):
            points = []
            for index in range(24):
                progress = index / 23
                angle = progress * math.pi * 1.72
                radius = 0.18 * (1 - progress * 0.56)
                x = side * (0.2 + math.cos(angle) * radius)
                z = 0.065 + math.sin(angle) * radius
                points.append((x, 0.075, z))
            created.append(add_curve(
                f"Ram_Reliquary_Horn_{'L' if side < 0 else 'R'}",
                points,
                soot,
                0.025,
            ))
        created.append(add_curve(
            "Ram_Reliquary_Brow",
            [(-0.21, 0.06, 0.11), (0, 0.04, 0.17), (0.21, 0.06, 0.11)],
            gold,
            0.009,
        ))
    elif kind == "raven-chains":
        for side in (-1, 1):
            created.append(add_curve(
                f"Mourning_Raven_Chain_{'L' if side < 0 else 'R'}",
                [
                    (side * 0.17, 0.04, -0.02),
                    (side * 0.20, 0.02, -0.13),
                    (side * 0.18, 0.01, -0.25),
                ],
                gold,
                0.006,
            ))
            bpy.ops.mesh.primitive_uv_sphere_add(
                segments=12,
                ring_count=8,
                radius=0.025,
                location=(side * 0.18, 0.01, -0.27),
            )
            bead = bpy.context.object
            bead.name = f"Mourning_Raven_Bead_{'L' if side < 0 else 'R'}"
            bead.data.materials.append(soot)
            created.append(bead)
    elif kind == "moth-wings":
        created.extend([
            add_wing("Veiled_Moth_Wing_L", -1, oxblood),
            add_wing("Veiled_Moth_Wing_R", 1, oxblood),
        ])
        for side in (-1, 1):
            created.append(add_curve(
                f"Veiled_Moth_Wing_Rib_{'L' if side < 0 else 'R'}",
                [(side * 0.12, 0.045, -0.02), (side * 0.33, 0.04, 0.03), (side * 0.27, 0.04, 0.2)],
                gold,
                0.006,
            ))
            for strand in range(3):
                x = side * (0.1 + strand * 0.055)
                created.append(add_curve(
                    f"Veiled_Moth_Veil_{'L' if side < 0 else 'R'}_{strand + 1}",
                    [(x, -0.015, -0.08), (x + side * 0.015, -0.02, -0.34)],
                    soot,
                    0.004,
                ))
    elif kind == "grin-tears":
        for side in (-1, 1):
            created.append(add_curve(
                f"Porcelain_Grin_Tear_{'L' if side < 0 else 'R'}",
                [(side * 0.085, -0.04, 0.05), (side * 0.095, -0.05, -0.08), (side * 0.075, -0.05, -0.17)],
                gold,
                0.006,
            ))
            bpy.ops.mesh.primitive_uv_sphere_add(
                segments=12,
                ring_count=8,
                radius=0.018,
                location=(side * 0.075, -0.05, -0.19),
            )
            drop = bpy.context.object
            drop.name = f"Porcelain_Grin_Tear_Drop_{'L' if side < 0 else 'R'}"
            drop.scale.z = 1.8
            drop.data.materials.append(gold)
            created.append(drop)
    elif kind == "eclipse-halo":
        created.extend(add_eclipse_halo(soot, gold))
    else:
        raise ValueError(f"Unknown mask ornament type: {kind}")
    return created


def realize_procedural_objects(objects: list[bpy.types.Object]) -> list[bpy.types.Object]:
    realized: list[bpy.types.Object] = []
    for obj in objects:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        if obj.type == "CURVE":
            bpy.ops.object.convert(target="MESH")
            obj = bpy.context.object
        for modifier in list(obj.modifiers):
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        realized.append(obj)
    return realized


def prepare_mask_variant(
    variant: MaskVariant,
    source_dir: Path,
    output_dir: Path,
    *,
    target_triangles: int,
    texture_size: int,
) -> dict:
    reset_scene()
    input_path = source_dir / f"{variant.source_slug}-master.glb"
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    meshes = actual_mask_meshes()
    if not meshes:
        raise RuntimeError(f"No mask mesh found in {input_path.name}")
    for mesh in meshes:
        crop_mesh_bottom(mesh, variant.crop_bottom_ratio)
    source_triangles = triangle_count(meshes)
    decimate(meshes, target_triangles, f"{variant.id}_Decimate")
    normalize_mask(meshes, variant.target_height, variant.scale_xyz)
    prefix = "Banquet_Mask_" + "_".join(part.title() for part in variant.id.split("-"))
    for index, mesh in enumerate(meshes, start=1):
        mesh.name = f"{prefix}_Mesh_{index:02d}"
        mesh.data.name = f"{prefix}_Geometry_{index:02d}"
    material_names = polish_materials(meshes, prefix)
    ornament_objects = realize_procedural_objects(
        add_ornaments(variant.ornament, variant.id)
    )
    images = resize_and_pack_images(texture_size)
    exportable = [*meshes, *ornament_objects]
    output_path = output_dir / f"mask-{variant.id}.glb"
    remove_everything_except(exportable)
    export_glb(output_path, exportable, skins=False)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pipeline": "Meshy text-to-3D prop -> Blender crop/decimate/variant/export",
        "id": variant.id,
        "label": variant.label,
        "description": variant.description,
        "source": str(input_path),
        "output": output_path.name,
        "forwardAxis": "+Z",
        "cropBottomRatio": variant.crop_bottom_ratio,
        "authoredScale": list(variant.scale_xyz),
        "ornament": variant.ornament,
        "sourceTriangles": source_triangles,
        "triangles": triangle_count(exportable),
        "boundsMeters": bounds_payload(exportable),
        "textureMaxSize": texture_size,
        "images": images,
        "materials": material_names,
        "fileBytes": output_path.stat().st_size,
        "rigged": False,
        "validatedFor": "Three.js r128 static GLTFLoader",
    }
    write_json(output_dir / f"mask-{variant.id}.report.json", report)
    return report


def build_manifest(
    source_dir: Path,
    output_dir: Path,
    body_report: dict,
    mask_reports: list[dict],
) -> dict:
    body_meta = load_json(source_dir / "cult-patron-body.meta.json")
    body_rig_meta = load_json(source_dir / "cult-patron-body-rig.meta.json")
    mask_meta_by_slug = {
        slug: load_json(source_dir / f"{slug}.meta.json")
        for slug in sorted({variant.source_slug for variant in MASK_VARIANTS})
    }
    variant_by_id = {variant.id: variant for variant in MASK_VARIANTS}
    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pipeline": "Meshy source assets with deterministic Blender runtime preparation",
        "creditStrategy": {
            "sharedBodyGenerations": 1,
            "maskSourceGenerations": len(mask_meta_by_slug),
            "runtimeBodyVariants": 1,
            "runtimeMaskVariants": len(mask_reports),
            "estimatedConsumedCredits": (
                task_credits(body_meta)
                + task_credits(body_rig_meta)
                + sum(task_credits(meta) for meta in mask_meta_by_slug.values())
            ),
        },
        "body": {
            "id": "cult-patron-body",
            "runtimeFile": body_report["output"],
            "sourceCount": 1,
            "rigged": True,
            "forwardAxis": body_report["forwardAxis"],
            "heightMeters": body_report["targetHeightMeters"],
            "triangles": body_report["triangles"],
            "boundsMeters": body_report["boundsMeters"]["size"],
            "fileBytes": body_report["fileBytes"],
            "boneCount": len(body_report["bones"]),
            "animationPolicy": body_report["animationPolicy"],
            "meshy": {
                "previewTaskId": body_meta["preview"]["id"],
                "refineTaskId": body_meta["refine"]["id"],
                "rigTaskId": body_rig_meta["id"],
                "consumedCredits": task_credits(body_meta) + task_credits(body_rig_meta),
            },
            "blenderReport": "cult-patron-body.report.json",
        },
        "masks": [],
    }
    for report in mask_reports:
        variant = variant_by_id[report["id"]]
        source_meta = mask_meta_by_slug[variant.source_slug]
        manifest["masks"].append({
            "id": report["id"],
            "label": report["label"],
            "description": report["description"],
            "runtimeFile": report["output"],
            "sourceFile": f"source/banquet/{variant.source_slug}-master.glb",
            "forwardAxis": report["forwardAxis"],
            "boundsMeters": report["boundsMeters"]["size"],
            "triangles": report["triangles"],
            "fileBytes": report["fileBytes"],
            "blenderVariant": report["ornament"],
            "meshy": {
                "previewTaskId": source_meta["preview"]["id"],
                "sourceTaskId": source_meta["refine"]["id"],
                "consumedCredits": task_credits(source_meta),
            },
            "blenderReport": f"mask-{report['id']}.report.json",
        })
    write_json(output_dir / "manifest.json", manifest)
    return manifest


def main() -> None:
    args = parse_args()
    source_dir = args.source_dir.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    if not source_dir.is_dir():
        raise FileNotFoundError(f"Missing source directory: {source_dir}")
    if args.texture_size < 128:
        raise ValueError("--texture-size must be at least 128")
    if args.body_triangles < 2_000 or args.mask_triangles < 1_000:
        raise ValueError("Triangle budgets are implausibly low")
    output_dir.mkdir(parents=True, exist_ok=True)
    protected = [
        output_dir / "cult-patron-body.glb",
        output_dir / "manifest.json",
        *[output_dir / f"mask-{variant.id}.glb" for variant in MASK_VARIANTS],
    ]
    if any(path.exists() for path in protected) and not args.force:
        raise FileExistsError("Refusing to replace banquet outputs without --force")

    body_report = prepare_body(
        source_dir,
        output_dir,
        target_height=args.body_height,
        target_triangles=args.body_triangles,
        texture_size=args.texture_size,
    )
    mask_reports = [
        prepare_mask_variant(
            variant,
            source_dir,
            output_dir,
            target_triangles=args.mask_triangles,
            texture_size=args.texture_size,
        )
        for variant in MASK_VARIANTS
    ]
    manifest = build_manifest(source_dir, output_dir, body_report, mask_reports)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
