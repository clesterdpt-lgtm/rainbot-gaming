"""Author the Drowned Orrery gold-standard opening slice in Blender 5.2.

All geometry, textures, rigs, animation, lighting, and preview renders are
created deterministically from this file. No external art assets are used.
"""

from __future__ import annotations

import json
import math
import os
from collections import defaultdict
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector


REPO_ROOT = Path(__file__).resolve().parents[2]
ASSET_ROOT = REPO_ROOT / "games" / "drowned-orrery" / "models" / "gold-slice"
TEXTURE_ROOT = ASSET_ROOT / "textures"
QA_ROOT = REPO_ROOT / "output" / "qa" / "drowned-orrery" / "gold-slice"
BLEND_PATH = ASSET_ROOT / "drowned-gold-slice.blend"

FPS = 30
TAU = math.tau

for directory in (ASSET_ROOT, TEXTURE_ROOT, QA_ROOT):
    directory.mkdir(parents=True, exist_ok=True)


def srgb(rgb):
    return tuple(float(channel) for channel in rgb)


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifier(obj, name):
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=name)


def set_smooth(obj, smooth=True):
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = smooth


def assign_material(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)


def add_bevel(obj, width, segments=3):
    if width <= 0:
        return
    modifier = obj.modifiers.new("Authored bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    apply_modifier(obj, modifier.name)


def mesh_cube(name, location, dimensions, material, bevel=0.04, rotation=(0, 0, 0), smooth=False):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_bevel(obj, min(bevel, min(dimensions) * 0.24), 3)
    set_smooth(obj, smooth)
    assign_material(obj, material)
    return obj


def mesh_ico(name, location, scale, material, subdivisions=2, rotation=(0, 0, 0), smooth=True):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_smooth(obj, smooth)
    assign_material(obj, material)
    return obj


def mesh_uvsphere(name, location, scale, material, segments=32, rings=16, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_smooth(obj, True)
    assign_material(obj, material)
    return obj


def mesh_cone_between(
    name,
    start,
    end,
    radius_start,
    radius_end,
    material,
    vertices=16,
    bevel=0.025,
    smooth=True,
):
    start_vec = Vector(start)
    end_vec = Vector(end)
    direction = end_vec - start_vec
    depth = direction.length
    midpoint = (start_vec + end_vec) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_start,
        radius2=radius_end,
        depth=depth,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_bevel(obj, min(bevel, radius_start * 0.2, radius_end * 0.2), 2)
    set_smooth(obj, smooth)
    assign_material(obj, material)
    return obj


def mesh_torus(
    name,
    location,
    major_radius,
    minor_radius,
    material,
    rotation=(math.pi / 2, 0, 0),
    major_segments=64,
    minor_segments=12,
):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    set_smooth(obj, True)
    assign_material(obj, material)
    return obj


def mesh_curve(name, points, radius, material, cyclic=False, resolution=2):
    curve_data = bpy.data.curves.new(name, "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = resolution
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 3
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, material)
    activate(obj)
    bpy.ops.object.convert(target="MESH")
    set_smooth(obj, True)
    return obj


def annular_segment(
    name,
    center,
    inner_radius,
    outer_radius,
    angle_start,
    angle_end,
    depth,
    material,
    steps=8,
    bevel=0.07,
):
    cx, cy, cz = center
    vertices = []
    for y_offset in (-depth * 0.5, depth * 0.5):
        for radius in (inner_radius, outer_radius):
            for step in range(steps + 1):
                t = step / steps
                angle = angle_start + (angle_end - angle_start) * t
                vertices.append((cx + radius * math.cos(angle), cy + y_offset, cz + radius * math.sin(angle)))

    ring = steps + 1
    inner_back = 0
    outer_back = ring
    inner_front = ring * 2
    outer_front = ring * 3
    faces = []
    for index in range(steps):
        n = index + 1
        faces.extend(
            [
                (inner_back + index, inner_back + n, outer_back + n, outer_back + index),
                (inner_front + index, outer_front + index, outer_front + n, inner_front + n),
                (outer_back + index, outer_back + n, outer_front + n, outer_front + index),
                (inner_back + index, inner_front + index, inner_front + n, inner_back + n),
            ]
        )
    faces.extend(
        [
            (inner_back, outer_back, outer_front, inner_front),
            (inner_back + steps, inner_front + steps, outer_front + steps, outer_back + steps),
        ]
    )
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, material)
    add_bevel(obj, bevel, 3)
    set_smooth(obj, True)
    return obj


def custom_prism(name, vertices_2d, y_depth, location, material, bevel=0.025):
    vertices = []
    for y in (-y_depth * 0.5, y_depth * 0.5):
        vertices.extend((x + location[0], y + location[1], z + location[2]) for x, z in vertices_2d)
    count = len(vertices_2d)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, material)
    add_bevel(obj, bevel, 2)
    set_smooth(obj, True)
    return obj


def create_collection(name):
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def move_to_collection(obj, collection):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)


def metadata_empty(name, collection, parent, location, scale, properties):
    """Create a non-rendering gameplay marker that survives as glTF metadata."""
    marker = bpy.data.objects.new(name, None)
    collection.objects.link(marker)
    marker.parent = parent
    marker.location = location
    marker.scale = scale
    marker.empty_display_type = "CUBE"
    marker.empty_display_size = 1.0
    for key, value in properties.items():
        marker[key] = value
    return marker


def join_meshes(name, objects, material=None):
    objects = [obj for obj in objects if obj and obj.type == "MESH"]
    if not objects:
        return None
    if len(objects) == 1:
        joined = objects[0]
        joined.name = name
        joined.data.name = f"{name} Mesh"
        if material is not None:
            assign_material(joined, material)
        return joined
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.data.name = f"{name} Mesh"
    if material is not None:
        assign_material(joined, material)
    return joined


def prepare_export_mesh(obj):
    if not obj or obj.type != "MESH" or not obj.data.polygons:
        return
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    triangulate = obj.modifiers.new("Locked export triangulation", "TRIANGULATE")
    triangulate.keep_custom_normals = True
    apply_modifier(obj, triangulate.name)


def set_texture_colorspace(image, colorspace):
    try:
        image.colorspace_settings.name = colorspace
    except TypeError:
        if colorspace == "Non-Color":
            image.colorspace_settings.name = "Non-Color"


def save_image(name, pixels, size, colorspace="sRGB"):
    path = TEXTURE_ROOT / f"{name}.png"
    image = bpy.data.images.get(name) or bpy.data.images.new(name, width=size, height=size, alpha=True)
    set_texture_colorspace(image, colorspace)
    image.pixels.foreach_set(np.asarray(pixels, dtype=np.float32).reshape(-1))
    image.update()
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    return image


def generate_texture_set(name, base, roughness, metallic, seed, style="cloth", size=512):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size]
    nx = xx / size
    ny = yy / size
    # A tiny, deterministic value-noise field supplies broad, non-repeating
    # construction history.  It remains deliberately lower frequency than the
    # weave/pores/strata below, so the material reads at gameplay distance
    # instead of collapsing into uniform procedural grain.
    coarse_size = 11
    coarse = rng.normal(0.0, 1.0, (coarse_size, coarse_size))
    coarse_x = nx * (coarse_size - 1)
    coarse_y = ny * (coarse_size - 1)
    x0 = np.floor(coarse_x).astype(np.int32)
    y0 = np.floor(coarse_y).astype(np.int32)
    x1 = np.minimum(x0 + 1, coarse_size - 1)
    y1 = np.minimum(y0 + 1, coarse_size - 1)
    tx = coarse_x - x0
    ty = coarse_y - y0
    macro = (
        coarse[y0, x0] * (1.0 - tx) * (1.0 - ty)
        + coarse[y0, x1] * tx * (1.0 - ty)
        + coarse[y1, x0] * (1.0 - tx) * ty
        + coarse[y1, x1] * tx * ty
    )
    macro /= max(float(np.max(np.abs(macro))), 1e-5)
    tide_band = np.exp(-np.square((ny - (0.67 + np.sin(nx * TAU * 1.5 + seed) * 0.045)) / 0.055))
    diagonal_wear = np.exp(-np.square(((nx * 0.70 + ny) % 1.0 - 0.54) / 0.055))
    broad = (
        np.sin(nx * TAU * 3.0 + seed) * 0.32
        + np.sin(ny * TAU * 4.0 + seed * 0.71) * 0.24
        + np.sin((nx + ny) * TAU * 7.0) * 0.12
        + macro * 0.28
    )
    noise = rng.normal(0.0, 0.23, (size, size))
    # Broad construction history carries scale. Fine noise is deliberately
    # restrained so cloth, metal, and stone never share an orange-peel read.
    height = broad * 0.34 + noise * 0.035

    if style == "cloth":
        weave = np.sin(nx * TAU * 78.0) * np.sin(ny * TAU * 74.0)
        bias_weft = np.sin((nx * 0.24 + ny) * TAU * 16.0 + macro * 0.8)
        height += weave * 0.045 + bias_weft * 0.018
    elif style == "leather":
        pores = np.maximum(0.0, np.sin(nx * TAU * 35.0 + np.sin(ny * TAU * 5.0)))
        crease = np.exp(-np.square((np.sin((nx * 1.4 + ny) * TAU * 2.0 + macro) * 0.5) / 0.12))
        height += pores * 0.025 - crease * 0.028
    elif style == "metal":
        streaks = np.sin(ny * TAU * 21.0 + np.sin(nx * TAU * 2.0) * 2.0)
        pits = rng.random((size, size)) > 0.987
        hammer = np.sin(nx * TAU * 17.0 + macro * 2.0) * np.sin(ny * TAU * 13.0 - macro)
        height += streaks * 0.025 + hammer * 0.012 - pits.astype(np.float32) * 0.20
    elif style == "stone":
        strata = np.sin((ny + np.sin(nx * TAU * 2.0) * 0.03) * TAU * 11.0)
        cracks = np.abs(np.sin(nx * TAU * 5.0 + np.sin(ny * TAU * 3.0) * 2.0)) < 0.025
        spall = np.maximum(0.0, macro - 0.38)
        height += strata * 0.10 - cracks.astype(np.float32) * 0.18 - spall * 0.045
    elif style == "reed":
        fibers = np.sin(nx * TAU * 42.0 + np.sin(ny * TAU * 3.0))
        binding_pressure = np.sin(ny * TAU * 9.0 + macro * 0.7)
        height += fibers * 0.07 + binding_pressure * 0.022

    height = np.clip(height, -1.0, 1.0)
    variation_strength = {"cloth": 0.14, "leather": 0.15, "metal": 0.12, "stone": 0.16, "reed": 0.14}.get(style, 0.12)
    variation = 1.0 + (height + macro * 0.24)[..., None] * variation_strength
    base_array = np.clip(np.asarray(base, dtype=np.float32)[None, None, :] * variation, 0.012, 0.95)

    if style == "metal":
        if "bronze" in name:
            patina = np.clip((broad + noise * 0.22 + tide_band * 0.28 - 0.05) * 0.92, 0.0, 0.72)[..., None]
            patina_color = np.asarray((0.025, 0.25, 0.20), dtype=np.float32)
            base_array = base_array * (1.0 - patina) + patina * patina_color
        else:
            rust = np.clip((-broad + noise * 0.38 + diagonal_wear * 0.22 - 0.28) * 0.48, 0.0, 0.34)[..., None]
            rust_color = np.asarray((0.22, 0.055, 0.018), dtype=np.float32)
            base_array = base_array * (1.0 - rust) + rust * rust_color
    elif style == "stone":
        tide = np.clip((0.46 - ny) * 1.7, 0.0, 0.34)[..., None]
        base_array = base_array * (1.0 - tide) + tide * np.asarray((0.025, 0.11, 0.105))
        mineral = np.clip((macro + tide_band * 0.8 - 0.58) * 0.16, 0.0, 0.13)[..., None]
        base_array = base_array * (1.0 - mineral) + mineral * np.asarray((0.48, 0.33, 0.13))
    elif style == "cloth":
        salt = np.clip((broad + diagonal_wear * 0.45 - 0.28) * 0.16, 0.0, 0.11)[..., None]
        base_array = base_array * (1.0 - salt) + salt * np.asarray((0.78, 0.83, 0.78))
    elif style == "leather":
        worn = np.clip((height + diagonal_wear * 0.55 - 0.18) * 0.12, 0.0, 0.11)[..., None]
        base_array = base_array * (1.0 - worn) + worn * np.asarray((0.42, 0.19, 0.07))
    elif style == "reed":
        sun_bleach = np.clip((macro + diagonal_wear * 0.45 - 0.25) * 0.13, 0.0, 0.10)[..., None]
        base_array = base_array * (1.0 - sun_bleach) + sun_bleach * np.asarray((0.72, 0.57, 0.26))

    alpha = np.ones((size, size, 1), dtype=np.float32)
    base_rgba = np.concatenate([base_array, alpha], axis=2)

    polished_wear = (diagonal_wear * 0.07 if style in {"metal", "leather"} else 0.0)
    rough = np.clip(roughness + height * 0.13 + macro * 0.035 + noise * 0.045 - polished_wear, 0.12, 0.95)
    metal_map = np.clip(metallic - np.maximum(0.0, -height - 0.35) * 0.42, 0.0, 1.0)
    ao = np.clip(0.94 + height * 0.10, 0.62, 1.0)
    orm = np.stack([ao, rough, metal_map, np.ones_like(rough)], axis=2)

    gy, gx = np.gradient(height)
    strength = {"cloth": 0.42, "leather": 0.32, "metal": 0.78, "stone": 1.05, "reed": 0.72}.get(style, 0.55)
    normal = np.dstack((-gx * strength, -gy * strength, np.ones_like(height)))
    normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-5)
    normal_rgba = np.concatenate([normal * 0.5 + 0.5, alpha], axis=2)

    return {
        "base": save_image(f"{name}_base", base_rgba, size, "sRGB"),
        "orm": save_image(f"{name}_orm", orm, size, "Non-Color"),
        "normal": save_image(f"{name}_normal", normal_rgba, size, "Non-Color"),
    }


