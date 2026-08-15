#!/usr/bin/env python3
"""Build the Choir Spires Precentor from its Meshy remesh.

Meshy supplies the detailed mantis anatomy and four-map PBR atlas. Blender
fits that source to the proven Thresher gameplay envelope, art-directs it into
Saintfall's Bloom palette, and gives it a dedicated four-walking-leg rig.

Usage:
  blender --background --factory-startup \
    --python scripts/blender/saintfall-precentor-meshy.py -- \
    --input assets/models/saintfall/source/precentor-meshy-v1/precentor-meshy-v1-remeshed.glb \
    --output assets/models/saintfall/source/precentor.raw.glb \
    --report output/saintfall/models/precentor.json \
    --save-blend assets/models/saintfall/source/precentor-meshy-v1.blend
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


kit = load_module("saintfall_kit", ROOT / "saintfall-kit.py")
legacy = load_module("saintfall_thresher_legacy", ROOT / "saintfall-thresher.py")

# Exact source-space envelope of the former Thresher asset. Runtime keeps the
# existing Precentor scale of 1.55, producing roughly 4.01 W x 3.03 H x 5.08 L.
TARGET_X = (-1.295, 1.295)
TARGET_Y = (0.0, 1.956)
TARGET_Z = (-1.77193, 1.50607)
EXPECTED_CLIPS = ("idle", "alert", "strike", "flinch", "death")
WALKING_PAIRS = 2
TARSUS_COMPACT_SCALE = 0.62
LEG_RIG = (
    # The runtime measures its two-bone reach from these virtual landmarks.
    # Keep the proven knee envelope that plants every tarsus through a full
    # pivot; shell ownership below uses the visible Meshy seams independently.
    {"hip": (0.26, 0.98, 0.12), "knee": (0.83, 1.04, 0.50),
     "foot": (1.258, -0.069, 0.598)},
    {"hip": (0.29, 0.92, -0.42), "knee": (0.84, 1.14, -0.90),
     "foot": (0.941, -0.068, -1.666)},
)

# Geometry classification follows the actual armour segment seams. Keeping
# these separate from the virtual IK landmarks prevents adjacent shell plates
# from being assigned across a visible joint while preserving sufficient reach.
LEG_WEIGHT_RIG = (
    {"hip": (0.26, 0.98, 0.12), "knee": (0.72, 0.88, 0.42),
     "foot": (1.258, -0.069, 0.598)},
    {"hip": (0.29, 0.92, -0.42), "knee": (0.70, 0.86, -0.85),
     "foot": (0.941, -0.068, -1.666)},
)

# The Meshy silhouette is longer and more layered than the procedural
# Thresher that supplied the clip vocabulary. These deterministic per-action
# gains preserve every authored beat and duration while retargeting its range
# to this model, keeping face, crest and scythe plates continuous in motion.
ACTION_GAINS = {
    "idle": {
        "thorax": 0.75, "pronotum": 0.65, "head": 0.55,
        "scythe": 0.45, "claw": 0.45,
    },
    "alert": {
        "thorax": 0.48, "pronotum": 0.34, "head": 0.30,
        "abdomen": 0.52, "scythe": 0.22, "claw": 0.22,
        "mandible": 0.50, "antenna": 0.72,
    },
    "strike": {
        "thorax": 0.58, "pronotum": 0.42, "head": 0.40,
        "abdomen": 0.52, "scythe": 0.40, "claw": 0.40,
        "mandible": 0.58, "antenna": 0.65,
    },
    "flinch": {
        "thorax": 0.54, "pronotum": 0.42, "head": 0.40,
        "abdomen": 0.52, "scythe": 0.34, "claw": 0.34,
        "antenna": 0.70,
    },
    "death": {
        "thorax": 0.62, "pronotum": 0.52, "head": 0.50,
        "abdomen": 0.68, "scythe": 0.34, "claw": 0.34,
        "mandible": 0.65, "antenna": 0.72,
        "coxa": 0.62, "femur": 0.62, "tibia": 0.62, "foot": 0.62,
    },
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--save-blend", type=Path)
    parser.add_argument("--texture-size", type=int, default=1024)
    return parser.parse_args(argv)


def repo_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(REPO))
    except ValueError:
        return str(resolved)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return low, high


def flatten_imported_mesh(obj: bpy.types.Object) -> None:
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)


def reshape_to_gameplay_envelope(obj: bpy.types.Object) -> None:
    """Fit Meshy's normalized Z-up pose to the old Thresher bounds exactly."""
    low, high = world_bounds(obj)
    span = high - low
    # Blender -Y exports as Saintfall +Z. Source front is already Blender -Y.
    blender_y = (-TARGET_Z[1], -TARGET_Z[0])
    for vertex in obj.data.vertices:
        point = vertex.co
        nx = (point.x - low.x) / max(span.x, 1e-8)
        ny = (point.y - low.y) / max(span.y, 1e-8)
        nz = (point.z - low.z) / max(span.z, 1e-8)
        point.x = TARGET_X[0] + nx * (TARGET_X[1] - TARGET_X[0])
        point.y = blender_y[0] + ny * (blender_y[1] - blender_y[0])
        point.z = TARGET_Y[0] + nz * (TARGET_Y[1] - TARGET_Y[0])

    # The non-uniform canonical fit invalidates Meshy's baked tangent frame.
    obj.data.validate(clean_customdata=True)
    obj.data.update(calc_edges=True)
    obj.name = "precentor"
    obj.data.name = "precentor"
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def face_eye_uvs(obj: bpy.types.Object) -> list[dict]:
    """Resolve four eye samples from 3D face points into Meshy's UV atlas."""
    uv_layer = obj.data.uv_layers.active
    if not uv_layer:
        return []
    targets = (
        (-0.22, 1.50, 1.08, 1.45), (0.22, 1.50, 1.08, 1.45),
        (-0.11, 1.43, 1.28, 0.85), (0.11, 1.43, 1.28, 0.85),
    )
    resolved: list[dict] = []
    for tx, ty, tz, scale in targets:
        target = Vector((tx, -tz, ty))
        ranked = [((vertex.co - target).length_squared, vertex.index)
                  for vertex in obj.data.vertices]
        if not ranked:
            continue
        best = min(distance for distance, _ in ranked)
        winners = {index for distance, index in ranked if abs(distance - best) <= 1e-10}
        samples = set()
        for loop in obj.data.loops:
            if loop.vertex_index not in winners:
                continue
            uv = uv_layer.data[loop.index].uv
            samples.add((round(float(uv.x % 1.0), 7), round(float(uv.y % 1.0), 7)))
        for sample in sorted(samples):
            resolved.append({
                "uv": sample,
                "scale": scale,
                "distanceM": round(math.sqrt(best), 5),
            })
    return resolved


