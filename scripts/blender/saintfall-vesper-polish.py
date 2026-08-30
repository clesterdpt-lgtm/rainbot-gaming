#!/usr/bin/env python3
"""Build the browser-ready Vesper Reliquary player mesh.

The source is Meshy's 23k remesh after its humanoid rig pass.  This
script adds the pieces the single-view reconstruction could not infer:

* a load-bearing back yoke;
* a near-flush emissive chest reliquary that clears the support arm;
* rigid combat cuffs that keep the forearms readable while gripping a
  two-handed weapon.

It also strips the halo crescent, which Meshy welded into the body mesh
and which cannot be removed at runtime for that reason.

Every addition is weighted rigidly to an existing Meshy bone and then
joined into the skinned body.  The result stays one skinned mesh with a
small, explicit material set and no runtime-only helper objects.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets/models/saintfall/vesper/vesper-reliquary-rigged.glb"
OUTPUT = ROOT / "assets/models/saintfall/vesper/vesper-reliquary-polished.raw.glb"


def clean_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures,
                       bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name: str, color: tuple[float, float, float, float], *,
             metallic: float, roughness: float,
             emission: tuple[float, float, float, float] | None = None,
             emission_strength: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    bsdf = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = color
    (bsdf.inputs.get("Metallic IOR Level") or bsdf.inputs["Metallic"]).default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def bevel(obj: bpy.types.Object, width: float, segments: int = 1) -> None:
    mod = obj.modifiers.new("hero-edge", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def weight_to(obj: bpy.types.Object, bone: str) -> None:
    group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")


def box(name: str, location: Vector | tuple[float, float, float],
        dimensions: tuple[float, float, float], mat: bpy.types.Material,
        bone: str, bevel_width: float = 0.008) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel_width:
        bevel(obj, bevel_width)
    obj.data.materials.append(mat)
    weight_to(obj, bone)
    return obj


def tapered_plate(name: str, location: Vector | tuple[float, float, float],
                  bottom_width: float, top_width: float, height: float,
                  depth: float, mat: bpy.types.Material, bone: str,
                  bevel_width: float = 0.008) -> bpy.types.Object:
    """Low-poly reliquary plate with a real tapered silhouette.

    Cubes read as temporary scaffolding on the Vesper's otherwise
    faceted armour.  This eight-vertex shell is deliberately simple,
    but its raked sides and bevel catch enough light to read as an
    authored cuirass/yoke at normal gameplay distance.
    """
    bw = bottom_width * 0.5
    tw = top_width * 0.5
    hh = height * 0.5
    hd = depth * 0.5
    verts = [
        (-bw, -hd, -hh), (bw, -hd, -hh), (tw, -hd, hh), (-tw, -hd, hh),
        (-bw, hd, -hh), (bw, hd, -hh), (tw, hd, hh), (-tw, hd, hh),
    ]
    faces = [
        (0, 1, 2, 3), (7, 6, 5, 4),
        (0, 4, 5, 1), (1, 5, 6, 2),
        (2, 6, 7, 3), (3, 7, 4, 0),
    ]
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat)
    weight_to(obj, bone)
    if bevel_width:
        bevel(obj, bevel_width)
    return obj


def extruded_xz(name: str, profile: list[tuple[float, float]], y0: float,
                y1: float, mat: bpy.types.Material, bone: str,
                bevel_width: float = 0.0) -> bpy.types.Object:
    """Extrude a convex X/Z reliquary profile between two Y planes."""
    count = len(profile)
    verts = [(x, y0, z) for x, z in profile] + [(x, y1, z) for x, z in profile]
    faces: list[tuple[int, ...]] = []
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
    faces.append(tuple(reversed(range(count))))
    faces.append(tuple(range(count, count * 2)))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    weight_to(obj, bone)
    if bevel_width:
        bevel(obj, bevel_width)
    return obj


def deform_body_depth(body: bpy.types.Object) -> None:
    """Give the generated torso/pelvis mass without adding shell props."""
    group_index = {group.index: group.name for group in body.vertex_groups}
    inverse = body.matrix_world.inverted()

    def bell(z: float, low: float, high: float) -> float:
        t = max(0.0, min(1.0, (z - low) / (high - low)))
        return math.sin(math.pi * t) ** 2

    for vertex in body.data.vertices:
        world = body.matrix_world @ vertex.co
        # The halo shares the body mesh and Spine weights.  Its depth
        # is authored independently and must not be inflated with the torso.
        if world.y > 0.135 and world.z > 1.24:
            continue
        torso_weight = 0.0
        hips_weight = 0.0
        for membership in vertex.groups:
            name = group_index.get(membership.group, "")
            if name in {"Spine", "Spine01", "Spine02"}:
                torso_weight = max(torso_weight, membership.weight)
            elif name == "Hips":
                hips_weight = max(hips_weight, membership.weight)
        gain = min(
            0.18,
            torso_weight * 0.14 * bell(world.z, 1.06, 1.56)
            + hips_weight * 0.18 * bell(world.z, 0.84, 1.18),
        )
        if gain <= 0.0:
            continue
        pivot_y = (-0.025 * torso_weight - 0.045 * hips_weight) / max(
            1e-6, torso_weight + hips_weight
        )
        world.y = pivot_y + (world.y - pivot_y) * (1.0 + gain)
        vertex.co = inverse @ world
    body.data.update()


def elliptical_vambrace(name: str, elbow: Vector, hand: Vector,
                        mat: bpy.types.Material, bone: str) -> bpy.types.Object:
    """Faceted three-ring vambrace aligned along the forearm."""
    centre = elbow.lerp(hand, 0.67)
    rings = [
        (-0.0925, 0.096, 0.078),
        (0.0000, 0.083, 0.068),
        (0.0925, 0.070, 0.058),
    ]
    sides = 8
    verts: list[tuple[float, float, float]] = []
    for axial, rx, ry in rings:
        for side in range(sides):
            angle = (side / sides) * math.tau + math.pi / 8
            verts.append((math.cos(angle) * rx, math.sin(angle) * ry, axial))
    faces: list[tuple[int, ...]] = []
    for ring in range(len(rings) - 1):
        a0 = ring * sides
        b0 = (ring + 1) * sides
        for side in range(sides):
            nxt = (side + 1) % sides
            faces.append((a0 + side, a0 + nxt, b0 + nxt, b0 + side))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple(range((len(rings) - 1) * sides, len(rings) * sides)))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = centre
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(
        (hand - elbow).normalized()
    )
    obj.data.materials.append(mat)
    weight_to(obj, bone)
    return obj


def beam(name: str, start: Vector | tuple[float, float, float],
         end: Vector | tuple[float, float, float], width: float, depth: float,
         mat: bpy.types.Material, bone: str,
         bevel_width: float = 0.006) -> bpy.types.Object:
    a, b = Vector(start), Vector(end)
    direction = b - a
    obj = box(name, (a + b) * 0.5,
              (direction.length, depth, width), mat, bone, bevel_width)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((1.0, 0.0, 0.0)).rotation_difference(direction.normalized())
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=False)
    return obj


def cylinder_between(name: str, start: Vector | tuple[float, float, float],
                     end: Vector | tuple[float, float, float], radius: float,
                     mat: bpy.types.Material, bone: str,
                     vertices: int = 8) -> bpy.types.Object:
    a, b = Vector(start), Vector(end)
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=direction.length,
        end_fill_type="NGON", location=(a + b) * 0.5,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction.normalized())
    obj.data.materials.append(mat)
    weight_to(obj, bone)
    bevel(obj, min(radius * 0.18, 0.008))
    return obj


def bracer(name: str, elbow: Vector, hand: Vector, mat: bpy.types.Material,
           bone: str) -> bpy.types.Object:
    direction = hand - elbow
    centre = elbow.lerp(hand, 0.66)
    length = 0.145
    bpy.ops.mesh.primitive_cone_add(
        vertices=6, radius1=0.078, radius2=0.058, depth=length,
        end_fill_type="NGON", location=centre,
    )
    obj = bpy.context.object
    obj.name = name
    # Flatten the wrap before orienting it.  The previous circular
    # cuff and full-radius rim became a pair of boxy gold bracelets
    # at distance and overpowered both hands and the reliquary.
    obj.scale.x = 0.72
    obj.scale.y = 0.52
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction.normalized())
    obj.data.materials.append(mat)
    weight_to(obj, bone)
    bevel(obj, 0.005)
    return obj


def diamond(name: str, location: tuple[float, float, float], width: float,
            height: float, depth: float, mat: bpy.types.Material,
            bone: str) -> bpy.types.Object:
    # Local axes are X across, Y front/back and Z vertical.  The
    # faceted eight-vertex shell gives the reliquary a real edge catch.
    w, h, d = width * 0.5, height * 0.5, depth * 0.5
    verts = [
        (0, -d, h), (w, -d, 0), (0, -d, -h), (-w, -d, 0),
        (0, d, h), (w, d, 0), (0, d, -h), (-w, d, 0),
    ]
    faces = [
        (0, 1, 2, 3), (7, 6, 5, 4),
        (0, 4, 5, 1), (1, 5, 6, 2),
        (2, 6, 7, 3), (3, 7, 4, 0),
    ]
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat)
    weight_to(obj, bone)
    bevel(obj, min(width, height) * 0.045)
    return obj


def bone_head(armature: bpy.types.Object, name: str) -> Vector:
    return armature.matrix_world @ armature.pose.bones[name].head


def strip_halo(body: bpy.types.Object) -> int:
    """Delete the welded halo crescent from the Meshy body mesh.

    The halo is not a separate object: Meshy's remesh welded it into the
    single skinned body and weighted it to Spine, so it cannot be
    unparented, hidden or unlinked.  It has to come out as geometry.

    Selecting it by a bounding region alone is unsafe - `world.y > 0.135
    and world.z > 1.24` (the region test `deform_body_depth` uses to
    avoid inflating it) also covers 2450 vertices of upper-back armour,
    and deleting that would open the back of the cuirass.  Selecting by
    CONNECTED ISLAND cannot punch a hole in a surface that is still
    wanted, because an island is either entirely removed or entirely
    kept.

    The first rule here was `behind y 0.135 AND topping out above
    z 1.60`, and the z half of it was wrong. It was meant to protect
    the back armour, but the arc is not one island - Meshy's remesh
    shattered it into ~240 - and most of the fragments top out between
    z 1.45 and 1.60. They failed the z test, survived, and left a
    curved blade standing off the left shoulder that read as exactly
    the artefact the strip was supposed to remove.

    The separation that actually works is DEPTH alone. The back plate
    reaches y 0.134 at its furthest; every fragment of the arc starts
    at y 0.160 or beyond. So the plane at y 0.150 splits them with
    ~16mm of clearance on both sides and needs no help from height -
    the only height term left keeps the rule off the hips.
    """
    mesh = body.data
    matrix = body.matrix_world
    parent = list(range(len(mesh.vertices)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for edge in mesh.edges:
        a, b = (find(i) for i in edge.vertices)
        if a != b:
            parent[b] = a

    islands: dict[int, list[int]] = {}
    world = [matrix @ v.co for v in mesh.vertices]
    for index in range(len(mesh.vertices)):
        islands.setdefault(find(index), []).append(index)

    doomed: set[int] = set()
    for members in islands.values():
        ys = [world[i].y for i in members]
        zs = [world[i].z for i in members]
        # Behind the depth plane: the arc and its fragments.
        if min(ys) > 0.150 and max(zs) > 1.20:
            doomed.update(members)
            continue
        # ABOVE THE CROWN. Six fragments, 74 vertices, sat at y 0.143
        # to 0.159 - a hair inboard of the depth plane, so the rule
        # above spared every one of them. They are 20cm clear of the
        # helm, which ends at z 1.801, and with the arc that used to
        # join them gone they hung in the air over the head. Nothing
        # legitimate is up here any more: the helm IS the top of the
        # figure, so height alone is decisive.
        if min(zs) > 1.86:
            doomed.update(members)
    if not doomed:
        return 0

    for vertex in mesh.vertices:
        vertex.select = vertex.index in doomed
    for edge in mesh.edges:
        edge.select = all(i in doomed for i in edge.vertices)
    for poly in mesh.polygons:
        poly.select = all(i in doomed for i in poly.vertices)

    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    return len(doomed)


def consolidate_material_slots(obj: bpy.types.Object) -> None:
    unique: list[bpy.types.Material] = []
    remap: dict[int, int] = {}
    for index, mat in enumerate(obj.data.materials):
        if mat not in unique:
            unique.append(mat)
        remap[index] = unique.index(mat)
    polygon_indices = [remap[poly.material_index] for poly in obj.data.polygons]
    obj.data.materials.clear()
    for mat in unique:
        obj.data.materials.append(mat)
    # Clearing the slots also resets every polygon to slot zero.  Restore
    # the compacted assignment only after the new slots exist.
    for poly, material_index in zip(obj.data.polygons, polygon_indices):
        poly.material_index = material_index


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)

    clean_scene()
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))

    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    body = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name == "char1")
    # Meshy exports one helper icosphere used by its Blender rig UI.  It
    # is not part of the glTF scene graph and has no place in the build.
    for obj in list(bpy.context.scene.objects):
        if obj not in (armature, body):
            bpy.data.objects.remove(obj, do_unlink=True)

    # The generated clip is a static base-layer pose.  Saintfall owns
    # locomotion and attacks procedurally, so exporting it would create
    # two systems writing the same bones every frame.
    if armature.animation_data:
        armature.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()

    base_mat = body.data.materials[0]
    base_mat.name = "vesper-atlas"
    base_mat.use_backface_culling = True
    for node in base_mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            (node.inputs.get("Metallic IOR Level") or node.inputs["Metallic"]).default_value = 0.28
            node.inputs["Roughness"].default_value = 0.46
            node.inputs["Emission Color"].default_value = (0.0, 0.0, 0.0, 1.0)
            node.inputs["Emission Strength"].default_value = 0.0

    # White and gold only.  These four used to be verdigris, bronze,
    # near-black iron and orange amber; the atlas is remapped to the
    # same two families in `saintfall-optimize-player.mjs`, and a
    # green vambrace bolted onto a rewhitened body would be the one
    # thing on the figure still wearing the old scheme.
    #
    # "White" here spans ivory to a deep warm grey.  Recesses still
    # need to go dark or every joint on the model flattens out - a
    # shade of white is still white, and a neutral that dark reads as
    # shadow rather than as a colour.
    # Warmed off neutral for the same reason the atlas ramp was: a
    # grey that is only 3% warm is a grey.  The dark iron sat at
    # (0.055, 0.052, 0.046), a near-black with no hue at all.
    #
    # Warmed by HUE, not by value.  Lifting it to 0.085 as well made
    # every recess on the figure half a stop brighter, and the plate's
    # 5th-percentile luminance went 11 -> 17: an armour whose
    # junctions have stopped reading.  This is the same trap the atlas
    # ramp's low stops fell into, in a second place.
    patina = material("vesper-patina", (0.84, 0.805, 0.715, 1.0), metallic=0.18, roughness=0.50)
    bronze = material("vesper-bronze", (0.70, 0.505, 0.140, 1.0), metallic=0.84, roughness=0.32)
    iron = material("vesper-dark-iron", (0.052, 0.044, 0.031, 1.0), metallic=0.55, roughness=0.58)
    amber = material(
        "vesper-reliquary-amber", (0.86, 0.66, 0.24, 1.0),
        metallic=0.05, roughness=0.32,
        emission=(1.0, 0.78, 0.34, 1.0), emission_strength=0.85,
    )

    additions: list[bpy.types.Object] = []

    # Take the halo out BEFORE the depth pass, so the pass no longer has
    # to carve an exception around geometry that is not there.
    stripped = strip_halo(body)

    # Fill the actual generated body before adding armour.  This is
    # what gives the rear/side view volume; bolting broad flat panels
    # around a thin core merely produces floating boards.
    deform_body_depth(body)

    # ---- Back: bare.
    # The halo crescent and everything that carried it are gone: the
    # rear rail, two mounting struts, three cross-pins, and the yoke
    # keystone, frame and recess the arc was bolted through.
    # `strip_halo` takes the welded arc itself out of the Meshy body
    # above; the rest were additions and are simply no longer made.
    #
    # The keystone survived one round on the argument that deleting it
    # would leave a bare patch where the eye is drawn by the missing
    # silhouette. In the game it read the other way round: with no arc
    # rising from it, a diamond boss on an otherwise clean backplate is
    # a lump with no job, and the eye goes to it precisely BECAUSE
    # nothing explains it. The back is better plain.

    # ---- Flush chest reliquary.
    # The old recess/frame/caps formed an 8-9cm prow and its anatomical-left
    # load rib entered the support-arm envelope.  Keep the amber identity,
    # but mount it as a compact inlay on the breastplate's flat lower band so
    # the left arm can cross the chest without a mast or floating upper tip.
    additions.append(diamond("reliquary-backing", (0.0, -0.194, 1.31), 0.062, 0.110, 0.006,
                             iron, "Spine"))
    additions.append(diamond("reliquary-core", (0.0, -0.201, 1.31), 0.040, 0.095, 0.008,
                             amber, "Spine"))

    # ---- Combat bracers: elliptical, tapered and visibly faceted.
    left_elbow = bone_head(armature, "LeftForeArm")
    left_hand = bone_head(armature, "LeftHand")
    right_elbow = bone_head(armature, "RightForeArm")
    right_hand = bone_head(armature, "RightHand")
    additions.append(elliptical_vambrace(
        "gauntlet-vambrace-left", left_elbow, left_hand, patina, "LeftForeArm"
    ))
    additions.append(elliptical_vambrace(
        "gauntlet-vambrace-right", right_elbow, right_hand, patina, "RightForeArm"
    ))

    # Join converts the world-space additions into the generated mesh's
    # unusual armature-scaled local space while preserving named weights.
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    for obj in additions:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = "VesperReliquary"
    body.data.name = "VesperReliquaryMesh"
    consolidate_material_slots(body)

    # Keep only the deforming scene roots selected for a deterministic export.
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = armature
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    print(f"Wrote {OUTPUT}")
    print(f"  halo vertices stripped={stripped}")
    print(f"  additions={len(additions)} materials={len(body.data.materials)} "
          f"vertices={len(body.data.vertices)} polygons={len(body.data.polygons)}")


if __name__ == "__main__":
    main()