def create_pbr_material(name, base, roughness, metallic, seed, style, emission=None, texture_size=512):
    textures = generate_texture_set(name.lower(), base, roughness, metallic, seed, style, texture_size)
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = True
    material.diffuse_color = (*base, 1.0)
    material.metallic = metallic
    material.roughness = roughness
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (650, 0)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (360, 0)
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    base_node = nodes.new("ShaderNodeTexImage")
    base_node.name = "Authored Base Color"
    base_node.image = textures["base"]
    base_node.location = (-620, 180)
    links.new(base_node.outputs["Color"], principled.inputs["Base Color"])

    orm_node = nodes.new("ShaderNodeTexImage")
    orm_node.name = "Authored ORM"
    orm_node.image = textures["orm"]
    orm_node.location = (-620, -80)
    separate = nodes.new("ShaderNodeSeparateColor")
    separate.mode = "RGB"
    separate.location = (-350, -80)
    links.new(orm_node.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], principled.inputs["Roughness"])
    links.new(separate.outputs["Blue"], principled.inputs["Metallic"])

    # Blender's glTF exporter recognizes this intentionally unconnected group as
    # the occlusion channel.  Keeping AO in the red channel also makes the ORM
    # texture useful to the real-time runtime instead of shipping dead data.
    gltf_output = bpy.data.node_groups.get("glTF Material Output")
    if gltf_output is None:
        gltf_output = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        gltf_output.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    occlusion = nodes.new("ShaderNodeGroup")
    occlusion.name = "glTF Material Output"
    occlusion.node_tree = gltf_output
    occlusion.location = (20, -520)
    links.new(separate.outputs["Red"], occlusion.inputs["Occlusion"])

    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.name = "Authored Tangent Normal"
    normal_node.image = textures["normal"]
    normal_node.location = (-620, -350)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = {
        "cloth": 0.22,
        "leather": 0.16,
        "metal": 0.34,
        "stone": 0.48,
        "reed": 0.31,
    }.get(style, 0.28)
    normal_map.location = (-300, -330)
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])

    if emission is not None:
        color, strength = emission
        principled.inputs["Emission Color"].default_value = (*color, 1.0)
        principled.inputs["Emission Strength"].default_value = strength

    return material


def create_emissive_material(name, color, strength):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = True
    material.diffuse_color = (*color, 1.0)
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*tuple(c * 0.18 for c in color), 1.0)
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["Roughness"].default_value = 0.24
    principled.inputs["Emission Color"].default_value = (*color, 1.0)
    principled.inputs["Emission Strength"].default_value = strength
    return material


def reset_scene():
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def create_material_library():
    return {
        "indigo": create_pbr_material("Surveyor Indigo Oilskin", (0.075, 0.22, 0.31), 0.72, 0.0, 11, "cloth", texture_size=512),
        "ivory": create_pbr_material("Salted Ivory Canvas", (0.78, 0.68, 0.47), 0.78, 0.0, 13, "cloth", texture_size=512),
        "leather": create_pbr_material("Dark Oiled Leather", (0.18, 0.075, 0.035), 0.58, 0.0, 17, "leather", texture_size=512),
        "skin": create_pbr_material("Weathered Skin", (0.58, 0.31, 0.18), 0.62, 0.0, 19, "leather", texture_size=512),
        "bronze": create_pbr_material("Aged Meridian Bronze", (0.38, 0.17, 0.045), 0.47, 0.88, 23, "metal", texture_size=512),
        "iron": create_pbr_material("Pressure Black Iron", (0.11, 0.14, 0.15), 0.48, 0.86, 29, "metal", texture_size=512),
        "reed": create_pbr_material("Salt Reed Binding", (0.49, 0.35, 0.13), 0.82, 0.0, 31, "reed", texture_size=512),
        "stone": create_pbr_material("Drowned Mineral Stone", (0.34, 0.43, 0.41), 0.68, 0.0, 37, "stone", texture_size=512),
        "wet_stone": create_pbr_material("Wet Tide Stone", (0.12, 0.28, 0.29), 0.31, 0.0, 41, "stone", texture_size=512),
        "cyan": create_emissive_material("Compass Cyan", (0.035, 0.48, 0.70), 3.2),
        "amber": create_emissive_material("Sentinel Amber", (0.88, 0.105, 0.018), 4.1),
        "gate_light": create_emissive_material("Aperture Cold Fire", (0.035, 0.42, 0.65), 3.4),
    }


def create_armature(name, bone_specs, collection):
    armature_data = bpy.data.armatures.new(f"{name} Rig Data")
    armature = bpy.data.objects.new(f"{name} Rig", armature_data)
    collection.objects.link(armature)
    armature.show_in_front = True
    armature_data.display_type = "OCTAHEDRAL"
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for spec in bone_specs:
        bone = armature_data.edit_bones.new(spec[0])
        bone.head = spec[1]
        bone.tail = spec[2]
        bone.roll = spec[4] if len(spec) > 4 else 0.0
        created[spec[0]] = bone
    for spec in bone_specs:
        parent_name = spec[3]
        if parent_name:
            created[spec[0]].parent = created[parent_name]
            created[spec[0]].use_connect = False
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


BLEND_PARENT = {
    "pelvis": "root",
    "spine": "pelvis",
    "chest": "spine",
    "torso": "pelvis",
    "neck": "chest",
    "head": "neck",
    "upper_arm.L": "chest",
    "upper_arm.R": "chest",
    "forearm.L": "upper_arm.L",
    "forearm.R": "upper_arm.R",
    "hand.L": "forearm.L",
    "hand.R": "forearm.R",
    "thigh.L": "pelvis",
    "thigh.R": "pelvis",
    "shin.L": "thigh.L",
    "shin.R": "thigh.R",
    "foot.L": "shin.L",
    "foot.R": "shin.R",
    "mantle.L": "chest",
    "mantle.R": "chest",
}


def rigid_weight(obj, bone_name):
    """Weight deforming shells at their seam while keeping equipment rigid."""
    indices = list(range(len(obj.data.vertices)))
    parent_name = BLEND_PARENT.get(bone_name)
    vertex_group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
    deforming_keywords = ("torso", "cuirass", "upper arm", "forearm", "sleeve", "trouser", "boot shaft", "stilt", "mantle split")
    use_seam = bool(parent_name and any(keyword in obj.name.lower() for keyword in deforming_keywords))
    if not use_seam:
        vertex_group.add(indices, 1.0, "REPLACE")
        return obj

    parent_group = obj.vertex_groups.get(parent_name) or obj.vertex_groups.new(name=parent_name)
    z_values = [vertex.co.z for vertex in obj.data.vertices]
    z_min = min(z_values)
    z_span = max(1e-5, max(z_values) - z_min)
    blend_from_max = bone_name.startswith("mantle.")
    for vertex in obj.data.vertices:
        normalized = (vertex.co.z - z_min) / z_span
        seam_distance = (1.0 - normalized) if blend_from_max else normalized
        seam = max(0.0, 1.0 - seam_distance / 0.38)
        parent_weight = 0.30 * seam * seam
        vertex_group.add([vertex.index], 1.0 - parent_weight, "REPLACE")
        if parent_weight > 0.0001:
            parent_group.add([vertex.index], parent_weight, "REPLACE")
    return obj


def finalize_rigged_parts(prefix, armature, parts_by_material, collection):
    meshes = []
    for material, parts in parts_by_material.items():
        joined = join_meshes(f"{prefix} · {material.name}", parts, material)
        if joined is None:
            continue
        prepare_export_mesh(joined)
        move_to_collection(joined, collection)
        joined.parent = armature
        joined.matrix_parent_inverse = armature.matrix_world.inverted()
        armature_modifier = joined.modifiers.new("Deform rig", "ARMATURE")
        armature_modifier.object = armature
        armature_modifier.use_deform_preserve_volume = True
        meshes.append(joined)
    return meshes


def add_part(parts, material, obj, bone):
    rigid_weight(obj, bone)
    parts[material].append(obj)
    return obj