def resize_and_grade_images(texture_size: int, eye_uvs: list[dict]) -> list[dict]:
    """Turn Meshy's pale source into violet-black Bloom chitin."""
    images = sorted(
        (image for image in bpy.data.images
         if image.source not in {"VIEWER", "RENDER_RESULT"}
         and image.size[0] > 0 and image.size[1] > 0),
        key=lambda image: image.name,
    )
    for image in images:
        if image.size[0] != texture_size or image.size[1] != texture_size:
            image.scale(texture_size, texture_size)

    pixel_data: dict[bpy.types.Image, np.ndarray] = {}
    for image in images:
        expected = image.size[0] * image.size[1] * 4
        if len(image.pixels) != expected:
            continue
        pixels = np.empty(expected, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape((-1, 4))
        np.nan_to_num(rgba, copy=False, nan=0.0, posinf=1.0, neginf=0.0)
        np.clip(rgba, 0.0, 1.0, out=rgba)
        pixel_data[image] = rgba

    base_image = next((image for image in images
                       if "base" in image.name.lower() or "color" in image.name.lower()), None)
    seam_mask = None
    if base_image in pixel_data:
        rgba = pixel_data[base_image]
        h, w = base_image.size[1], base_image.size[0]
        rgb = rgba[:, :3]
        lum = (rgb[:, 0] * 0.2126 + rgb[:, 1] * 0.7152
               + rgb[:, 2] * 0.0722).reshape((h, w))
        edge = np.maximum.reduce((
            np.abs(lum - np.roll(lum, 1, axis=0)),
            np.abs(lum - np.roll(lum, -1, axis=0)),
            np.abs(lum - np.roll(lum, 1, axis=1)),
            np.abs(lum - np.roll(lum, -1, axis=1)),
        ))
        edge[[0, -1], :] = 0.0
        edge[:, [0, -1]] = 0.0
        lo = float(np.quantile(edge, 0.950))
        hi = float(np.quantile(edge, 0.995))
        seam_mask = np.clip((edge - lo) / max(hi - lo, 1e-6), 0.0, 1.0) ** 0.76

    report = []
    for image in images:
        rgba = pixel_data.get(image)
        if rgba is None:
            continue
        old_name = image.name
        name = old_name.lower()
        rgb = rgba[:, :3]
        kind = "other"
        active_pct = None
        hot_pct = None

        if "base" in name or "color" in name:
            kind = "baseColor"
            lum = np.clip(rgb[:, 0] * 0.2126 + rgb[:, 1] * 0.7152
                          + rgb[:, 2] * 0.0722, 0.0, 1.0)
            tone = lum ** 1.30
            cool_detail = np.clip((rgb[:, 1] + rgb[:, 2]) * 0.5 - rgb[:, 0], 0.0, 1.0)
            rgba[:, 0] = np.clip(0.040 + tone * 0.720 + cool_detail * 0.025, 0.0, 1.0)
            rgba[:, 1] = np.clip(0.018 + tone * 0.340 + cool_detail * 0.035, 0.0, 1.0)
            rgba[:, 2] = np.clip(0.070 + tone * 0.920 + cool_detail * 0.085, 0.0, 1.0)
        elif "emit" in name:
            kind = "emissive"
            lum = np.clip(rgb[:, 0] * 0.2126 + rgb[:, 1] * 0.7152
                          + rgb[:, 2] * 0.0722, 0.0, 1.0)
            mask = (np.clip((lum - 0.34) / 0.56, 0.0, 1.0) ** 2.15).reshape(
                (image.size[1], image.size[0]))
            if seam_mask is not None and seam_mask.shape == mask.shape:
                mask = np.maximum(mask, seam_mask * 0.86)
            h, w = image.size[1], image.size[0]
            yy, xx = np.ogrid[:h, :w]
            for eye in eye_uvs:
                cx = int(round(eye["uv"][0] * (w - 1)))
                cy = int(round(eye["uv"][1] * (h - 1)))
                sigma = max(2.6, w * 0.0055 * eye["scale"])
                glow = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2)
                              / (2.0 * sigma * sigma))
                mask = np.maximum(mask, glow)
            flat = np.clip(mask.reshape(-1), 0.0, 1.0)
            rgba[:, 0] = flat * 0.045
            rgba[:, 1] = flat * 0.92
            rgba[:, 2] = flat
            active_pct = round(float(np.mean(flat > 0.025) * 100), 2)
            hot_pct = round(float(np.mean(flat > 0.55) * 100), 2)
        elif "normal" in name:
            kind = "normal"
        elif "metal" in name or "rough" in name or "mr" in name:
            kind = "metallicRoughness"
            # glTF packs roughness in G and metallic in B.
            rgba[:, 1] = np.clip(0.80 + (rgba[:, 1] - 0.5) * 0.24, 0.68, 0.92)
            rgba[:, 2] = np.clip(rgba[:, 2] * 0.05, 0.0, 0.05)

        image.name = f"precentor-{kind}"
        image.pixels.foreach_set(rgba.reshape(-1))
        image.update()
        image.pack()
        entry = {
            "name": image.name,
            "sourceName": old_name,
            "kind": kind,
            "width": image.size[0],
            "height": image.size[1],
        }
        if active_pct is not None:
            entry.update({"activePct": active_pct, "hotPct": hot_pct})
        report.append(entry)
    return sorted(report, key=lambda item: item["kind"])


def tune_material(obj: bpy.types.Object) -> list[str]:
    names = []
    for slot in obj.material_slots:
        material = slot.material
        if material is None:
            continue
        material.name = "precentor-bloom-pbr"
        material.use_nodes = True
        material.use_backface_culling = True
        material.diffuse_color = (1.0, 1.0, 1.0, 1.0)
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.62
            bsdf.inputs["Metallic"].default_value = 0.04
            if "IOR" in bsdf.inputs:
                bsdf.inputs["IOR"].default_value = 1.18
            if "Specular IOR Level" in bsdf.inputs:
                bsdf.inputs["Specular IOR Level"].default_value = 0.28
            if "Coat Weight" in bsdf.inputs:
                bsdf.inputs["Coat Weight"].default_value = 0.06
                bsdf.inputs["Coat Roughness"].default_value = 0.42
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = 1.45
        names.append(material.name)
    return names


def mirror(point: tuple[float, float, float], sx: float) -> Vector:
    return Vector((point[0] * sx, point[1], point[2]))


def build_bone_table() -> list[dict]:
    """Dedicated 30-joint mantis rig: 14 body/face/scythe + 16 walking."""
    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0.28, 0)},
        {"name": "thorax", "head": (0, 0.93, -0.05), "tail": (0, 1.10, 0.35),
         "parent": "root"},
        {"name": "pronotum", "head": (0, 1.08, 0.25), "tail": (0, 1.35, 0.62),
         "parent": "thorax"},
        {"name": "head", "head": (0, 1.34, 0.60), "tail": (0, 1.48, 1.18),
         "parent": "pronotum"},
        {"name": "abdomen", "head": (0, 0.98, -0.32), "tail": (0, 0.82, -0.92),
         "parent": "thorax"},
        {"name": "abdomen2", "head": (0, 0.82, -0.92), "tail": (0, 0.52, -1.60),
         "parent": "abdomen", "connect": True},
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones.extend((
            {"name": f"mandible_{side}", "head": tuple(mirror((0.12, 1.37, 1.03), sx)),
             "tail": tuple(mirror((0.08, 1.28, 1.40), sx)), "parent": "head"},
            {"name": f"antenna_{side}", "head": tuple(mirror((0.10, 1.50, 1.02), sx)),
             "tail": tuple(mirror((0.52, 1.94, 0.55), sx)), "parent": "head"},
            {"name": f"scythe_{side}", "head": tuple(mirror((0.22, 1.08, 0.35), sx)),
             "tail": tuple(mirror((0.72, 1.50, 0.68), sx)), "parent": "thorax"},
            {"name": f"claw_{side}", "head": tuple(mirror((0.72, 1.50, 0.68), sx)),
             "tail": tuple(mirror((0.82, 1.20, 1.34), sx)),
             "parent": f"scythe_{side}", "connect": True},
        ))

    for index, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            # Runtime IK solves femur+tibia; coxa is only the short socket.
            # Keep its tail close to the measured hip so chain measurement
            # includes essentially the whole visible upper leg.
            mid = hip.lerp(knee, 0.02)
            coxa = f"coxa{index}_{side}"
            femur = f"femur{index}_{side}"
            tibia = f"tibia{index}_{side}"
            bones.extend((
                {"name": coxa, "head": tuple(hip), "tail": tuple(mid), "parent": "thorax"},
                {"name": femur, "head": tuple(mid), "tail": tuple(knee),
                 "parent": coxa, "connect": True},
                {"name": tibia, "head": tuple(knee), "tail": tuple(foot),
                 "parent": femur, "connect": True},
                {"name": f"foot{index}_{side}", "head": tuple(foot),
                 "tail": tuple(foot + Vector((0, 0, 0.14))),
                 "parent": tibia, "connect": True},
            ))
    if len(bones) != 30:
        raise RuntimeError(f"Precentor rig must have exactly 30 joints, found {len(bones)}")
    return bones