def create_hero(materials):
    collection = create_collection("CHAR_Hero_TidemarkSurveyor")
    bone_specs = [
        ("root", (0, 0, 0.02), (0, 0, 0.24), None),
        ("pelvis", (0, 0, 0.90), (0, 0, 1.18), "root"),
        ("spine", (0, 0, 1.18), (0, 0, 1.58), "pelvis"),
        ("chest", (0, 0, 1.58), (0, 0, 1.94), "spine"),
        ("neck", (0, 0, 1.94), (0, 0, 2.10), "chest"),
        ("head", (0, 0, 2.10), (0, 0, 2.45), "neck"),
        ("upper_arm.L", (-0.34, 0, 1.85), (-0.56, 0, 1.49), "chest"),
        ("forearm.L", (-0.56, 0, 1.49), (-0.60, -0.02, 1.16), "upper_arm.L"),
        ("hand.L", (-0.60, -0.02, 1.16), (-0.60, -0.05, 0.98), "forearm.L"),
        ("upper_arm.R", (0.34, 0, 1.85), (0.56, 0, 1.49), "chest"),
        ("forearm.R", (0.56, 0, 1.49), (0.60, -0.02, 1.16), "upper_arm.R"),
        ("hand.R", (0.60, -0.02, 1.16), (0.60, -0.05, 0.98), "forearm.R"),
        ("thigh.L", (-0.19, 0, 1.04), (-0.21, 0, 0.59), "pelvis"),
        ("shin.L", (-0.21, 0, 0.59), (-0.22, 0, 0.17), "thigh.L"),
        ("foot.L", (-0.22, 0, 0.17), (-0.22, -0.22, 0.08), "shin.L"),
        ("thigh.R", (0.19, 0, 1.04), (0.21, 0, 0.59), "pelvis"),
        ("shin.R", (0.21, 0, 0.59), (0.22, 0, 0.17), "thigh.R"),
        ("foot.R", (0.22, 0, 0.17), (0.22, -0.22, 0.08), "shin.R"),
        ("mantle.L", (-0.18, 0.12, 1.72), (-0.31, 0.20, 0.94), "chest"),
        ("mantle.R", (0.18, 0.12, 1.72), (0.31, 0.20, 0.94), "chest"),
        ("socket_hip", (0.30, 0.02, 1.13), (0.44, -0.03, 1.10), "pelvis"),
        ("socket_hand_r", (0.60, -0.05, 1.05), (0.60, -0.12, 0.90), "hand.R"),
        ("socket_hand_l", (-0.60, -0.05, 1.05), (-0.60, -0.12, 0.90), "hand.L"),
        ("socket_back", (0, 0.15, 1.78), (0, 0.28, 1.78), "chest"),
        ("socket_vfx_compass", (-0.24, -0.20, 1.66), (-0.24, -0.30, 1.66), "chest"),
    ]
    armature = create_armature("Tidemark Surveyor", bone_specs, collection)
    parts = defaultdict(list)

    indigo = materials["indigo"]
    ivory = materials["ivory"]
    leather = materials["leather"]
    bronze = materials["bronze"]
    skin = materials["skin"]
    visor = materials["iron"]
    cyan = materials["cyan"]
    reed = materials["reed"]

    # Boots and legs: planted without the oversized, toy-like extremities that
    # flatten the character's otherwise adult proportions at gameplay distance.
    for side, x in (("L", -0.21), ("R", 0.21)):
        add_part(parts, indigo, mesh_cone_between(f"Hero trouser {side}", (x, 0, 1.02), (x, 0, 0.59), 0.137, 0.118, indigo, 14, 0.018), f"thigh.{side}")
        add_part(parts, leather, mesh_cone_between(f"Hero boot shaft {side}", (x, 0, 0.57), (x, -0.01, 0.16), 0.147, 0.120, leather, 14, 0.025), f"shin.{side}")
        add_part(parts, leather, mesh_cube(f"Hero boot foot {side}", (x, -0.11, 0.095), (0.28, 0.44, 0.16), leather, 0.050), f"foot.{side}")
        add_part(parts, bronze, mesh_torus(f"Hero boot ring {side}", (x, 0, 0.55), 0.141, 0.017, bronze, rotation=(0, 0, 0), major_segments=24, minor_segments=8), f"shin.{side}")
        toe_guard = custom_prism(
            f"Hero boot tide toe {side}",
            [(-0.13, 0.055), (-0.10, -0.045), (0.10, -0.045), (0.13, 0.055), (0.08, 0.10), (-0.08, 0.10)],
            0.045,
            (x, -0.322, 0.11),
            bronze,
            0.012,
        )
        add_part(parts, bronze, toe_guard, f"foot.{side}")
        sign = -1 if side == "L" else 1
        add_part(
            parts,
            reed,
            mesh_curve(
                f"Hero gaiter saddle stitch {side}",
                [(x + sign * 0.105, -0.105, 0.49), (x + sign * 0.112, -0.12, 0.34), (x + sign * 0.10, -0.13, 0.19)],
                0.010,
                reed,
            ),
            f"shin.{side}",
        )

    # Torso: compact indigo body under a broad split canvas mantle.
    add_part(parts, indigo, mesh_cone_between("Hero torso", (0, 0, 1.12), (0, 0, 1.90), 0.30, 0.39, indigo, 20, 0.045), "spine")
    add_part(parts, leather, mesh_cube("Hero belt", (0, 0, 1.16), (0.70, 0.41, 0.13), leather, 0.045), "pelvis")
    add_part(parts, bronze, mesh_cube("Hero belt buckle", (0, -0.235, 1.17), (0.16, 0.06, 0.14), bronze, 0.025), "pelvis")
    add_part(parts, ivory, custom_prism("Hero mantle yoke", [(-0.52, -0.10), (-0.44, 0.23), (0.0, 0.34), (0.44, 0.23), (0.52, -0.10), (0.31, -0.21), (0, -0.13), (-0.31, -0.21)], 0.50, (0, 0.01, 1.79), ivory, 0.045), "chest")
    # Layered front tailoring, map pocket, and field repairs turn the mantle
    # into built equipment rather than a single pale primitive.
    add_part(parts, leather, mesh_curve("Hero yoke layered front edge", [(-0.42, -0.273, 1.72), (-0.22, -0.284, 1.61), (0, -0.289, 1.58), (0.22, -0.284, 1.61), (0.42, -0.273, 1.72)], 0.016, leather), "chest")
    add_part(parts, indigo, custom_prism("Hero chest chart pocket", [(-0.14, 0.14), (0.14, 0.14), (0.12, -0.13), (0, -0.18), (-0.12, -0.13)], 0.035, (0.18, -0.286, 1.55), indigo, 0.012), "chest")
    add_part(parts, leather, mesh_curve("Hero chart pocket closure", [(0.055, -0.309, 1.65), (0.18, -0.314, 1.60), (0.30, -0.309, 1.65)], 0.010, leather), "chest")
    for index, (x, z) in enumerate(((0.075, 1.665), (0.285, 1.665), (-0.37, 1.72))):
        add_part(parts, bronze, mesh_ico(f"Hero yoke field fastener {index}", (x, -0.320, z), (0.018, 0.012, 0.018), bronze, 1), "chest")
    add_part(parts, leather, custom_prism("Hero offset belt pouch", [(-0.12, 0.12), (0.12, 0.10), (0.11, -0.12), (0.04, -0.16), (-0.11, -0.12)], 0.09, (-0.26, -0.245, 1.06), leather, 0.020), "pelvis")
    add_part(parts, bronze, mesh_cube("Hero offset pouch latch", (-0.26, -0.303, 1.09), (0.06, 0.025, 0.07), bronze, 0.009), "pelvis")

    left_panel = custom_prism("Hero mantle split left", [(-0.34, 0.28), (-0.05, 0.22), (-0.08, -0.52), (-0.35, -0.44)], 0.10, (0, 0.24, 1.50), ivory, 0.025)
    right_panel = custom_prism("Hero mantle split right", [(0.05, 0.22), (0.34, 0.28), (0.35, -0.44), (0.08, -0.52)], 0.10, (0, 0.24, 1.50), ivory, 0.025)
    add_part(parts, ivory, left_panel, "mantle.L")
    add_part(parts, ivory, right_panel, "mantle.R")
    for side, sign in (("L", -1), ("R", 1)):
        seam = mesh_curve(
            f"Hero mantle stitched edge {side}",
            [(sign * 0.055, 0.305, 1.72), (sign * 0.075, 0.31, 1.42), (sign * 0.10, 0.305, 0.80)],
            0.012,
            leather,
        )
        add_part(parts, leather, seam, f"mantle.{side}")
        outer_x = sign * 0.33
        add_part(
            parts,
            reed,
            mesh_curve(
                f"Hero mantle weathered hem {side}",
                [(sign * 0.09, 0.305, 1.00), (sign * 0.20, 0.312, 1.015), (outer_x, 0.305, 1.06)],
                0.011,
                reed,
            ),
            f"mantle.{side}",
        )

    # Break the pale rear mass into an equipment-bearing coat rather than a
    # single rectangular cape. The indigo keel and cross-strap remain readable
    # at gameplay distance and explain how the two canvas leaves are carried.
    add_part(parts, indigo, custom_prism("Hero mantle rear keel", [(-0.12, 0.22), (0.12, 0.22), (0.10, -0.42), (0, -0.55), (-0.10, -0.42)], 0.035, (0, 0.315, 1.50), indigo, 0.014), "chest")
    add_part(parts, leather, mesh_curve("Hero rear load strap", [(-0.29, 0.345, 1.77), (-0.04, 0.36, 1.50), (0.27, 0.345, 1.16)], 0.026, leather), "chest")
    for z in (1.66, 1.34):
        add_part(parts, bronze, mesh_cube(f"Hero rear strap clasp {z:.2f}", (0, 0.365, z), (0.115, 0.035, 0.075), bronze, 0.014), "chest")

    # Head: a narrower, faceted hood and structural cowl replace the spherical
    # head read. The stepped cheek plates preserve a small visor opening while
    # giving the face a deliberately authored profile from three-quarter views.
    add_part(
        parts,
        indigo,
        custom_prism(
            "Hero structured hood",
            [(-0.19, -0.17), (-0.20, 0.10), (-0.13, 0.24), (-0.03, 0.30), (0.11, 0.25), (0.20, 0.10), (0.18, -0.15), (0.08, -0.23), (-0.09, -0.23)],
            0.44,
            (0, 0.015, 2.20),
            indigo,
            0.028,
        ),
        "head",
    )
    add_part(
        parts,
        indigo,
        custom_prism("Hero hood cowl", [(-0.24, 0.08), (-0.17, 0.16), (0.17, 0.16), (0.24, 0.08), (0.18, -0.09), (-0.18, -0.09)], 0.34, (0, 0.02, 1.99), indigo, 0.022),
        "neck",
    )
    add_part(parts, visor, mesh_ico("Hero recessed visor", (0, -0.205, 2.20), (0.128, 0.045, 0.135), visor, 2), "head")
    add_part(parts, ivory, custom_prism("Hero brow mask", [(-0.16, 0.07), (0, 0.135), (0.16, 0.07), (0.11, -0.09), (0, -0.05), (-0.11, -0.09)], 0.040, (0, -0.265, 2.235), ivory, 0.016), "head")
    for side, sign in (("L", -1), ("R", 1)):
        cheek_vertices = [(-0.070, 0.075), (0.070, 0.075), (0.065, -0.065), (0.010, -0.155), (-0.070, -0.075)]
        if sign > 0:
            cheek_vertices = [(-x, z) for x, z in reversed(cheek_vertices)]
        add_part(parts, ivory, custom_prism(f"Hero stepped cheek plate {side}", cheek_vertices, 0.040, (sign * 0.105, -0.267, 2.145), ivory, 0.010), "head")
    add_part(parts, cyan, mesh_cube("Hero visor light slit", (0, -0.297, 2.25), (0.135, 0.018, 0.026), cyan, 0.007), "head")
    for x in (-0.075, 0.075):
        add_part(parts, bronze, mesh_ico("Hero mask rivet", (x, -0.312, 2.24), (0.018, 0.012, 0.018), bronze, 2), "head")

    # Arms use planar articulation shells instead of spherical toy joints.
    arm_specs = [
        ("L", (-0.34, 0, 1.85), (-0.56, 0, 1.49), (-0.60, -0.02, 1.16)),
        ("R", (0.34, 0, 1.85), (0.56, 0, 1.49), (0.60, -0.02, 1.16)),
    ]
    for side, shoulder, elbow, wrist in arm_specs:
        add_part(parts, indigo, mesh_cone_between(f"Hero upper arm {side}", shoulder, elbow, 0.14, 0.115, indigo, 14, 0.018), f"upper_arm.{side}")
        shoulder_sign = -1 if side == "L" else 1
        shoulder_shell = [(-0.18, 0.03), (-0.10, 0.15), (0.10, 0.13), (0.18, 0.02), (0.09, -0.14), (-0.12, -0.14)]
        if shoulder_sign > 0:
            shoulder_shell = [(-x, z) for x, z in reversed(shoulder_shell)]
        add_part(parts, bronze, custom_prism(f"Hero shoulder articulation {side}", shoulder_shell, 0.30, (shoulder[0] + shoulder_sign * 0.035, 0.015, shoulder[2] - 0.02), bronze, 0.020), f"upper_arm.{side}")
        add_part(parts, ivory, mesh_cone_between(f"Hero sleeve {side}", elbow, wrist, 0.13, 0.105, ivory, 14, 0.018), f"forearm.{side}")
        elbow_shell = [(-0.12, 0.03), (-0.07, 0.13), (0.07, 0.13), (0.13, 0.01), (0.08, -0.12), (-0.08, -0.12)]
        if shoulder_sign > 0:
            elbow_shell = [(-x, z) for x, z in reversed(elbow_shell)]
        add_part(parts, bronze, custom_prism(f"Hero elbow cap {side}", elbow_shell, 0.25, elbow, bronze, 0.016), f"forearm.{side}")
        add_part(parts, leather, mesh_ico(f"Hero glove {side}", (wrist[0], wrist[1] - 0.02, wrist[2] - 0.085), (0.12, 0.105, 0.15), leather, 2), f"hand.{side}")
        cuff_start = Vector(elbow).lerp(Vector(wrist), 0.68)
        cuff_end = Vector(elbow).lerp(Vector(wrist), 0.82)
        add_part(parts, bronze, mesh_cone_between(f"Hero articulated cuff {side}", cuff_start, cuff_end, 0.116, 0.108, bronze, 14, 0.010), f"forearm.{side}")
        add_part(parts, reed, mesh_curve(f"Hero sleeve repair binding {side}", [tuple(Vector(elbow).lerp(Vector(wrist), 0.26) + Vector((0, -0.115, 0))), tuple(Vector(elbow).lerp(Vector(wrist), 0.42) + Vector((0, -0.112, 0)))], 0.009, reed), f"forearm.{side}")

    for side, x in (("L", -0.21), ("R", 0.21)):
        add_part(parts, bronze, custom_prism(f"Hero knee guard {side}", [(-0.11, 0.10), (0.11, 0.10), (0.13, -0.07), (0, -0.14), (-0.13, -0.07)], 0.045, (x, -0.145, 0.58), bronze, 0.016), f"shin.{side}")
        add_part(parts, leather, mesh_torus(f"Hero thigh equipment strap {side}", (x, 0, 0.80), 0.13, 0.017, leather, major_segments=20, minor_segments=7), f"thigh.{side}")

    # Asymmetric survey instrument case and shoulder harness.
    add_part(parts, leather, mesh_cube("Hero instrument case", (-0.47, 0.20, 1.84), (0.27, 0.23, 0.56), leather, 0.065, rotation=(0.03, -0.16, -0.12)), "chest")
    add_part(parts, bronze, mesh_torus("Hero instrument case ring", (-0.48, 0.045, 2.08), 0.115, 0.025, bronze, rotation=(math.pi / 2, 0, 0), major_segments=24, minor_segments=8), "chest")
    add_part(parts, bronze, mesh_cube("Hero instrument case clasp", (-0.50, 0.066, 1.80), (0.11, 0.035, 0.18), bronze, 0.018, rotation=(0.03, -0.16, -0.12)), "chest")
    harness = mesh_curve("Hero diagonal harness", [(-0.46, -0.21, 1.91), (-0.12, -0.29, 1.58), (0.28, -0.25, 1.21)], 0.035, leather)
    add_part(parts, leather, harness, "chest")

    # Sounding rod: a long readable diagonal with a trident-like measuring head.
    rod_start = (0.62, -0.07, 1.05)
    rod_end = (0.91, 0.02, 2.48)
    add_part(parts, bronze, mesh_cone_between("Hero sounding rod", rod_start, rod_end, 0.035, 0.028, bronze, 12, 0.008), "hand.R")
    rod_start_vec = Vector(rod_start)
    rod_end_vec = Vector(rod_end)
    for index, t in enumerate((0.14, 0.23, 0.67)):
        band_start = rod_start_vec.lerp(rod_end_vec, t)
        band_end = rod_start_vec.lerp(rod_end_vec, t + 0.035)
        add_part(parts, leather if index < 2 else bronze, mesh_cone_between(f"Hero sounding rod grip band {index}", band_start, band_end, 0.048, 0.046, leather if index < 2 else bronze, 12, 0.006), "hand.R")
    add_part(parts, cyan, mesh_ico("Hero rod crystal", (0.93, 0.02, 2.57), (0.095, 0.065, 0.15), cyan, 2, rotation=(0.15, 0, -0.1)), "hand.R")
    for offset in (-0.09, 0.09):
        add_part(parts, bronze, mesh_cone_between("Hero rod fork", (0.92, 0.01, 2.47), (0.92 + offset, 0.01, 2.68), 0.018, 0.012, bronze, 10, 0.005), "hand.R")

    # Chest compass provides the sole cool hero accent.
    add_part(parts, bronze, mesh_torus("Hero compass bezel", (-0.23, -0.30, 1.68), 0.11, 0.025, bronze, rotation=(math.pi / 2, 0, 0), major_segments=28, minor_segments=8), "chest")
    add_part(parts, cyan, mesh_ico("Hero compass lens", (-0.23, -0.328, 1.68), (0.078, 0.025, 0.078), cyan, 2), "chest")
    for index, angle in enumerate((0.0, math.pi * 0.5, math.pi, math.pi * 1.5)):
        add_part(parts, ivory, mesh_ico(f"Hero compass cardinal stud {index}", (-0.23 + math.cos(angle) * 0.145, -0.340, 1.68 + math.sin(angle) * 0.145), (0.014, 0.010, 0.014), ivory, 1), "chest")

    meshes = finalize_rigged_parts("Hero", armature, parts, collection)
    armature["asset_kind"] = "hero"
    armature["forward_axis"] = "-Y"
    armature["grounded_height_m"] = 2.70
    marker = bpy.data.objects.new("marker_forward", None)
    collection.objects.link(marker)
    marker.parent = armature
    marker.location = (0, -0.72, 1.25)
    marker.empty_display_type = "SINGLE_ARROW"
    marker.empty_display_size = 0.22
    marker["marker_role"] = "forward"
    metadata_empty(
        "collision_capsule_hero",
        collection,
        armature,
        (0, 0, 1.24),
        (0.40, 0.40, 1.20),
        {"collision_shape": "capsule", "radius_m": 0.40, "height_m": 2.40},
    )
    return {"root": armature, "meshes": meshes, "collection": collection}