def point_segment_distance(point: Vector, head: Vector, tail: Vector) -> float:
    segment = tail - head
    if segment.length_squared < 1e-10:
        return (point - head).length
    t = max(0.0, min(1.0, (point - head).dot(segment) / segment.length_squared))
    return (point - (head + segment * t)).length


def loose_components(mesh_obj: bpy.types.Object) -> list[dict]:
    adjacency = [[] for _ in mesh_obj.data.vertices]
    for edge in mesh_obj.data.edges:
        a, b = edge.vertices
        adjacency[a].append(b)
        adjacency[b].append(a)
    components = []
    vertex_component = [-1] * len(adjacency)
    seen = set()
    for seed in range(len(adjacency)):
        if seed in seen:
            continue
        stack = [seed]
        seen.add(seed)
        indices = []
        while stack:
            index = stack.pop()
            indices.append(index)
            vertex_component[index] = len(components)
            for neighbor in adjacency[index]:
                if neighbor in seen:
                    continue
                seen.add(neighbor)
                stack.append(neighbor)
        points = [Vector((mesh_obj.data.vertices[index].co.x,
                          mesh_obj.data.vertices[index].co.z,
                          -mesh_obj.data.vertices[index].co.y))
                  for index in indices]
        low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
        high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
        components.append({
            "indices": sorted(indices),
            "centre": (low + high) * 0.5,
            "span": high - low,
            "low": low,
            "high": high,
            "faces": [],
        })
    for polygon in mesh_obj.data.polygons:
        component = vertex_component[polygon.vertices[0]]
        components[component]["faces"].append(polygon.index)
    return components