def create_sentinel(materials):
    collection = create_collection("CHAR_Enemy_BellWarden")
    bone_specs = [
        ("root", (0, 0, 0.02), (0, 0, 0.25), None),
        ("pelvis", (0, 0, 1.00), (0, 0, 1.28), "root"),
        ("torso", (0, 0, 1.28), (0, 0, 2.18), "pelvis"),
        ("head", (0, 0, 2.18), (0, 0, 2.64), "torso"),
        ("upper_arm.L", (-0.43, 0, 2.03), (-0.70, 0, 1.62), "torso"),
        ("forearm.L", (-0.70, 0, 1.62), (-0.78, -0.04, 1.20), "upper_arm.L"),
        ("hand.L", (-0.78, -0.04, 1.20), (-0.78, -0.08, 1.00), "forearm.L"),
        ("upper_arm.R", (0.43, 0, 2.03), (0.68, 0, 1.64), "torso"),
        ("forearm.R", (0.68, 0, 1.64), (0.78, -0.02, 1.19), "upper_arm.R"),
        ("hand.R", (0.78, -0.02, 1.19), (0.78, -0.07, 0.98), "forearm.R"),
        ("thigh.L", (-0.22, 0, 1.08), (-0.25, 0, 0.57), "pelvis"),
        ("shin.L", (-0.25, 0, 0.57), (-0.28, 0, 0.12), "thigh.L"),
        ("foot.L", (-0.28, 0, 0.12), (-0.28, -0.20, 0.06), "shin.L"),
        ("thigh.R", (0.22, 0, 1.08), (0.25, 0, 0.57), "pelvis"),
        ("shin.R", (0.25, 0, 0.57), (0.28, 0, 0.12), "thigh.R"),
        ("foot.R", (0.28, 0, 0.12), (0.28, -0.20, 0.06), "shin.R"),
        ("socket_anchor", (-0.78, -0.08, 1.06), (-0.78, -0.16, 0.90), "hand.L"),
        ("socket_eye_vfx", (0, -0.40, 2.30), (0, -0.52, 2.30), "head"),
        ("socket_hit_core", (0, -0.38, 1.78), (0, -0.50, 1.78), "torso"),
    ]
    armature = create_armature("Bell Warden", bone_specs, collection)
    parts = defaultdict(list)
    iron = materials["iron"]
    bronze = materials["bronze"]
    reed = materials["reed"]
    wet_stone = materials["wet_stone"]
    amber = materials["amber"]

    # Long stilted legs establish a silhouette unlike the compact hero.
    for side, x in (("L", -0.24), ("R", 0.24)):
        add_part(parts, iron, mesh_cone_between(f"Sentinel upper stilt {side}", (x, 0, 1.10), (x * 1.08, 0, 0.57), 0.11, 0.085, iron, 12, 0.018), f"thigh.{side}")
        add_part(parts, bronze, mesh_torus(f"Sentinel knee bearing {side}", (x * 1.08, -0.012, 0.57), 0.105, 0.026, bronze, rotation=(math.pi / 2, 0, 0), major_segments=24, minor_segments=8), f"shin.{side}")
        add_part(parts, iron, mesh_ico(f"Sentinel knee axle {side}", (x * 1.08, -0.035, 0.57), (0.062, 0.045, 0.062), iron, 1), f"shin.{side}")
        add_part(parts, iron, mesh_cone_between(f"Sentinel lower stilt {side}", (x * 1.08, 0, 0.54), (x * 1.18, 0, 0.12), 0.09, 0.065, iron, 12, 0.015), f"shin.{side}")
        add_part(parts, wet_stone, custom_prism(f"Sentinel talon {side}", [(-0.14, 0.10), (0.12, 0.10), (0.21, -0.06), (0.04, -0.14), (-0.18, -0.08)], 0.28, (x * 1.18, -0.12, 0.12), wet_stone, 0.025), f"foot.{side}")
        add_part(parts, bronze, mesh_torus(f"Sentinel stilt service collar {side}", (x * 1.05, 0, 0.82), 0.105, 0.018, bronze, rotation=(0, 0, 0), major_segments=20, minor_segments=7), f"thigh.{side}")
        for stud_index, stud_y in enumerate((-0.075, 0.075)):
            add_part(parts, bronze, mesh_ico(f"Sentinel knee lock {side} {stud_index}", (x * 1.08, stud_y, 0.57), (0.025, 0.018, 0.025), bronze, 1), f"shin.{side}")

    # Cracked pressure-bell cuirass: one dominant top-heavy form.
    add_part(parts, iron, mesh_cone_between("Sentinel bell cuirass", (0, 0, 1.24), (0, 0, 2.22), 0.57, 0.39, iron, 24, 0.055), "torso")
    add_part(parts, bronze, mesh_torus("Sentinel bell lip", (0, 0, 1.25), 0.56, 0.075, bronze, rotation=(0, 0, 0), major_segments=48, minor_segments=10), "torso")
    add_part(parts, bronze, mesh_torus("Sentinel pressure collar", (0, 0, 2.15), 0.37, 0.055, bronze, rotation=(0, 0, 0), major_segments=40, minor_segments=10), "torso")
    # Narrow service seams and repair plates explain how the pressure bell was
    # assembled and field-maintained without diluting its dominant silhouette.
    add_part(parts, bronze, mesh_torus("Sentinel lower service seam", (0, 0, 1.52), 0.515, 0.017, bronze, rotation=(0, 0, 0), major_segments=40, minor_segments=7), "torso")
    add_part(parts, bronze, mesh_torus("Sentinel upper service seam", (0, 0, 1.86), 0.455, 0.015, bronze, rotation=(0, 0, 0), major_segments=40, minor_segments=7), "torso")
    repair_patch = mesh_cube("Sentinel asymmetric pressure patch", (0.31, -0.548, 1.73), (0.30, 0.045, 0.37), wet_stone, 0.018, rotation=(0.0, 0.0, -0.065))
    add_part(parts, wet_stone, repair_patch, "torso")
    for index, (x, z) in enumerate(((0.19, 1.87), (0.43, 1.84), (0.45, 1.61), (0.22, 1.56))):
        add_part(parts, bronze, mesh_ico(f"Sentinel pressure patch fastener {index}", (x, -0.590, z), (0.025, 0.014, 0.025), bronze, 1), "torso")
    add_part(
        parts,
        iron,
        custom_prism(
            "Sentinel faceted crown",
            [(-0.34, -0.13), (-0.29, 0.16), (-0.13, 0.33), (0, 0.40), (0.13, 0.33), (0.29, 0.16), (0.34, -0.13), (0.19, -0.24), (-0.19, -0.24)],
            0.58,
            (0, 0.015, 2.32),
            iron,
            0.035,
        ),
        "head",
    )
    add_part(parts, amber, mesh_ico("Sentinel recessed eye", (0, -0.31, 2.34), (0.12, 0.045, 0.08), amber, 2), "head")
    add_part(parts, bronze, mesh_torus("Sentinel eye shutter", (0, -0.325, 2.34), 0.16, 0.028, bronze, rotation=(math.pi / 2, 0, 0), major_segments=28, minor_segments=8), "head")
    add_part(parts, bronze, custom_prism("Sentinel crown brow hood", [(-0.25, 0.045), (0, 0.15), (0.25, 0.045), (0.18, -0.045), (0, 0.015), (-0.18, -0.045)], 0.045, (0, -0.273, 2.385), bronze, 0.014), "head")

    # Secondary pressure hardware keeps the rear and side views authored. A
    # ballast vessel, dorsal rail, and unequal shoulder shells describe weight
    # distribution even when the eye and chest crack are out of view.
    add_part(parts, wet_stone, mesh_uvsphere("Sentinel rear ballast vessel", (0, 0.40, 1.76), (0.28, 0.22, 0.50), wet_stone, 28, 14), "torso")
    add_part(parts, bronze, mesh_torus("Sentinel rear ballast collar", (0, 0.39, 2.02), 0.25, 0.035, bronze, rotation=(math.pi / 2, 0, 0), major_segments=28, minor_segments=8), "torso")
    add_part(parts, bronze, mesh_torus("Sentinel ballast tide gauge bezel", (0.02, 0.628, 1.79), 0.105, 0.022, bronze, rotation=(math.pi / 2, 0, 0), major_segments=24, minor_segments=7), "torso")
    add_part(parts, amber, mesh_ico("Sentinel ballast tide gauge lens", (0.02, 0.650, 1.79), (0.073, 0.018, 0.073), amber, 2), "torso")
    add_part(parts, iron, custom_prism("Sentinel dorsal pressure rail", [(-0.07, 0.40), (0.07, 0.40), (0.10, -0.36), (0, -0.48), (-0.10, -0.36)], 0.10, (0, 0.55, 1.76), iron, 0.018), "torso")
    for index, z in enumerate((1.52, 1.72, 1.92)):
        add_part(parts, bronze, mesh_curve(f"Sentinel rear shell rib {index}", [(-0.36, 0.49, z), (0, 0.56, z + 0.035), (0.36, 0.49, z)], 0.022, bronze), "torso")
    add_part(parts, wet_stone, custom_prism("Sentinel anchor pauldron", [(-0.23, 0.10), (-0.16, 0.23), (0.10, 0.19), (0.24, 0.03), (0.12, -0.18), (-0.15, -0.20)], 0.36, (-0.47, 0.02, 2.00), wet_stone, 0.026), "upper_arm.L")
    add_part(parts, reed, custom_prism("Sentinel cage pauldron", [(-0.18, 0.04), (-0.10, 0.18), (0.13, 0.15), (0.20, -0.01), (0.09, -0.17), (-0.13, -0.16)], 0.28, (0.46, 0.02, 2.00), reed, 0.022), "upper_arm.R")
    add_part(parts, iron, mesh_curve("Sentinel left exhaust hose", [(-0.30, 0.40, 2.05), (-0.55, 0.46, 1.82), (-0.60, 0.36, 1.49)], 0.032, iron), "torso")

    # Load-path ribs and a literal crack gap strengthen scale and history.
    for angle in (-0.72, -0.30, 0.30, 0.72):
        x = math.sin(angle) * 0.45
        add_part(parts, bronze, mesh_curve(f"Sentinel cuirass rib {angle:+.2f}", [(x * 0.65, -0.39, 2.05), (x, -0.51, 1.68), (x * 1.12, -0.48, 1.32)], 0.026, bronze), "torso")
    crack = mesh_curve("Sentinel focal crack", [(-0.03, -0.545, 2.04), (0.07, -0.57, 1.88), (-0.03, -0.58, 1.70), (0.08, -0.54, 1.48)], 0.016, amber)
    add_part(parts, amber, crack, "torso")

    # Left arm terminates in an oversized anchor gauntlet.
    add_part(parts, iron, mesh_cone_between("Sentinel anchor upper arm", (-0.43, 0, 2.02), (-0.70, 0, 1.62), 0.18, 0.15, iron, 14, 0.025), "upper_arm.L")
    add_part(parts, bronze, custom_prism("Sentinel anchor elbow", [(-0.17, 0.05), (-0.10, 0.19), (0.11, 0.17), (0.19, 0.01), (0.10, -0.18), (-0.12, -0.18)], 0.34, (-0.70, 0, 1.62), bronze, 0.022), "forearm.L")
    add_part(parts, iron, mesh_cone_between("Sentinel anchor forearm", (-0.70, 0, 1.60), (-0.78, -0.04, 1.17), 0.16, 0.20, iron, 14, 0.025), "forearm.L")
    add_part(parts, iron, custom_prism("Sentinel anchor palm", [(-0.23, 0.13), (-0.14, 0.23), (0.16, 0.20), (0.24, 0.05), (0.16, -0.20), (-0.16, -0.20), (-0.25, -0.04)], 0.38, (-0.79, -0.03, 0.99), iron, 0.045), "hand.L")
    add_part(parts, wet_stone, mesh_cube("Sentinel anchor palm wear plate", (-0.79, -0.242, 1.00), (0.30, 0.045, 0.27), wet_stone, 0.018, rotation=(0.0, 0.0, 0.08)), "hand.L")
    for index, x_offset in enumerate((-0.105, 0.105)):
        add_part(parts, bronze, mesh_ico(f"Sentinel anchor palm bolt {index}", (-0.79 + x_offset, -0.268, 1.055), (0.024, 0.014, 0.024), bronze, 1), "hand.L")
    anchor_shape = [(-0.05, 0.32), (0.11, 0.32), (0.14, 0.04), (0.38, -0.02), (0.50, -0.30), (0.18, -0.19), (0.03, -0.48), (-0.12, -0.18), (-0.44, -0.28), (-0.35, 0.00), (-0.10, 0.05)]
    add_part(parts, bronze, custom_prism("Sentinel anchor flukes", anchor_shape, 0.19, (-0.80, -0.06, 0.78), bronze, 0.04), "hand.L")

    # Right arm is an open reed cage: narrow, long, and visually porous.
    add_part(parts, iron, mesh_cone_between("Sentinel cage upper arm", (0.43, 0, 2.02), (0.68, 0, 1.64), 0.14, 0.11, iron, 12, 0.02), "upper_arm.R")
    add_part(parts, bronze, custom_prism("Sentinel cage elbow", [(-0.14, 0.04), (-0.08, 0.15), (0.09, 0.14), (0.16, 0.01), (0.08, -0.15), (-0.09, -0.14)], 0.28, (0.68, 0, 1.64), bronze, 0.018), "forearm.R")
    for index in range(6):
        angle = index / 6 * TAU
        offset = Vector((math.cos(angle) * 0.12, math.sin(angle) * 0.08, 0))
        start = Vector((0.70, 0, 1.58)) + offset
        end = Vector((0.79, -0.02, 1.02)) + offset * 0.72
        add_part(parts, reed, mesh_cone_between(f"Sentinel cage reed {index}", start, end, 0.018, 0.014, reed, 8, 0.004), "forearm.R")
    add_part(parts, bronze, mesh_torus("Sentinel cage wrist ring", (0.79, -0.02, 1.04), 0.105, 0.022, bronze, rotation=(0, 0, 0), major_segments=24, minor_segments=8), "hand.R")
    add_part(parts, bronze, mesh_torus("Sentinel cage upper binding", (0.73, -0.01, 1.42), 0.115, 0.018, bronze, rotation=(0, 0, 0), major_segments=24, minor_segments=7), "forearm.R")
    add_part(parts, amber, mesh_ico("Sentinel cage heart", (0.79, -0.04, 1.12), (0.07, 0.06, 0.10), amber, 2), "hand.R")

    # Hanging reed tassels give restrained secondary motion cues.
    for index, x in enumerate((-0.38, -0.18, 0.18, 0.38)):
        tassel = mesh_curve(f"Sentinel tide reed {index}", [(x, 0.30, 1.35), (x * 1.1, 0.35, 1.02), (x * 1.18, 0.31, 0.72)], 0.025, reed)
        add_part(parts, reed, tassel, "pelvis")

    meshes = finalize_rigged_parts("Sentinel", armature, parts, collection)
    armature.scale = (1.18, 1.18, 1.18)
    armature["author_scale"] = 1.18
    armature["asset_kind"] = "sentinel"
    armature["forward_axis"] = "-Y"
    armature["grounded_height_m"] = 3.22
    marker = bpy.data.objects.new("marker_forward", None)
    collection.objects.link(marker)
    marker.parent = armature
    marker.location = (0, -0.78, 1.45)
    marker.empty_display_type = "SINGLE_ARROW"
    marker.empty_display_size = 0.24
    marker["marker_role"] = "forward"
    metadata_empty(
        "collision_capsule_sentinel",
        collection,
        armature,
        (0, 0, 1.46),
        (0.66, 0.66, 1.43),
        {"collision_shape": "capsule", "radius_m": 0.66, "height_m": 2.86},
    )
    return {"root": armature, "meshes": meshes, "collection": collection}


def create_gate(materials):
    collection = create_collection("ENV_MeridianLock_Gate")
    root = bpy.data.objects.new("Meridian Lock Root", None)
    collection.objects.link(root)
    root["asset_kind"] = "orrery_gate"
    root["grounded_height_m"] = 18.0

    stone = materials["stone"]
    wet_stone = materials["wet_stone"]
    bronze = materials["bronze"]
    iron = materials["iron"]
    light = materials["gate_light"]
    parts = defaultdict(list)
    moving_parts = defaultdict(list)
    mechanism = bpy.data.objects.new("Meridian Lock Mechanism", None)
    collection.objects.link(mechanism)
    mechanism.parent = root
    mechanism["mechanism_role"] = "aperture_rotor"

    def gate_part(material, obj):
        parts[material].append(obj)
        return obj

    def moving_gate_part(material, obj):
        moving_parts[material].append(obj)
        return obj

    center = (0.0, 0.0, 8.8)
    # Monumental broken halo. Each sector is varied by causal load damage, not random noise.
    sector_count = 18
    missing = {3, 4, 5}
    for index in range(sector_count):
        if index in missing:
            continue
        angle0 = index / sector_count * TAU + 0.012
        angle1 = (index + 1) / sector_count * TAU - 0.012
        material = wet_stone if math.sin((angle0 + angle1) * 0.5) < -0.15 else stone
        outer = 8.65 - (0.26 if index in {2, 6, 12} else 0.0)
        inner = 7.15 + (0.18 if index in {1, 8, 14} else 0.0)
        segment = annular_segment(
            f"Gate halo sector {index:02d}",
            center,
            inner,
            outer,
            angle0,
            angle1,
            1.15,
            material,
            steps=7,
            bevel=0.09,
        )
        gate_part(material, segment)

        # Paired service pins at each sector make the halo read as a built,
        # maintainable lock rather than a uniformly extruded stone wheel.
        mid = (angle0 + angle1) * 0.5
        for radial_index, radius in enumerate((7.34, 8.40)):
            x = math.cos(mid) * radius
            z = center[2] + math.sin(mid) * radius
            gate_part(bronze, mesh_ico(f"Gate sector pin {index:02d} {radial_index}", (x, -0.607, z), (0.095, 0.055, 0.095), bronze, 1))

        # Bronze load straps only on intact, high-stress sectors.
        if index in {0, 1, 7, 8, 9, 10, 11, 15, 16, 17}:
            x = math.cos(mid) * 7.92
            z = center[2] + math.sin(mid) * 7.92
            strap = mesh_cube(
                f"Gate radial strap {index:02d}",
                (x, -0.63, z),
                (0.28, 0.22, 1.30),
                bronze,
                0.045,
                rotation=(0.0, -mid + math.pi / 2, 0.0),
            )
            # Rotate in the gate plane; cube local Z points radially after a Y rotation.
            strap.rotation_euler = (0.0, mid - math.pi / 2, 0.0)
            activate(strap)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=False)
            gate_part(bronze, strap)

    # Broken upper quadrant exposes snapped reinforcement rods.
    for index, angle in enumerate((0.72, 0.94, 1.17)):
        start = (math.cos(angle) * 7.25, -0.04, center[2] + math.sin(angle) * 7.25)
        end = (math.cos(angle) * 8.20, -0.04, center[2] + math.sin(angle) * 8.20)
        gate_part(iron, mesh_cone_between(f"Gate snapped rebar {index}", start, end, 0.105, 0.045, iron, 10, 0.012))

    # Offset meridian arcs with mechanical bearings and unequal timing hierarchy.
    for ring_index, (radius, y, thickness, tilt) in enumerate(
        (
            (6.72, -0.82, 0.17, 0.0),
            (5.95, -1.02, 0.135, 0.32),
            (5.20, -1.20, 0.11, -0.41),
        )
    ):
        ring = mesh_torus(
            f"Gate meridian ring {ring_index}",
            (0, y, center[2]),
            radius,
            thickness,
            bronze,
            rotation=(math.pi / 2, tilt, 0.0),
            major_segments=96,
            minor_segments=12,
        )
        moving_gate_part(bronze, ring)
        for bearing_index in range(6):
            angle = bearing_index / 6 * TAU + ring_index * 0.17
            moving_gate_part(
                bronze,
                mesh_ico(
                    f"Gate meridian bearing {ring_index} {bearing_index}",
                    (math.cos(angle) * radius, y - 0.13, center[2] + math.sin(angle) * radius),
                    (thickness * 1.35, thickness * 0.72, thickness * 1.35),
                    bronze,
                    1,
                ),
            )

    # Recessed shutter leaves and a rear throat collar give the aperture three
    # distinct depth planes. They travel with the mechanism so the settled open
    # state leaves an unequivocal, fully clear passage instead of a floating
    # shutter wheel in the doorway.
    moving_gate_part(iron, mesh_torus("Gate rear throat collar", (0, -0.40, center[2]), 2.92, 0.17, iron, rotation=(math.pi / 2, 0, 0), major_segments=72, minor_segments=10))
    for shutter_index in range(12):
        angle0 = shutter_index / 12 * TAU + 0.055
        angle1 = (shutter_index + 0.72) / 12 * TAU - 0.025
        moving_gate_part(
            iron,
            annular_segment(
                f"Gate recessed shutter leaf {shutter_index:02d}",
                (0, -0.56, center[2]),
                0.82,
                2.72,
                angle0,
                angle1,
                0.20,
                iron,
                steps=5,
                bevel=0.0,
            ),
        )

    # Inner aperture and restrained cold fire.
    moving_gate_part(bronze, mesh_torus("Gate aperture bezel", (0, -1.36, center[2]), 3.70, 0.34, bronze, rotation=(math.pi / 2, 0, 0), major_segments=96, minor_segments=16))
    moving_gate_part(light, mesh_torus("Gate aperture light", (0, -1.57, center[2]), 3.24, 0.12, light, rotation=(math.pi / 2, 0, 0), major_segments=96, minor_segments=12))
    for spoke_index in range(8):
        angle = spoke_index / 8 * TAU + math.pi / 8
        p0 = (math.cos(angle) * 0.52, -1.55, center[2] + math.sin(angle) * 0.52)
        p1 = (math.cos(angle) * 3.18, -1.55, center[2] + math.sin(angle) * 3.18)
        moving_gate_part(bronze, mesh_cone_between(f"Gate aperture spoke {spoke_index}", p0, p1, 0.075, 0.045, bronze, 10, 0.01))
    moving_gate_part(light, mesh_ico("Gate suspended core", (0, -1.56, center[2]), (0.58, 0.24, 0.58), light, 3))

    # A rear tension ring and axial tie rods give the landmark real machine depth
    # instead of the profile of a decorated flat wheel.
    gate_part(iron, mesh_torus("Gate rear tension ring", (0, 0.72, center[2]), 7.74, 0.16, iron, rotation=(math.pi / 2, 0, 0), major_segments=96, minor_segments=10))
    for tie_index in range(12):
        angle = tie_index / 12 * TAU + math.pi / 12
        x = math.cos(angle) * 7.74
        z = center[2] + math.sin(angle) * 7.74
        gate_part(iron, mesh_cone_between(f"Gate axial tie {tie_index}", (x, -0.56, z), (x, 0.72, z), 0.065, 0.045, iron, 10, 0.008))

    # Load-bearing side towers, bridge bearings, and counterweights.
    for side, sign in (("L", -1), ("R", 1)):
        gate_part(wet_stone, mesh_cube(f"Gate {side} foundation", (sign * 7.15, 0.20, 1.00), (4.15, 3.2, 2.0), wet_stone, 0.16))
        gate_part(stone, mesh_cube(f"Gate {side} buttress", (sign * 7.0, 0.12, 4.05), (2.75, 2.45, 5.20), stone, 0.14, rotation=(0, sign * 0.05, sign * -0.08)))
        gate_part(stone, mesh_cube(f"Gate {side} tower cap", (sign * 7.0, 0.08, 6.82), (3.20, 2.85, 0.72), stone, 0.13))
        gate_part(bronze, mesh_torus(f"Gate {side} main bearing", (sign * 6.95, -1.34, 6.25), 0.86, 0.19, bronze, rotation=(math.pi / 2, 0, 0), major_segments=40, minor_segments=12))
        gate_part(iron, mesh_ico(f"Gate {side} bearing hub", (sign * 6.95, -1.50, 6.25), (0.50, 0.34, 0.50), iron, 2))
        facade_panel = custom_prism(
            f"Gate {side} tide register panel",
            [(-0.52, 0.82), (0.52, 0.82), (0.60, 0.42), (0.50, -0.78), (0, -0.94), (-0.50, -0.78), (-0.60, 0.42)],
            0.085,
            (sign * 7.0, -1.335, 3.72),
            iron,
            0.055,
        )
        gate_part(iron, facade_panel)
        gate_part(bronze, mesh_curve(f"Gate {side} tide register needle", [(sign * 7.0, -1.405, 3.15), (sign * (7.0 + 0.22), -1.415, 3.72), (sign * 7.0, -1.405, 4.35)], 0.045, bronze))
        for fastener_index, (dx, dz) in enumerate(((-0.43, 0.58), (0.43, 0.58), (-0.40, -0.58), (0.40, -0.58))):
            gate_part(bronze, mesh_ico(f"Gate {side} register fastener {fastener_index}", (sign * 7.0 + dx, -1.425, 3.72 + dz), (0.085, 0.045, 0.085), bronze, 1))

        cable = mesh_curve(
            f"Gate {side} counterweight cable",
            [(sign * 7.35, -0.95, 7.0), (sign * 8.1, -0.75, 5.0), (sign * 8.5, -0.55, 2.65)],
            0.065,
            iron,
        )
        gate_part(iron, cable)
        gate_part(bronze, mesh_cube(f"Gate {side} counterweight", (sign * 8.52, -0.55, 2.18), (1.05, 0.92, 1.55), bronze, 0.10, rotation=(0, sign * 0.07, sign * 0.06)))

        # Buttress drain is placed below the bearing to make wear causally legible.
        gate_part(iron, mesh_cone_between(f"Gate {side} drain", (sign * 6.65, -1.22, 4.70), (sign * 6.65, -2.15, 4.35), 0.22, 0.28, iron, 16, 0.025))
        runoff = mesh_curve(
            f"Gate {side} runoff trace",
            [(sign * 6.65, -1.28, 4.42), (sign * 6.70, -1.31, 3.35), (sign * 6.58, -1.33, 2.05)],
            0.045,
            wet_stone,
        )
        gate_part(wet_stone, runoff)

    # Broken right pier and foreground fragments break symmetry without visual noise.
    gate_part(wet_stone, mesh_cube("Gate collapsed right pier", (9.35, 0.35, 0.72), (3.5, 2.8, 1.4), wet_stone, 0.16, rotation=(0.08, 0.22, -0.18)))
    for index, (location, scale, angle) in enumerate(
        [
            ((10.8, -0.2, 0.36), (1.55, 1.0, 0.70), 0.31),
            ((-9.6, 0.5, 0.32), (1.2, 0.8, 0.62), -0.22),
            ((8.7, -1.5, 0.24), (0.9, 0.6, 0.45), 0.48),
        ]
    ):
        gate_part(wet_stone, mesh_cube(f"Gate foundation fragment {index}", location, scale, wet_stone, 0.10, rotation=(0.08, angle, angle * 0.45)))

    # Monumental steps funnel the approach into the aperture.
    for step in range(5):
        width = 9.3 - step * 0.52
        gate_part(wet_stone if step < 2 else stone, mesh_cube(f"Gate approach step {step}", (0, -2.15 - step * 0.46, 0.18 + step * 0.24), (width, 1.05, 0.36), wet_stone if step < 2 else stone, 0.07))
        gate_part(bronze, mesh_cube(f"Gate approach datum edge {step}", (0, -2.66 - step * 0.46, 0.37 + step * 0.24), (width * 0.86, 0.10, 0.075), bronze, 0.018))

    joined_meshes = []
    for material, objects in parts.items():
        joined = join_meshes(f"Gate - {material.name}", objects, material)
        if joined:
            prepare_export_mesh(joined)
            move_to_collection(joined, collection)
            joined.parent = root
            joined.matrix_parent_inverse = root.matrix_world.inverted()
            joined_meshes.append(joined)

    for material, objects in moving_parts.items():
        joined = join_meshes(f"Gate Mechanism - {material.name}", objects, material)
        if joined:
            prepare_export_mesh(joined)
            move_to_collection(joined, collection)
            joined.parent = mechanism
            joined.matrix_parent_inverse = mechanism.matrix_world.inverted()
            joined_meshes.append(joined)

    # Named gameplay anchors survive as empty nodes in glTF.
    for name, location in (
        ("marker_gate_center", (0, -1.9, center[2])),
        ("marker_gate_interact", (0, -4.0, 0.0)),
        ("marker_gate_left", (-3.1, -1.9, center[2])),
        ("marker_gate_right", (3.1, -1.9, center[2])),
    ):
        marker = bpy.data.objects.new(name, None)
        collection.objects.link(marker)
        marker.location = location
        marker.parent = root

    for name, location, scale in (
        ("collision_gate_left", (-7.0, 0.1, 4.0), (2.0, 1.7, 4.0)),
        ("collision_gate_right", (7.0, 0.1, 4.0), (2.0, 1.7, 4.0)),
        ("collision_gate_threshold", (0, -1.3, 0.8), (4.8, 1.0, 0.8)),
    ):
        metadata_empty(name, collection, root, location, scale, {"collision_shape": "box"})

    return {"root": root, "mechanism": mechanism, "animated_roots": [mechanism], "meshes": joined_meshes, "collection": collection}


def pose_frame(armature, frame, rotations=None, locations=None, scales=None):
    rotations = rotations or {}
    locations = locations or {}
    scales = scales or {}
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
        rotation = rotations.get(bone.name, (0.0, 0.0, 0.0))
        bone.rotation_euler = tuple(math.radians(value) for value in rotation)
        bone.location = locations.get(bone.name, (0.0, 0.0, 0.0))
        bone.scale = scales.get(bone.name, (1.0, 1.0, 1.0))
        bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="scale", frame=frame, group=bone.name)


def create_action(armature, name, duration, keyframes, loop=False):
    armature.animation_data_create()
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    action.use_cyclic = loop
    armature.animation_data.action = action
    for frame, rotations, locations in keyframes:
        pose_frame(armature, frame, rotations, locations)
    armature.animation_data.action = None
    track = armature.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.action_frame_start = 1
    strip.action_frame_end = duration
    strip.frame_start = 1
    strip.frame_end = duration
    track.mute = True
    return action


def create_object_action(obj, name, duration, keyframes, loop=False):
    """Author a transform clip on a static landmark root for runtime state sync."""
    obj.animation_data_create()
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    action.use_cyclic = loop
    obj.animation_data.action = action
    for frame, rotation, location, scale in keyframes:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = tuple(math.radians(value) for value in rotation)
        obj.location = location
        obj.scale = scale
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)
        obj.keyframe_insert(data_path="location", frame=frame)
        obj.keyframe_insert(data_path="scale", frame=frame)
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.action_frame_start = 1
    strip.action_frame_end = duration
    strip.frame_start = 1
    strip.frame_end = duration
    track.mute = True
    obj.location = (0, 0, 0)
    obj.rotation_euler = (0, 0, 0)
    obj.scale = (1, 1, 1)
    return action


def gate_animation_set(gate):
    rotor = gate["mechanism"]
    return [
        create_object_action(rotor, "gate_closed_idle", 91, [(1, (0, -1.6, 0), (0, 0, 0), (1, 1, 1)), (46, (0, 1.6, 0), (0, 0, 0), (1, 1, 1)), (91, (0, -1.6, 0), (0, 0, 0), (1, 1, 1))], True),
        create_object_action(rotor, "gate_unlock", 61, [(1, (0, 0, 0), (0, 0, 0), (1, 1, 1)), (12, (0, -14, 0), (0, 0, 0), (1.02, 1.02, 1.02)), (28, (0, 72, 0), (0, 0, 0), (0.82, 0.82, 0.82)), (45, (0, 142, 0), (0, 0, 0), (0.38, 0.38, 0.38)), (61, (0, 180, 0), (0, 0, 0), (0.08, 0.08, 0.08))]),
        create_object_action(rotor, "gate_open_idle", 97, [(1, (0, 178, 0), (0, 0, 0), (0.08, 0.08, 0.08)), (49, (0, 184, 0), (0, 0, 0), (0.09, 0.09, 0.09)), (97, (0, 178, 0), (0, 0, 0), (0.08, 0.08, 0.08))], True),
    ]