def compact_visible_tarsi(mesh_obj: bpy.types.Object) -> dict:
    """Shorten the low contact claws around their measured plant points.

    Meshy's long layered tarsi look excellent at rest, but a foot bone inherits
    the solved tibia rotation in the runtime two-bone chain. Their original
    half-metre sweep therefore alternated between floating and cutting through
    terrain during a full pivot. Compacting only the low distal shells keeps
    the hooked silhouette and texture detail while bounding the *rendered*
    contact geometry, including adjacent tibia plates—not just a vertex label.
    """
    components = loose_components(mesh_obj)
    contacts = []
    for index, rig in enumerate(LEG_WEIGHT_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            contacts.append((index, side, mirror(rig["foot"], sx)))

    selected = []
    touched = set()
    for component_index, component in enumerate(components):
        if component["low"].y >= 0.32:
            continue
        nearest = min(
            contacts,
            key=lambda entry: math.hypot(
                component["centre"].x - entry[2].x,
                component["centre"].z - entry[2].z,
            ),
        )
        horizontal = math.hypot(
            component["centre"].x - nearest[2].x,
            component["centre"].z - nearest[2].z,
        )
        if horizontal > 0.46:
            continue
        contact = nearest[2]
        for vertex_index in component["indices"]:
            vertex = mesh_obj.data.vertices[vertex_index]
            point = Vector((vertex.co.x, vertex.co.z, -vertex.co.y))
            point.x = contact.x + (point.x - contact.x) * TARSUS_COMPACT_SCALE
            point.z = contact.z + (point.z - contact.z) * TARSUS_COMPACT_SCALE
            # Keep the authored sole plane at y=0 while making bulky distal
            # plates thinner; the contact marker itself remains 0.08m below.
            point.y *= 0.76
            vertex.co = (point.x, -point.z, point.y)
            touched.add(vertex_index)
        selected.append({
            "component": component_index,
            "pair": nearest[0],
            "side": nearest[1],
            "vertices": len(component["indices"]),
            "horizontalDistanceM": round(horizontal, 5),
        })
    mesh_obj.data.update()
    return {
        "method": "physical low-shell compaction around measured plant points",
        "horizontalScale": TARSUS_COMPACT_SCALE,
        "verticalScaleFromSole": 0.76,
        "selectionRadiusM": 0.46,
        "selectionLowYMaxM": 0.32,
        "components": len(selected),
        "vertices": len(touched),
        "perLeg": {
            f"{pair}_{side}": sum(
                1 for entry in selected
                if entry["pair"] == pair and entry["side"] == side)
            for pair in range(WALKING_PAIRS) for side in ("L", "R")
        },
    }


def create_shell_weights(
        mesh_obj: bpy.types.Object,
        bones: list[dict],
) -> tuple[dict, list[dict], int]:
    """Assign each disconnected exoskeleton shell rigidly to one joint."""
    specs = {entry["name"]: entry for entry in bones}
    groups = {name: mesh_obj.vertex_groups.new(name=name) for name in specs}
    segments = {name: (Vector(spec["head"]), Vector(spec["tail"]))
                for name, spec in specs.items()}
    for index, rig in enumerate(LEG_WEIGHT_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            socket = hip.lerp(knee, 0.02)
            segments[f"coxa{index}_{side}"] = (hip, socket)
            segments[f"femur{index}_{side}"] = (socket, knee)
            segments[f"tibia{index}_{side}"] = (knee, foot)
            segments[f"foot{index}_{side}"] = (
                foot, foot + Vector((0, 0, 0.14)))
    counts = {name: 0 for name in specs}
    body = ("thorax", "pronotum", "head", "abdomen", "abdomen2")
    components = loose_components(mesh_obj)

    for component in components:
        centre = component["centre"]
        spans = sorted(component["span"])
        side = "L" if centre.x >= 0.0 else "R"
        component["lockBone"] = False

        if centre.y > 1.56 and abs(centre.x) > 0.10 and spans[1] < 0.16:
            # Meshy breaks each feeler into many overlapping rings without a
            # trustworthy base seam. Carry the complete feeler with the head;
            # the antenna helper bones retain the contract but cannot tear
            # individual rings away during a flinch or death curl.
            candidates = ("head",)
            component["lockBone"] = True
        elif (centre.y > 1.12 and centre.z > 0.78
              and abs(centre.x) < 0.40):
            # Cheek and crest plates overlap the folded forelimbs in
            # projection. Claim the compact facial volume first so those
            # shells follow the head instead of orbiting a scythe shoulder.
            candidates = ("head",)
        elif ((abs(centre.x) > 0.20 and centre.y > 1.05 and centre.z > 0.28)
              or (abs(centre.x) > 0.50 and centre.y > 1.20 and centre.z > -0.12)
              or (abs(centre.x) > 0.25 and centre.y > 0.45 and centre.z > 0.75)
              or (abs(centre.x) > 0.55 and centre.y > 0.64 and centre.z > 0.64)):
            # The raptorial limb is a layered high shoulder blade plus a
            # forward folded blade. The remesh has no stable elbow seam, so
            # its overlapping plates remain one coherent scythe silhouette.
            candidates = (f"scythe_{side}",)
        elif ((abs(centre.x) > 0.38 and centre.z < 0.40 and centre.y < 1.36)
              or (abs(centre.x) > 0.34 and centre.y < 0.92)):
            pair = min(
                range(WALKING_PAIRS),
                key=lambda index: min(
                    point_segment_distance(centre, *segments[f"{stem}{index}_{side}"])
                    for stem in ("coxa", "femur", "tibia", "foot")
                ),
            )
            foot_name = f"foot{pair}_{side}"
            coxa_name = f"coxa{pair}_{side}"
            foot_distance = (centre - Vector(specs[foot_name]["head"])).length
            coxa_distance = point_segment_distance(centre, *segments[coxa_name])
            if centre.y < 0.14 and foot_distance < 0.46:
                candidates = (foot_name,)
            elif coxa_distance < 0.14:
                candidates = (coxa_name,)
            else:
                candidates = (f"femur{pair}_{side}", f"tibia{pair}_{side}")
        else:
            candidates = body

        ranked = sorted(
            ((point_segment_distance(centre, *segments[name]), name) for name in candidates),
            key=lambda item: (item[0], item[1]),
        )
        bone = ranked[0][1]
        component["bone"] = bone

    def shell_gap(a: dict, b: dict) -> float:
        delta = Vector((
            max(0.0, b["low"].x - a["high"].x, a["low"].x - b["high"].x),
            max(0.0, b["low"].y - a["high"].y, a["low"].y - b["high"].y),
            max(0.0, b["low"].z - a["high"].z, a["low"].z - b["high"].z),
        ))
        return delta.length

    # Meshy's remesh is deliberately layered armour: hundreds of islands,
    # including tiny trim slivers. Major shells classify reliably; adjacent
    # trim inherits the nearest major shell joint so it cannot orbit alone.
    anchors = [component for component in components
               if len(component["indices"]) >= 60]
    coherence_reassignments = 0
    for component in components:
        if len(component["indices"]) >= 60:
            continue
        if component["lockBone"] or component["bone"].startswith(("foot", "antenna")):
            continue
        centre = component["centre"]
        nearby = []
        for anchor in anchors:
            other = anchor["centre"]
            if (abs(centre.x) > 0.12 and abs(other.x) > 0.12
                    and centre.x * other.x < 0.0):
                continue
            gap = shell_gap(component, anchor)
            if gap <= 0.055:
                nearby.append((gap, (centre - other).length,
                               anchor["indices"][0], anchor))
        if not nearby:
            continue
        nearest = min(nearby, key=lambda item: item[:3])[3]
        if nearest["bone"] != component["bone"]:
            component["bone"] = nearest["bone"]
            coherence_reassignments += 1

    for component in components:
        bone = component["bone"]
        groups[bone].add(component["indices"], 1.0, "REPLACE")
        counts[bone] += len(component["indices"])
    return counts, components, coherence_reassignments


def add_selective_plate_backing(mesh_obj: bpy.types.Object, components: list[dict]) -> dict:
    """Back thin open armour plates; keep solid/tubular anatomy front-sided."""
    selected_faces = set()
    selected_components = 0
    selected_triangles = 0
    candidates = []
    for component in components:
        spans = sorted(float(value) for value in component["span"])
        thin_plate = spans[0] <= 0.070 and spans[1] >= 0.090 and spans[2] >= 0.18
        if not thin_plate:
            continue
        triangles = sum(
            len(mesh_obj.data.polygons[face_index].vertices) - 2
            for face_index in component["faces"]
        )
        limb_priority = (2 if component["bone"].startswith("scythe_")
                         else (1 if component["bone"].startswith(
                             ("coxa", "femur", "tibia")) else 0))
        candidates.append((
            limb_priority,
            spans[1] * spans[2],
            component["indices"][0],
            triangles,
            component,
        ))

    # Preserve raptorial plates first and proximal walking-leg plates second,
    # then spend the fixed budget on broad body plates. This stops a thin
    # connector from vanishing at its back-facing review angle without paying
    # the whole-body double-sided cost.
    for _, _, _, triangles, component in sorted(
            candidates, key=lambda item: (-item[0], -item[1], item[2])):
        if selected_triangles + triangles > 3000:
            continue
        selected_components += 1
        for face_index in component["faces"]:
            polygon = mesh_obj.data.polygons[face_index]
            selected_faces.add(face_index)
        selected_triangles += triangles

    if selected_faces:
        bpy.context.view_layer.objects.active = mesh_obj
        mesh_obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_mode(type="FACE")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.object.mode_set(mode="OBJECT")
        for polygon in mesh_obj.data.polygons:
            polygon.select = polygon.index in selected_faces
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.duplicate()
        bpy.ops.mesh.flip_normals()
        bpy.ops.object.mode_set(mode="OBJECT")
        mesh_obj.data.update(calc_edges=True)
        mesh_obj.select_set(False)
    return {
        "method": "coincident reversed geometry on thin open armour plate shells",
        "components": selected_components,
        "addedTriangles": selected_triangles,
        "triangleBudget": 3000,
        "wholeBodyDoubleSided": False,
    }


def build_actions(armature: bpy.types.Object) -> list[str]:
    """Retarget the proven five mantis clips to the Meshy proportions."""
    original_leg_z = legacy.LEG_Z
    legacy.LEG_Z = tuple(range(WALKING_PAIRS))
    try:
        clips = legacy.build_actions(armature)
    finally:
        legacy.LEG_Z = original_leg_z
    if tuple(clips) != EXPECTED_CLIPS:
        raise RuntimeError(f"unexpected Precentor clips: {clips}")
    for clip in clips:
        action = bpy.data.actions.get(clip)
        if action is None:
            raise RuntimeError(f"missing authored action {clip}")
        gains = ACTION_GAINS[clip]
        for curve in action.fcurves:
            if not curve.data_path.endswith(".rotation_euler"):
                continue
            marker = 'pose.bones["'
            if marker not in curve.data_path:
                continue
            bone = curve.data_path.split(marker, 1)[1].split('"]', 1)[0]
            stem = bone.split("_", 1)[0].rstrip("0123456789")
            gain = gains.get(stem, gains.get(bone, 1.0))
            if gain == 1.0:
                continue
            for point in curve.keyframe_points:
                point.co[1] *= gain
                point.handle_left[1] *= gain
                point.handle_right[1] *= gain
    return clips


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path.resolve()),
        export_format="GLB",
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_bake_animation=False,
        export_optimize_animation_size=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )


def main() -> None:
    args = parse_args()
    if not args.input.is_file():
        raise FileNotFoundError(args.input)
    kit.reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(args.input.resolve()))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"expected one Meshy mesh, found {len(meshes)}")
    mesh_obj = meshes[0]
    if len(mesh_obj.material_slots) != 1:
        raise RuntimeError(f"expected one Meshy material, found {len(mesh_obj.material_slots)}")

    flatten_imported_mesh(mesh_obj)
    reshape_to_gameplay_envelope(mesh_obj)
    tarsal_compaction = compact_visible_tarsi(mesh_obj)
    eye_uvs = face_eye_uvs(mesh_obj)
    textures = resize_and_grade_images(args.texture_size, eye_uvs)
    materials = tune_material(mesh_obj)

    bones = build_bone_table()
    weight_counts, components, coherence_reassignments = create_shell_weights(
        mesh_obj, bones)
    plate_backing = add_selective_plate_backing(mesh_obj, components)
    if mesh_obj.data.uv_layers.active:
        # Bake the final post-fit tangent basis once, after the selective
        # backing is present, rather than asking each export stage to infer it.
        mesh_obj.data.calc_tangents(uvmap=mesh_obj.data.uv_layers.active.name)
    armature = kit.build_armature("precentor-rig", bones)
    kit.bind(mesh_obj, armature)

    # The Armature modifier is the skin link. Keeping the mesh parented adds
    # glTF's NODE_SKINNED_MESH_NON_ROOT warning and ambiguous transforms.
    mesh_world = mesh_obj.matrix_world.copy()
    mesh_obj.parent = None
    mesh_obj.matrix_world = mesh_world
    bpy.context.view_layer.objects.active = armature
    clips = build_actions(armature)

    if args.save_blend:
        args.save_blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.save_blend.resolve()))

    export_glb(args.output)
    low, high = world_bounds(mesh_obj)
    triangles = sum(len(polygon.vertices) - 2 for polygon in mesh_obj.data.polygons)
    report = {
        "pipeline": "Meshy remesh -> Blender canonical fit, PBR grade, shell rig, animation",
        "input": repo_path(args.input),
        "inputSha256": sha256(args.input),
        "output": repo_path(args.output),
        "outputBytes": args.output.stat().st_size,
        "blender": bpy.app.version_string,
        "numpy": np.__version__,
        "triangles": triangles,
        "vertices": len(mesh_obj.data.vertices),
        "looseShells": len(components),
        "meshObjects": 1,
        "primitives": 1,
        "bones": len(bones),
        "boneNames": [entry["name"] for entry in bones],
        "walkingPairs": WALKING_PAIRS,
        "clips": clips,
        "legOwnedClips": ["death"],
        "actionRetargetGains": ACTION_GAINS,
        "soleGroundOffsetM": 0.08,
        "tarsalCompaction": tarsal_compaction,
        "dimensions": {
            "widthM": round(high.x - low.x, 5),
            "heightM": round(high.z - low.z, 5),
            "lengthM": round(high.y - low.y, 5),
            "runtimeAtScale1_55": {
                "widthM": round((high.x - low.x) * 1.55, 3),
                "heightM": round((high.z - low.z) * 1.55, 3),
                "lengthM": round((high.y - low.y) * 1.55, 3),
            },
        },
        "materials": materials,
        "textures": textures,
        "faceEyeUvs": eye_uvs,
        "thinPlateBacking": plate_backing,
        "weighting": {
            "method": "one deterministic joint per disconnected armour shell",
            "maxInfluences": 1,
            "adjacentTrimReassignments": coherence_reassignments,
            "groups": {name: weight_counts[name] for name in sorted(weight_counts)
                       if weight_counts[name] > 0},
        },
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