def hero_animation_set(hero):
    armature = hero["root"]
    actions = []

    idle_a = {
        "chest": (1.5, -1.3, 0),
        "head": (-1.2, 2.2, 0.8),
        "upper_arm.L": (1.5, 0, -2.0),
        "upper_arm.R": (-1.0, 0, 1.5),
        "mantle.L": (2.0, 0, -1.2),
        "mantle.R": (-1.0, 0, 1.0),
    }
    idle_b = {
        "chest": (-1.0, 1.5, 0.7),
        "head": (1.0, -2.4, -1.0),
        "forearm.L": (1.6, 0, 0.8),
        "mantle.L": (-1.5, 0.6, 1.4),
        "mantle.R": (1.6, -0.4, -1.2),
    }
    actions.append(create_action(armature, "hero_idle", 97, [(1, idle_a, {}), (49, idle_b, {"pelvis": (0, 0, 0.015)}), (97, idle_a, {})], True))

    walk_frames = []
    for frame, phase in ((1, 0), (8, math.pi / 2), (16, math.pi), (23, math.pi * 1.5), (31, TAU)):
        swing = math.sin(phase)
        lift = max(0.0, math.sin(phase))
        rotations = {
            "thigh.L": (swing * 25, 0, 0),
            "thigh.R": (-swing * 25, 0, 0),
            "shin.L": (max(0, -swing) * 32, 0, 0),
            "shin.R": (max(0, swing) * 32, 0, 0),
            "upper_arm.L": (-swing * 19, 0, 0),
            "upper_arm.R": (swing * 15, 0, 0),
            "forearm.L": (-8 + max(0, swing) * 12, 0, 0),
            "forearm.R": (-6 + max(0, -swing) * 10, 0, 0),
            "chest": (2.5, -swing * 2.5, 0),
            "mantle.L": (-4 - swing * 5, 0, swing * 2),
            "mantle.R": (-4 + swing * 5, 0, -swing * 2),
        }
        walk_frames.append((frame, rotations, {"pelvis": (0, 0, 0.018 * abs(math.sin(phase * 2)))}))
    actions.append(create_action(armature, "hero_walk", 31, walk_frames, True))

    run_frames = []
    for frame, phase in ((1, 0), (6, math.pi / 2), (11, math.pi), (16, math.pi * 1.5), (22, TAU)):
        swing = math.sin(phase)
        rotations = {
            "spine": (10, 0, 0),
            "chest": (7, -swing * 4, 0),
            "thigh.L": (swing * 38, 0, 0),
            "thigh.R": (-swing * 38, 0, 0),
            "shin.L": (10 + max(0, -swing) * 48, 0, 0),
            "shin.R": (10 + max(0, swing) * 48, 0, 0),
            "upper_arm.L": (-swing * 32, 0, 0),
            "upper_arm.R": (swing * 26, 0, 0),
            "forearm.L": (-24, 0, 0),
            "forearm.R": (-18, 0, 0),
            "mantle.L": (-14 - swing * 7, 0, swing * 3),
            "mantle.R": (-14 + swing * 7, 0, -swing * 3),
        }
        run_frames.append((frame, rotations, {"pelvis": (0, 0, 0.035 * abs(math.sin(phase * 2)))}))
    actions.append(create_action(armature, "hero_run", 22, run_frames, True))

    actions.append(
        create_action(
            armature,
            "hero_turn_l",
            16,
            [
                (1, {}, {}),
                (7, {"root": (0, 40, 0), "pelvis": (0, -15, 0), "head": (0, -12, 0)}, {}),
                (16, {"root": (0, 90, 0)}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "hero_turn_r",
            16,
            [
                (1, {}, {}),
                (7, {"root": (0, -40, 0), "pelvis": (0, 15, 0), "head": (0, 12, 0)}, {}),
                (16, {"root": (0, -90, 0)}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "hero_dodge",
            22,
            [
                (1, {}, {}),
                (5, {"spine": (18, 0, 0), "thigh.L": (-22, 0, 0), "thigh.R": (-18, 0, 0), "upper_arm.L": (-24, 0, -18), "upper_arm.R": (-20, 0, 20)}, {"pelvis": (0, 0, -0.18)}),
                (11, {"spine": (30, 0, 0), "chest": (22, 0, 0), "mantle.L": (-28, 0, -16), "mantle.R": (-25, 0, 14)}, {"root": (0, 0.12, 0.12), "pelvis": (0, 0, -0.05)}),
                (17, {"spine": (12, 0, 0), "thigh.L": (20, 0, 0), "thigh.R": (16, 0, 0)}, {"pelvis": (0, 0, -0.10)}),
                (22, {}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "hero_strike_light",
            25,
            [
                (1, {}, {}),
                (5, {"pelvis": (6, 18, 0), "spine": (10, 28, 0), "chest": (14, 48, 0), "thigh.L": (20, 0, 0), "shin.L": (6, 0, 0), "thigh.R": (-15, 0, 0), "shin.R": (20, 0, 0), "upper_arm.R": (-10, 4, -75), "forearm.R": (-25, 0, -10), "upper_arm.L": (-28, 0, -28), "head": (-2, -12, 0)}, {"pelvis": (0.03, 0.01, -0.08)}),
                (11, {"pelvis": (-5, -12, 0), "spine": (-8, -18, 0), "chest": (-12, -34, 0), "thigh.L": (-18, 0, 0), "shin.L": (20, 0, 0), "thigh.R": (9, 0, 0), "upper_arm.R": (-38, 8, -42), "forearm.R": (-54, 0, -18), "upper_arm.L": (18, 0, 22), "head": (2, 18, 0)}, {"pelvis": (0.09, -0.02, -0.10)}),
                (14, {"pelvis": (-5, -12, 0), "spine": (-8, -18, 0), "chest": (-12, -34, 0), "thigh.L": (-18, 0, 0), "shin.L": (20, 0, 0), "thigh.R": (9, 0, 0), "upper_arm.R": (-38, 8, -42), "forearm.R": (-54, 0, -18), "upper_arm.L": (18, 0, 22), "head": (2, 18, 0)}, {"pelvis": (0.10, -0.025, -0.12)}),
                (19, {"pelvis": (4, 24, 0), "spine": (10, 32, 0), "chest": (18, 54, 0), "thigh.L": (12, 0, 0), "thigh.R": (-8, 0, 0), "upper_arm.R": (25, 2, -55), "forearm.R": (-10, 0, -6), "mantle.L": (-14, 0, -18), "mantle.R": (-16, 0, 20)}, {"pelvis": (0.04, 0, -0.02)}),
                (25, {}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "hero_strike_heavy",
            37,
            [
                (1, {}, {}),
                (9, {"spine": (-16, 0, 0), "chest": (-22, 0, -16), "upper_arm.R": (-72, 0, -20), "forearm.R": (-58, 0, 0), "upper_arm.L": (-40, 0, 14)}, {"pelvis": (0, 0, -0.12)}),
                (17, {"spine": (-8, 0, 0), "upper_arm.R": (-105, 0, 0), "forearm.R": (-35, 0, 0), "head": (10, 0, 0)}, {"pelvis": (0, 0, -0.08)}),
                (23, {"spine": (34, 0, 0), "chest": (30, 16, 0), "upper_arm.R": (72, 0, 18), "forearm.R": (25, 0, 0), "mantle.L": (-28, 0, -10), "mantle.R": (-28, 0, 12)}, {"pelvis": (0, 0.08, -0.16)}),
                (29, {"spine": (18, 0, 0), "upper_arm.R": (38, 0, 8)}, {"pelvis": (0, 0, -0.08)}),
                (37, {}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "hero_gate_interact",
            61,
            [
                (1, {}, {}),
                (12, {"pelvis": (-5, 0, 0), "spine": (-8, 0, 0), "chest": (-10, 0, 0), "upper_arm.R": (-42, 0, -18), "forearm.R": (-48, 0, 0), "upper_arm.L": (-20, 0, 16), "forearm.L": (-34, 0, 0), "head": (8, 0, 0)}, {"pelvis": (0, -0.03, -0.08)}),
                (28, {"spine": (4, 0, 0), "chest": (8, 0, 0), "upper_arm.R": (-104, 0, -12), "forearm.R": (-34, 0, 0), "upper_arm.L": (-78, 0, 15), "forearm.L": (-50, 0, 0), "head": (-12, 0, 0)}, {"pelvis": (0, -0.10, 0.02)}),
                (42, {"spine": (8, 0, 0), "chest": (12, 0, 0), "upper_arm.R": (-92, 0, -8), "forearm.R": (-22, 0, 0), "upper_arm.L": (-66, 0, 10), "forearm.L": (-38, 0, 0), "head": (-7, 0, 0)}, {"pelvis": (0, -0.12, 0.04)}),
                (52, {"spine": (-5, 0, 0), "chest": (-7, 0, 0), "upper_arm.R": (-32, 0, -5), "upper_arm.L": (-26, 0, 6)}, {"pelvis": (0, -0.02, -0.04)}),
                (61, {}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "hero_hit",
            15,
            [
                (1, {}, {}),
                (4, {"spine": (-18, 14, 0), "head": (12, -16, 0), "upper_arm.L": (25, 0, -22), "upper_arm.R": (28, 0, 20)}, {"pelvis": (0, 0.08, -0.06)}),
                (9, {"spine": (-8, 0, 6), "head": (5, 0, -7)}, {"pelvis": (0, 0.03, -0.03)}),
                (15, {}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "hero_defeat",
            55,
            [
                (1, {}, {}),
                (15, {"spine": (-18, 0, 10), "head": (18, 0, -8), "upper_arm.L": (22, 0, -20), "upper_arm.R": (15, 0, 18)}, {"pelvis": (0, 0, -0.16)}),
                (33, {"root": (68, 0, 12), "spine": (34, 0, -8), "thigh.L": (-35, 0, 0), "thigh.R": (18, 0, 0), "mantle.L": (-36, 0, 10), "mantle.R": (-32, 0, -8)}, {"root": (0, 0.14, -0.30), "pelvis": (0, 0, -0.32)}),
                (55, {"root": (88, 0, 10), "spine": (42, 0, -6), "head": (20, 0, 0)}, {"root": (0, 0.20, -0.46), "pelvis": (0, 0, -0.38)}),
            ],
        )
    )
    return actions


def sentinel_animation_set(sentinel):
    armature = sentinel["root"]
    actions = []
    idle_a = {"torso": (1.5, -1.0, 0), "head": (-2.0, 2.0, 0), "upper_arm.L": (3, 0, -2), "upper_arm.R": (-2, 0, 2)}
    idle_b = {"torso": (-2.0, 1.2, 0), "head": (2.5, -3.0, 0), "forearm.R": (5, 0, 0), "upper_arm.L": (-2, 0, 1)}
    actions.append(create_action(armature, "sentinel_idle", 106, [(1, idle_a, {}), (53, idle_b, {"pelvis": (0, 0, 0.018)}), (106, idle_a, {})], True))

    patrol = []
    for frame, phase in ((1, 0), (10, math.pi / 2), (20, math.pi), (30, math.pi * 1.5), (40, TAU)):
        swing = math.sin(phase)
        patrol.append(
            (
                frame,
                {
                    "thigh.L": (swing * 19, 0, 0),
                    "thigh.R": (-swing * 19, 0, 0),
                    "shin.L": (max(0, -swing) * 24, 0, 0),
                    "shin.R": (max(0, swing) * 24, 0, 0),
                    "upper_arm.L": (-swing * 10, 0, 0),
                    "upper_arm.R": (swing * 15, 0, 0),
                    "torso": (4, -swing * 3, 0),
                },
                {"pelvis": (0, 0, 0.02 * abs(math.sin(phase * 2)))},
            )
        )
    actions.append(create_action(armature, "sentinel_patrol", 40, patrol, True))
    actions.append(
        create_action(
            armature,
            "sentinel_turn",
            25,
            [
                (1, {}, {}),
                (8, {"root": (0, 28, 0), "pelvis": (0, -11, 0), "torso": (0, -8, 0), "head": (0, -13, 0), "thigh.L": (-8, 0, 0), "thigh.R": (9, 0, 0)}, {"pelvis": (0, 0, -0.07)}),
                (17, {"root": (0, 67, 0), "pelvis": (0, -7, 0), "torso": (0, -4, 0), "head": (0, -7, 0), "thigh.L": (8, 0, 0), "thigh.R": (-7, 0, 0)}, {"pelvis": (0, 0, -0.03)}),
                (25, {"root": (0, 90, 0)}, {}),
            ],
        )
    )

    actions.append(
        create_action(
            armature,
            "sentinel_alert",
            31,
            [
                (1, {}, {}),
                (8, {"torso": (-10, 0, 0), "head": (12, 0, 0), "upper_arm.L": (-14, 0, -12), "upper_arm.R": (-12, 0, 10)}, {"pelvis": (0, 0, -0.08)}),
                (18, {"torso": (8, 0, 0), "head": (-8, 0, 0), "upper_arm.L": (20, 0, -18), "forearm.L": (-18, 0, 0)}, {"pelvis": (0, 0, 0.05)}),
                (31, {"upper_arm.L": (10, 0, -8), "upper_arm.R": (6, 0, 5)}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "sentinel_sweep",
            38,
            [
                (1, {}, {}),
                (8, {"torso": (-10, 30, 0), "upper_arm.L": (-20, 0, -70), "forearm.L": (-40, 0, -20), "head": (0, -18, 0)}, {"pelvis": (0, 0, -0.09)}),
                (17, {"torso": (16, -55, 0), "upper_arm.L": (45, 0, 75), "forearm.L": (28, 0, 25), "upper_arm.R": (-22, 0, -16)}, {}),
                (24, {"torso": (18, -62, 0), "upper_arm.L": (38, 0, 62), "forearm.L": (16, 0, 18)}, {}),
                (38, {}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "sentinel_slam",
            49,
            [
                (1, {}, {}),
                (12, {"pelvis": (-10, 0, 0), "torso": (-24, 0, 0), "thigh.L": (-12, 0, 0), "thigh.R": (-8, 0, 0), "upper_arm.L": (-96, 0, -14), "forearm.L": (-58, 0, 0), "hand.L": (0, 0, 42), "upper_arm.R": (-38, 0, 14), "head": (18, 0, 0)}, {"pelvis": (0, 0.03, -0.14)}),
                (23, {"upper_arm.L": (-126, 0, 0), "forearm.L": (-38, 0, 0), "hand.L": (0, 0, 28), "torso": (-30, 0, 0)}, {"pelvis": (0, 0, -0.06)}),
                (31, {"pelvis": (18, 0, 0), "torso": (28, 0, 8), "thigh.L": (-42, 0, -8), "thigh.R": (-38, 0, 7), "shin.L": (55, 0, 0), "shin.R": (50, 0, 0), "upper_arm.L": (0, 0, 0), "forearm.L": (0, 0, 0), "hand.L": (0, 0, 0), "upper_arm.R": (34, 0, 20), "head": (15, 0, -8)}, {"pelvis": (0, -0.16, -0.44)}),
                (34, {"pelvis": (18, 0, 0), "torso": (30, 0, 9), "thigh.L": (-42, 0, -8), "thigh.R": (-38, 0, 7), "shin.L": (55, 0, 0), "shin.R": (50, 0, 0), "upper_arm.L": (0, 0, 0), "forearm.L": (0, 0, 0), "hand.L": (0, 0, 0), "upper_arm.R": (34, 0, 20), "head": (15, 0, -8)}, {"pelvis": (0, -0.17, -0.46)}),
                (42, {"pelvis": (7, 0, 0), "torso": (8, 0, 0), "thigh.L": (-12, 0, 0), "thigh.R": (-10, 0, 0), "shin.L": (16, 0, 0), "shin.R": (14, 0, 0), "upper_arm.L": (10, 0, -8)}, {"pelvis": (0, 0.03, -0.14)}),
                (49, {}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "sentinel_hit",
            16,
            [
                (1, {}, {}),
                (4, {"torso": (-22, -18, 0), "head": (20, 14, 0), "upper_arm.L": (28, 0, -18), "upper_arm.R": (25, 0, 18)}, {"pelvis": (0, 0.08, -0.05)}),
                (10, {"torso": (-7, 0, -5), "head": (7, 0, 4)}, {"pelvis": (0, 0.02, -0.02)}),
                (16, {}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "sentinel_stagger",
            28,
            [
                (1, {}, {}),
                (7, {"torso": (-30, -26, 0), "head": (24, 18, 0), "upper_arm.L": (38, 0, -24), "upper_arm.R": (32, 0, 24)}, {"pelvis": (0, 0.12, -0.14)}),
                (17, {"torso": (-15, -10, 0), "thigh.L": (-12, 0, 0), "thigh.R": (14, 0, 0)}, {"pelvis": (0, 0.05, -0.08)}),
                (28, {}, {}),
            ],
        )
    )
    actions.append(
        create_action(
            armature,
            "sentinel_collapse",
            67,
            [
                (1, {}, {}),
                (16, {"torso": (-22, 0, 16), "head": (30, 0, -18), "upper_arm.L": (25, 0, -28), "upper_arm.R": (28, 0, 26)}, {"pelvis": (0, 0, -0.20)}),
                (36, {"root": (54, 0, -12), "torso": (30, 0, 18), "thigh.L": (-38, 0, 0), "thigh.R": (22, 0, 0), "upper_arm.L": (62, 0, -14)}, {"root": (0, 0.18, -0.40), "pelvis": (0, 0, -0.35)}),
                (54, {"root": (82, 0, -18), "torso": (46, 0, 12), "head": (22, 0, 0), "upper_arm.L": (76, 0, -10), "upper_arm.R": (48, 0, 18)}, {"root": (0, 0.28, -0.58), "pelvis": (0, 0, -0.45)}),
                (67, {"root": (88, 0, -18), "torso": (48, 0, 10)}, {"root": (0, 0.30, -0.61), "pelvis": (0, 0, -0.47)}),
            ],
        )
    )
    return actions


ANIMATION_MANIFEST = {
    "hero": {
        "hero_idle": {"loop": True},
        "hero_walk": {"loop": True, "speed": 2.2},
        "hero_run": {"loop": True, "speed": 4.8},
        "hero_turn_l": {"loop": False},
        "hero_turn_r": {"loop": False},
        "hero_dodge": {"loop": False, "invulnerable": [0.17, 0.53]},
        "hero_strike_light": {"loop": False, "hit": 0.46, "trail": [0.32, 0.62]},
        "hero_strike_heavy": {"loop": False, "hit": 0.62, "trail": [0.46, 0.72]},
        "hero_gate_interact": {"loop": False, "contact": 0.46},
        "hero_hit": {"loop": False},
        "hero_defeat": {"loop": False},
    },
    "sentinel": {
        "sentinel_idle": {"loop": True},
        "sentinel_patrol": {"loop": True, "speed": 1.35},
        "sentinel_turn": {"loop": False},
        "sentinel_alert": {"loop": False},
        "sentinel_sweep": {"loop": False, "telegraph": [0.08, 0.42], "hit": 0.55},
        "sentinel_slam": {"loop": False, "telegraph": [0.10, 0.57], "hit": 0.64},
        "sentinel_hit": {"loop": False},
        "sentinel_stagger": {"loop": False},
        "sentinel_collapse": {"loop": False},
    },
}


def asset_objects(asset):
    return list(asset["collection"].all_objects)


def authored_scale(asset):
    value = float(asset["root"].get("author_scale", 1.0))
    return (value, value, value)


def set_asset_selected(asset):
    bpy.ops.object.select_all(action="DESELECT")
    objects = asset_objects(asset)
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = asset["root"]
    return objects


def set_tracks_muted(armature, muted):
    if armature.animation_data:
        armature.animation_data.action = None
        for track in armature.animation_data.nla_tracks:
            track.mute = muted


def export_character(asset, filepath):
    root = asset["root"]
    original_location = root.location.copy()
    original_rotation = root.rotation_euler.copy()
    root.location = (0, 0, 0)
    root.rotation_euler = (0, 0, 0)
    forward_marker = next((obj for obj in asset_objects(asset) if obj.get("marker_role") == "forward"), None)
    marker_original_name = forward_marker.name if forward_marker else None
    marker_conflict = bpy.data.objects.get("marker_forward")
    if forward_marker and marker_conflict and marker_conflict != forward_marker:
        marker_conflict.name = "__marker_forward_export_stash"
        forward_marker.name = "marker_forward"
    # A skinned mesh may use an Armature modifier without being parented to the
    # armature object. Exporting it as a sibling avoids NODE_SKINNED_MESH_NON_ROOT
    # warnings and removes ambiguous double transforms in Three.js.
    mesh_states = []
    for mesh in asset["meshes"]:
        world = mesh.matrix_world.copy()
        mesh_states.append((mesh, mesh.parent, mesh.matrix_parent_inverse.copy(), world))
        mesh.parent = None
        mesh.matrix_world = world
    try:
        set_tracks_muted(root, False)
        set_asset_selected(asset)
        bpy.ops.export_scene.gltf(
            filepath=str(filepath),
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_animations=True,
            export_animation_mode="ACTIONS",
            export_anim_single_armature=False,
            export_nla_strips=True,
            export_frame_range=False,
            export_frame_step=1,
            export_force_sampling=True,
            export_anim_slide_to_zero=True,
            export_optimize_animation_size=True,
            export_optimize_animation_keep_anim_armature=True,
            export_skins=True,
            export_def_bones=False,
            export_leaf_bone=False,
            export_influence_nb=4,
            export_all_influences=False,
            export_apply=False,
            export_texcoords=True,
            export_normals=True,
            export_tangents=True,
            export_materials="EXPORT",
            export_extras=True,
        )
    finally:
        set_tracks_muted(root, True)
        for mesh, parent, parent_inverse, world in mesh_states:
            mesh.parent = parent
            mesh.matrix_parent_inverse = parent_inverse
            mesh.matrix_world = world
        root.location = original_location
        root.rotation_euler = original_rotation
        if forward_marker and marker_original_name:
            forward_marker.name = marker_original_name
        if marker_conflict and marker_conflict != forward_marker:
            marker_conflict.name = "marker_forward"


def export_static(asset, filepath):
    root = asset["root"]
    original_location = root.location.copy()
    original_rotation = root.rotation_euler.copy()
    root.location = (0, 0, 0)
    root.rotation_euler = (0, 0, 0)
    try:
        for animated in asset.get("animated_roots", [root]):
            set_tracks_muted(animated, False)
        set_asset_selected(asset)
        bpy.ops.export_scene.gltf(
            filepath=str(filepath),
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_animations=True,
            export_animation_mode="ACTIONS",
            export_nla_strips=True,
            export_frame_range=False,
            export_force_sampling=True,
            export_anim_slide_to_zero=True,
            export_optimize_animation_size=True,
            export_apply=False,
            export_texcoords=True,
            export_normals=True,
            export_tangents=True,
            export_materials="EXPORT",
            export_extras=True,
        )
    finally:
        for animated in asset.get("animated_roots", [root]):
            set_tracks_muted(animated, True)
            animated.location = (0, 0, 0)
            animated.rotation_euler = (0, 0, 0)
            animated.scale = (1, 1, 1)
        root.location = original_location
        root.rotation_euler = original_rotation


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def create_simple_material(name, base, metallic=0.0, roughness=0.5, emission=None):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = True
    material.diffuse_color = (*base, 1.0)
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*base, 1.0)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    if emission:
        principled.inputs["Emission Color"].default_value = (*emission[0], 1.0)
        principled.inputs["Emission Strength"].default_value = emission[1]
    return material


def create_volume_material(name, color, density, anisotropy=0.35):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Color"].default_value = (*color, 1.0)
    volume.inputs["Density"].default_value = density
    volume.inputs["Anisotropy"].default_value = anisotropy
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return material


def add_light(name, light_type, location, color, energy, size=5.0, collection=None):
    data = bpy.data.lights.new(name, light_type)
    data.color = color
    data.energy = energy
    if light_type == "AREA":
        data.shape = "DISK"
        data.size = size
    obj = bpy.data.objects.new(name, data)
    (collection or bpy.context.scene.collection).objects.link(obj)
    obj.location = location
    return obj


def configure_world(color=(0.012, 0.035, 0.045), strength=0.22):
    world = bpy.data.worlds.get("Drowned Orrery World") or bpy.data.worlds.new("Drowned Orrery World")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (*color, 1.0)
    background.inputs["Strength"].default_value = strength
    return world


def configure_compositor(grayscale=False, glow=True):
    scene = bpy.context.scene
    # Blender 5.2's compositor API is intentionally bypassed here. Preview
    # evidence must stay deterministic in background mode; grayscale is
    # produced from the rendered pixel buffer in ``render_file`` instead.
    scene.compositing_node_group = None


def setup_render_scene(materials, hero, sentinel, gate):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    try:
        scene.render.image_settings.color_depth = "8"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.70
    scene.render.resolution_percentage = 100
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.use_file_extension = True
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.resolution_percentage = 100

    configure_world()
    configure_compositor(False, True)

    stage = create_collection("STAGE_GoldSlice_Preview")
    wet = materials["wet_stone"]
    stone = materials["stone"]
    bronze = materials["bronze"]
    reed = materials["reed"]
    water_material = create_simple_material("Blackwater Surface", (0.012, 0.055, 0.065), metallic=0.20, roughness=0.16)

    stage_objects = []
    water = mesh_cube("Preview drowned basin", (0, 11, -0.58), (52, 58, 0.45), water_material, 0.04)
    move_to_collection(water, stage)
    stage_objects.append(water)
    causeway = mesh_cube("Preview authored causeway", (0, 7.0, -0.02), (6.4, 35.5, 0.62), wet, 0.14)
    move_to_collection(causeway, stage)
    stage_objects.append(causeway)
    # A warm mineral center strip becomes a visual arrow to the aperture.
    center_strip = mesh_cube("Preview causeway meridian", (0, 7.0, 0.30), (0.38, 34.5, 0.055), bronze, 0.018)
    move_to_collection(center_strip, stage)
    stage_objects.append(center_strip)

    for side, sign in (("L", -1), ("R", 1)):
        rail_points = [(sign * 3.1, -8.0, 0.35), (sign * 3.05, 3.0, 0.52), (sign * 2.85, 13.5, 0.70)]
        rail = mesh_curve(f"Preview {side} causeway rail", rail_points, 0.095, bronze)
        move_to_collection(rail, stage)
        stage_objects.append(rail)
        for index, y in enumerate((-6, -1, 4, 9, 14)):
            post = mesh_cube(f"Preview {side} rail post {index}", (sign * (3.08 - index * 0.03), y, 0.62), (0.24, 0.24, 1.3), stone, 0.045)
            move_to_collection(post, stage)
            stage_objects.append(post)
        ruin = mesh_cube(f"Preview {side} drowned pier", (sign * 9.5, 9.0 + sign * 1.8, 1.1), (4.2, 4.0, 2.7), wet, 0.18, rotation=(0.05, sign * 0.08, sign * 0.06))
        move_to_collection(ruin, stage)
        stage_objects.append(ruin)
        for reed_index in range(7):
            x = sign * (5.2 + reed_index * 0.55)
            y = 2.0 + (reed_index % 3) * 3.2 + sign * 0.4
            stalk = mesh_curve(f"Preview {side} reed {reed_index}", [(x, y, -0.25), (x + sign * 0.12, y, 0.55), (x + sign * 0.18, y + 0.08, 1.15 + (reed_index % 2) * 0.3)], 0.035, reed)
            move_to_collection(stalk, stage)
            stage_objects.append(stalk)

    # Low foreground anchors create depth without occluding gameplay actors.
    for index, (x, y, scale, angle) in enumerate(
        [(-5.4, -4.0, (2.2, 1.7, 0.7), -0.24), (5.7, -2.2, (2.5, 1.9, 0.8), 0.31), (-8.2, 3.8, (3.5, 2.5, 1.2), -0.12)]
    ):
        block = mesh_cube(f"Preview tide fragment {index}", (x, y, scale[2] * 0.34 - 0.42), scale, wet, 0.16, rotation=(0.04, angle, angle * 0.3))
        move_to_collection(block, stage)
        stage_objects.append(block)

    # Distant structural bands establish a real background layer and hint at a
    # submerged complex beyond the immediate runway.
    for side, sign in (("L", -1), ("R", 1)):
        distant_pier = mesh_cube(
            f"Preview distant {side} pressure pier",
            (sign * 13.5, 23.0, 4.0),
            (4.6, 5.2, 9.0),
            stone,
            0.22,
            rotation=(0.03, sign * 0.05, sign * 0.035),
        )
        move_to_collection(distant_pier, stage)
        stage_objects.append(distant_pier)
        hanging = mesh_curve(
            f"Preview distant {side} hanging conduit",
            [(sign * 12.8, 20.0, 8.2), (sign * 11.4, 20.5, 6.4), (sign * 10.6, 19.5, 3.2)],
            0.12,
            bronze,
        )
        move_to_collection(hanging, stage)
        stage_objects.append(hanging)
    background_arc = mesh_curve(
        "Preview background pressure arch",
        [(-15.5, 31.0, 4.5), (-11.0, 32.0, 12.5), (0, 33.0, 16.5), (11.0, 32.0, 12.5), (15.5, 31.0, 4.5)],
        0.46,
        wet,
    )
    move_to_collection(background_arc, stage)
    stage_objects.append(background_arc)

    haze_material = create_volume_material("Drowned distance haze", (0.035, 0.12, 0.15), 0.006, 0.42)
    haze = mesh_cube("Preview volumetric water haze", (0, 15, 7.5), (46, 60, 16), haze_material, 0.0)
    move_to_collection(haze, stage)
    stage_objects.append(haze)

    camera_data = bpy.data.cameras.new("Gold Slice Camera")
    camera = bpy.data.objects.new("Gold Slice Camera", camera_data)
    stage.objects.link(camera)
    scene.camera = camera
    camera.data.lens = 47.0
    camera.data.sensor_width = 36.0
    camera.location = (0.4, -13.0, 4.55)
    look_at(camera, (0, 10.0, 4.0))

    target = bpy.data.objects.new("Gold Slice Camera Focus", None)
    stage.objects.link(target)
    target.location = (0, 7.0, 4.0)
    camera.data.dof.use_dof = True
    camera.data.dof.focus_object = target
    camera.data.dof.aperture_fstop = 8.0

    sun = add_light("Cold drowned sun", "SUN", (-7, -8, 15), (0.42, 0.67, 0.82), 4.0, collection=stage)
    sun.rotation_euler = (math.radians(28), math.radians(-22), math.radians(-34))
    key = add_light("Surveyor rim key", "AREA", (-7, -5, 8), (0.38, 0.70, 0.92), 2800, 7.0, stage)
    look_at(key, (-1.5, 0, 1.3))
    fill = add_light("Warm gate fill", "AREA", (5, 10, 10), (1.0, 0.43, 0.18), 2400, 8.0, stage)
    look_at(fill, (0, 8, 3))
    front_fill = add_light("Camera-side aqueous fill", "AREA", (0, -7, 10), (0.52, 0.72, 0.82), 2600, 11.0, stage)
    look_at(front_fill, (0, 8, 4))
    aperture_light = add_light("Aperture spill", "POINT", (0, 16.0, 8.8), (0.08, 0.55, 0.92), 1900, collection=stage)
    aperture_light.data.shadow_soft_size = 2.2
    threat_light = add_light("Sentinel core spill", "POINT", (2.8, 4.5, 2.1), (1.0, 0.12, 0.025), 180, collection=stage)
    threat_light.data.shadow_soft_size = 0.45

    return {"collection": stage, "objects": stage_objects, "camera": camera, "lights": [sun, key, fill, front_fill, aperture_light, threat_light], "target": target}


def apply_idle_pose(asset, action_name, frame=12):
    root = asset["root"]
    set_tracks_muted(root, True)
    root.animation_data.action = bpy.data.actions.get(action_name)
    bpy.context.scene.frame_set(frame)


def render_file(filepath, width, height, grayscale=False):
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    configure_compositor(grayscale, True)
    scene.render.filepath = str(filepath)
    bpy.ops.render.render(write_still=True)
    if grayscale:
        source = bpy.data.images.load(str(filepath), check_existing=False)
        pixels = np.empty(len(source.pixels), dtype=np.float32)
        source.pixels.foreach_get(pixels)
        rgba = pixels.reshape((-1, 4))
        luminance = rgba[:, 0] * 0.2126 + rgba[:, 1] * 0.7152 + rgba[:, 2] * 0.0722
        rgba[:, 0] = luminance
        rgba[:, 1] = luminance
        rgba[:, 2] = luminance
        grayscale_image = bpy.data.images.new("Gold Slice Grayscale", width=source.size[0], height=source.size[1], alpha=True)
        grayscale_image.pixels.foreach_set(rgba.reshape(-1))
        grayscale_image.update()
        grayscale_image.filepath_raw = str(filepath)
        grayscale_image.file_format = "PNG"
        grayscale_image.save()
        bpy.data.images.remove(source)
        bpy.data.images.remove(grayscale_image)


def set_collection_render(collection, visible):
    collection.hide_render = not visible


def render_acceptance_set(stage, hero, sentinel, gate):
    scene = bpy.context.scene
    # Production composition.
    set_collection_render(stage["collection"], True)
    set_collection_render(hero["collection"], True)
    set_collection_render(sentinel["collection"], True)
    set_collection_render(gate["collection"], True)
    hero["root"].location = (-2.0, -0.6, 0.30)
    hero["root"].rotation_euler = (0, 0, math.pi)
    sentinel["root"].location = (2.35, 4.6, 0.30)
    sentinel["root"].rotation_euler = (0, 0, 0)
    sentinel["root"].scale = authored_scale(sentinel)
    gate["root"].location = (0, 29.0, 0.0)
    gate["root"].rotation_euler = (0, 0, 0)
    gate["root"].scale = (0.60, 0.60, 0.60)
    gate["mechanism"].rotation_euler = (0, 0, 0)
    apply_idle_pose(hero, "hero_idle", 18)
    apply_idle_pose(sentinel, "sentinel_idle", 22)
    scene.frame_set(18)
    stage["camera"].location = (0.4, -13.0, 4.55)
    stage["camera"].data.lens = 52.0
    look_at(stage["camera"], (0, 10.0, 3.45))
    configure_world((0.018, 0.055, 0.068), 0.48)
    render_file(QA_ROOT / "gold_slice_keyframe_1280x720.png", 1280, 720, False)
    render_file(QA_ROOT / "gold_slice_keyframe_1920x1080.png", 1920, 1080, False)
    render_file(QA_ROOT / "gold_slice_keyframe_grayscale.png", 1280, 720, True)
    render_file(QA_ROOT / "gold_slice_thumbnail.png", 320, 180, False)

    # Neutral and production turntable evidence. Environment stays hidden.
    set_collection_render(stage["collection"], True)
    for obj in stage["objects"]:
        obj.hide_render = True
    for light in stage["lights"]:
        light.hide_render = True
    qa_floor_material = create_simple_material("Neutral QA Floor", (0.16, 0.17, 0.18), metallic=0.0, roughness=0.74)
    qa_floor = mesh_cube("Neutral QA Floor", (0, 0, -0.10), (18, 18, 0.18), qa_floor_material, 0.02)
    move_to_collection(qa_floor, stage["collection"])
    neutral_key = add_light("Neutral turntable key", "AREA", (4, -5, 7), (1.0, 0.98, 0.95), 2600, 5.0, stage["collection"])
    neutral_fill = add_light("Neutral turntable fill", "AREA", (-4, -2, 4), (0.62, 0.72, 0.82), 1700, 4.0, stage["collection"])
    look_at(neutral_key, (0, 0, 1.3))
    look_at(neutral_fill, (0, 0, 1.2))
    configure_world((0.20, 0.20, 0.20), 0.68)

    def turntable(asset, others, name, camera_location, target, angles, width=640, height=640):
        for other in others:
            set_collection_render(other["collection"], False)
        set_collection_render(asset["collection"], True)
        asset["root"].location = (0, 0, 0)
        asset["root"].scale = authored_scale(asset)
        stage["camera"].location = camera_location
        stage["camera"].data.lens = 58.0
        look_at(stage["camera"], target)
        for angle in angles:
            asset["root"].rotation_euler = (0, 0, math.radians(angle))
            render_file(QA_ROOT / f"{name}_turn_{angle:03d}.png", width, height, False)

    turntable(hero, [sentinel, gate], "hero", (4.2, -6.4, 3.15), (0, 0, 1.25), (0, 90, 180, 270))
    turntable(sentinel, [hero, gate], "sentinel", (4.8, -7.0, 3.45), (0, 0, 1.38), (0, 90, 180, 270))
    turntable(gate, [hero, sentinel], "gate", (19.0, -31.0, 14.0), (0, 0, 7.6), (0, 45, 315), 960, 720)

    def action_contact_sheet(asset, others, action_name, frames, prefix, camera_location, target):
        for other in others:
            set_collection_render(other["collection"], False)
        set_collection_render(asset["collection"], True)
        asset["root"].location = (0, 0, 0)
        asset["root"].rotation_euler = (0, 0, 0)
        asset["root"].scale = authored_scale(asset)
        set_tracks_muted(asset["root"], True)
        asset["root"].animation_data.action = bpy.data.actions[action_name]
        stage["camera"].location = camera_location
        stage["camera"].data.lens = 52.0
        look_at(stage["camera"], target)
        for index, frame in enumerate(frames):
            scene.frame_set(frame)
            render_file(QA_ROOT / f"{prefix}_{index + 1:02d}_f{frame:03d}.png", 640, 640, False)

    action_contact_sheet(hero, [sentinel, gate], "hero_strike_light", (5, 11, 19), "hero_strike", (-4.8, -7.2, 3.1), (0, 0, 1.25))
    action_contact_sheet(sentinel, [hero, gate], "sentinel_slam", (12, 31, 42), "sentinel_slam", (-7.0, -10.5, 4.35), (0, 0, 1.78))

    # Restore the production stage before saving the .blend.
    neutral_key.hide_render = True
    neutral_fill.hide_render = True
    qa_floor.hide_render = True
    for obj in stage["objects"]:
        obj.hide_render = False
    for light in stage["lights"]:
        light.hide_render = False
    set_collection_render(hero["collection"], True)
    set_collection_render(sentinel["collection"], True)
    set_collection_render(gate["collection"], True)
    hero["root"].location = (-2.0, -0.6, 0.30)
    hero["root"].rotation_euler = (0, 0, math.pi)
    sentinel["root"].location = (2.35, 4.6, 0.30)
    sentinel["root"].rotation_euler = (0, 0, 0)
    sentinel["root"].scale = authored_scale(sentinel)
    gate["root"].location = (0, 29.0, 0.0)
    gate["root"].rotation_euler = (0, 0, 0)
    gate["root"].scale = (0.60, 0.60, 0.60)
    stage["camera"].location = (0.4, -13.0, 4.55)
    stage["camera"].data.lens = 52.0
    look_at(stage["camera"], (0, 10.0, 3.45))
    configure_world((0.018, 0.055, 0.068), 0.48)
    apply_idle_pose(hero, "hero_idle", 18)
    apply_idle_pose(sentinel, "sentinel_idle", 22)
    scene.frame_set(18)
    configure_compositor(False, True)
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720


def validate_scene(hero, sentinel, gate):
    diagnostics = {}
    for name, asset in (("hero", hero), ("sentinel", sentinel), ("gate", gate)):
        triangles = 0
        vertices = 0
        materials = set()
        for obj in asset["meshes"]:
            if obj.type != "MESH":
                continue
            vertices += len(obj.data.vertices)
            triangles += sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons)
            materials.update(slot.material.name for slot in obj.material_slots if slot.material)
        diagnostics[name] = {
            "triangles": triangles,
            "vertices": vertices,
            "materials": sorted(materials),
            "mesh_primitives": len(asset["meshes"]),
        }
    hero_actions = sorted(action.name for action in bpy.data.actions if action.name.startswith("hero_"))
    sentinel_actions = sorted(action.name for action in bpy.data.actions if action.name.startswith("sentinel_"))
    gate_actions = sorted(action.name for action in bpy.data.actions if action.name.startswith("gate_"))
    diagnostics["animations"] = {"hero": hero_actions, "sentinel": sentinel_actions, "gate": gate_actions}
    expected_hero = set(ANIMATION_MANIFEST["hero"])
    expected_sentinel = set(ANIMATION_MANIFEST["sentinel"])
    if set(hero_actions) != expected_hero:
        raise RuntimeError(f"Hero animation mismatch: {set(hero_actions) ^ expected_hero}")
    if set(sentinel_actions) != expected_sentinel:
        raise RuntimeError(f"Sentinel animation mismatch: {set(sentinel_actions) ^ expected_sentinel}")
    if set(gate_actions) != {"gate_closed_idle", "gate_unlock", "gate_open_idle"}:
        raise RuntimeError(f"Gate animation mismatch: {set(gate_actions)}")
    if diagnostics["hero"]["mesh_primitives"] > 7 or diagnostics["sentinel"]["mesh_primitives"] > 6:
        raise RuntimeError("Character draw-call budget exceeded")
    # The gate deliberately keeps the travelling iron shutter on its own PBR
    # primitive so it can clear the aperture without recoloring the bronze
    # meridians. Seven primitives remains an exceptionally small landmark cost.
    if diagnostics["gate"]["mesh_primitives"] > 7:
        raise RuntimeError("Gate draw-call budget exceeded")
    return diagnostics


def write_manifest(diagnostics):
    manifest = {
        "schema": 1,
        "title": "Drowned Orrery Gold Slice",
        "authoring": "100% original Blender-authored assets generated by scripts/blender/build_drowned_gold_slice.py",
        "coordinateSystem": {"blenderForward": "-Y", "blenderUp": "+Z", "gltfUp": "+Y"},
        "assets": {
            "hero": {"file": "hero.glb", "scaleMeters": 2.70, "runtimeYawRadians": round(math.pi, 8), "clips": ANIMATION_MANIFEST["hero"]},
            "sentinel": {"file": "sentinel.glb", "scaleMeters": 3.22, "runtimeYawRadians": round(math.pi, 8), "clips": ANIMATION_MANIFEST["sentinel"]},
            "gate": {"file": "orrery_gate.glb", "heightMeters": 18.0, "clips": {"gate_closed_idle": {"loop": True}, "gate_unlock": {"loop": False}, "gate_open_idle": {"loop": True}}},
        },
        "diagnostics": diagnostics,
    }
    (ASSET_ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main():
    reset_scene()
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    materials = create_material_library()
    hero = create_hero(materials)
    hero_animation_set(hero)
    sentinel = create_sentinel(materials)
    sentinel_animation_set(sentinel)
    gate = create_gate(materials)
    gate_animation_set(gate)

    diagnostics = validate_scene(hero, sentinel, gate)
    export_character(hero, ASSET_ROOT / "hero.glb")
    export_character(sentinel, ASSET_ROOT / "sentinel.glb")
    export_static(gate, ASSET_ROOT / "orrery_gate.glb")
    write_manifest(diagnostics)

    stage = setup_render_scene(materials, hero, sentinel, gate)
    render_acceptance_set(stage, hero, sentinel, gate)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)
    print("GOLD_SLICE_DIAGNOSTICS", json.dumps(diagnostics, sort_keys=True))
    print("GOLD_SLICE_BLEND", BLEND_PATH)
    print("GOLD_SLICE_DONE")


if __name__ == "__main__":
    main()
