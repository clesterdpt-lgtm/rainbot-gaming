#!/usr/bin/env python3
"""Author stable locomotion clips for the Mr. Feast demon prototypes.

The first prototype pass used generic Meshy humanoid locomotion. That motion
made the Banquet Saint step through its robe and drove the Pale Maw's unusual
crouched legs through large, twisting human gait poses. This Blender pass
works directly on the shipped runtime rigs:

- Banquet Saint: ceremonial-glide from the forward-facing bind pose, with
  locked knees/elbows and two straight arms trailing as one pendulum.
- Pale Maw: diagonal anatomical-creep with stable lower-leg and forearm bind
  angles, driven from the hips and upper arms so the skinned joints do not
  stretch or double-articulate.

The exported GLB contains one looped, rotation-only skeletal action and no
mesh, skin, material, texture, translation, scale, or root-motion payload.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import bpy
from mathutils import Quaternion, Vector


FPS = 24
TARGET_HEIGHTS = {
    "pale-maw": 2.18,
    "banquet-saint": 2.34,
}
# Meshy's low crouch gives the two hip bones different bind-plane leverage.
# The right-side angle is therefore larger so the visible foot-tip travel,
# rather than the raw bone rotation, stays bilateral and speed-matched.
PALE_MAW_GAIT = {
    "idle": {
        "durationSeconds": 3.4,
        "leftHipSwingDegrees": 0.0,
        "rightHipSwingDegrees": 0.0,
        "armSwingDegrees": 1.2,
    },
    "walk": {
        "durationSeconds": 1.6,
        "leftHipSwingDegrees": 28.0,
        "rightHipSwingDegrees": 42.0,
        "armSwingDegrees": 30.0,
    },
    "run": {
        "durationSeconds": 1.0,
        "leftHipSwingDegrees": 32.0,
        "rightHipSwingDegrees": 48.0,
        "armSwingDegrees": 36.0,
    },
}
BONE_NAMES = (
    "Hips",
    "LeftUpLeg",
    "LeftLeg",
    "LeftFoot",
    "LeftToeBase",
    "RightUpLeg",
    "RightLeg",
    "RightFoot",
    "RightToeBase",
    "Spine02",
    "Spine01",
    "Spine",
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
    "neck",
    "Head",
    "head_end",
    "headfront",
)
CHILD_JOINT = {
    "LeftUpLeg": "LeftLeg",
    "LeftLeg": "LeftFoot",
    "LeftFoot": "LeftToeBase",
    "RightUpLeg": "RightLeg",
    "RightLeg": "RightFoot",
    "RightFoot": "RightToeBase",
    "LeftShoulder": "LeftArm",
    "LeftArm": "LeftForeArm",
    "LeftForeArm": "LeftHand",
    "RightShoulder": "RightArm",
    "RightArm": "RightForeArm",
    "RightForeArm": "RightHand",
}


@dataclass
class RigBasis:
    rotations: dict[str, Quaternion]
    locations: dict[str, Vector]
    scales: dict[str, Vector]
    orientations: dict[str, Quaternion]
    directions: dict[str, Vector]
    forward: Vector
    backward: Vector
    source_phase: float | None
    baseline_pose: str
    runtime_scale: float


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--slug", required=True, choices=("pale-maw", "banquet-saint"))
    parser.add_argument("--name", required=True, choices=("idle", "walk", "run"))
    parser.add_argument("--preview-dir", type=Path)
    parser.add_argument("--save-blend", type=Path)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


def portable_report_path(path: Path) -> str:
    """Prefer repository-relative provenance over machine-specific paths."""
    resolved = path.expanduser().resolve()
    project_root = Path(__file__).resolve().parents[2]
    try:
        return str(resolved.relative_to(project_root))
    except ValueError:
        return str(resolved)


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


def import_runtime_model(
    input_path: Path,
    slug: str,
) -> tuple[bpy.types.Object, list[bpy.types.Object], RigBasis]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(input_path))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    armatures = [obj for obj in imported if obj.type == "ARMATURE"]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one armature, found {len(armatures)}")
    if not meshes:
        raise RuntimeError("Runtime model has no preview mesh")
    armature = armatures[0]
    missing = [name for name in BONE_NAMES if name not in armature.pose.bones]
    if missing:
        raise RuntimeError(f"Runtime rig is missing bones: {missing}")
    if len(armature.pose.bones) != len(BONE_NAMES):
        raise RuntimeError(
            f"Expected exactly {len(BONE_NAMES)} bones, found {len(armature.pose.bones)}"
        )
    # Generic Meshy clips contain unsuitable authored posture: the Pale Maw's
    # crossed hind-chain twist and the Saint's crouched, diagonal-facing
    # stance. An identity Blender pose reproduces each processed runtime GLB's
    # clean, forward-facing bind basis before bespoke motion is layered on.
    # Prepared runtime models intentionally contain no embedded source action,
    # so authoring must work from that bind-only asset.
    source_phase = None
    baseline_pose = "processed-bind"
    armature.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    bpy.context.scene.frame_set(0)
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        pose_bone.location = Vector((0.0, 0.0, 0.0))
        pose_bone.scale = Vector((1.0, 1.0, 1.0))

    bpy.context.view_layer.update()
    minimum, maximum = world_bounds(meshes)
    source_height = maximum.z - minimum.z
    if source_height <= 1e-6:
        raise RuntimeError("Runtime source has an invalid bind-pose height")
    runtime_scale = TARGET_HEIGHTS[slug] / source_height
    rotations = {
        name: armature.pose.bones[name].rotation_quaternion.copy().normalized()
        for name in BONE_NAMES
    }
    locations = {
        name: armature.pose.bones[name].location.copy()
        for name in BONE_NAMES
    }
    scales = {
        name: armature.pose.bones[name].scale.copy()
        for name in BONE_NAMES
    }
    orientations = {
        name: armature.pose.bones[name].matrix.to_quaternion().normalized()
        for name in BONE_NAMES
    }
    directions = {}
    for bone_name, child_name in CHILD_JOINT.items():
        direction = (
            armature.pose.bones[child_name].head
            - armature.pose.bones[bone_name].head
        )
        if direction.length < 1e-6:
            raise RuntimeError(f"{bone_name} has an invalid posed joint direction")
        directions[bone_name] = direction.normalized()
    forward = (
        armature.pose.bones["headfront"].head
        - armature.pose.bones["Head"].head
    )
    if forward.length < 1e-6:
        raise RuntimeError("Head to headfront does not define the rig's facing direction")
    forward.normalize()
    forward.z = 0
    if forward.length < 1e-6:
        raise RuntimeError("The rig facing direction is vertical")
    forward.normalize()
    basis = RigBasis(
        rotations=rotations,
        locations=locations,
        scales=scales,
        orientations=orientations,
        directions=directions,
        forward=forward,
        backward=-forward,
        source_phase=source_phase,
        baseline_pose=baseline_pose,
        runtime_scale=runtime_scale,
    )
    armature.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    reset_pose(armature, basis)
    bpy.context.view_layer.update()
    return armature, meshes, basis


def reset_pose(armature: bpy.types.Object, basis: RigBasis) -> None:
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = basis.rotations[pose_bone.name].copy()
        pose_bone.location = basis.locations[pose_bone.name].copy()
        pose_bone.scale = basis.scales[pose_bone.name].copy()


def swing_toward(
    basis: RigBasis,
    bone_name: str,
    target_direction: Vector,
    angle_degrees: float,
) -> Quaternion:
    """Return a twist-free local-bone rotation toward an armature-space target."""
    if abs(angle_degrees) < 1e-7:
        return basis.rotations[bone_name].copy()
    rest_direction = basis.directions[bone_name]
    target = target_direction.normalized()
    target_plane = target - rest_direction * rest_direction.dot(target)
    if target_plane.length < 1e-6:
        raise RuntimeError(f"{bone_name} cannot swing toward {list(target_direction)}")
    target_plane.normalize()
    axis_armature = rest_direction.cross(target_plane)
    if axis_armature.length < 1e-6:
        raise RuntimeError(f"{bone_name} produced a degenerate swing axis")
    axis_armature.normalize()
    swing_armature = Quaternion(axis_armature, math.radians(abs(angle_degrees)))
    posed_orientation = basis.orientations[bone_name]
    local_delta = (
        posed_orientation.inverted()
        @ swing_armature
        @ posed_orientation
    ).normalized()
    local_rotation = (
        basis.rotations[bone_name]
        @ local_delta
    ).normalized()
    if local_rotation.w < 0:
        local_rotation.negate()
    return local_rotation


def directed_swing(
    basis: RigBasis,
    bone_name: str,
    signed_degrees: float,
) -> Quaternion:
    target = basis.forward if signed_degrees >= 0 else basis.backward
    return swing_toward(basis, bone_name, target, abs(signed_degrees))


def align_direction(
    basis: RigBasis,
    bone_name: str,
    target_direction: Vector,
) -> Quaternion:
    """Align one bone direction to a target without adding axial twist."""
    rest_direction = basis.directions[bone_name]
    target = target_direction.normalized()
    swing_armature = rest_direction.rotation_difference(target)
    posed_orientation = basis.orientations[bone_name]
    local_delta = (
        posed_orientation.inverted()
        @ swing_armature
        @ posed_orientation
    ).normalized()
    local_rotation = (
        basis.rotations[bone_name]
        @ local_delta
    ).normalized()
    if local_rotation.w < 0:
        local_rotation.negate()
    return local_rotation


def set_rotation(
    armature: bpy.types.Object,
    bone_name: str,
    rotation: Quaternion,
) -> None:
    armature.pose.bones[bone_name].rotation_quaternion = rotation


def key_all_bones(armature: bpy.types.Object, frame: int) -> None:
    for bone_name in BONE_NAMES:
        pose_bone = armature.pose.bones[bone_name]
        pose_bone.keyframe_insert(
            data_path="rotation_quaternion",
            frame=frame,
            group=bone_name,
        )


def quaternion_delta_degrees(
    baseline: Quaternion,
    rotation: Quaternion,
) -> float:
    dot = max(-1.0, min(1.0, abs(float(baseline.dot(rotation)))))
    return math.degrees(2.0 * math.acos(dot))


def action_hemisphere_flips(action: bpy.types.Action) -> int:
    """Count adjacent quaternion samples whose signs would cause a long interpolation."""
    grouped: dict[str, dict[int, list[tuple[float, float]]]] = {}
    for curve in action.fcurves:
        if not curve.data_path.endswith("rotation_quaternion"):
            continue
        grouped.setdefault(curve.data_path, {})[curve.array_index] = [
            (point.co.x, point.co.y) for point in curve.keyframe_points
        ]
    flips = 0
    for components in grouped.values():
        if set(components) != {0, 1, 2, 3}:
            continue
        frames = [frame for frame, _value in components[0]]
        quaternions: list[Quaternion] = []
        for index, _frame in enumerate(frames):
            quaternion = Quaternion(
                tuple(components[component][index][1] for component in range(4))
            ).normalized()
            quaternions.append(quaternion)
        flips += sum(
            1
            for previous, current in zip(quaternions, quaternions[1:])
            if previous.dot(current) < 0
        )
    return flips


def author_banquet_glide(
    armature: bpy.types.Object,
    basis: RigBasis,
    action_name: str,
) -> tuple[int, dict[str, Any]]:
    duration_seconds = {
        "idle": 4.0,
        "walk": 3.2,
        "run": 2.6,
    }[action_name]
    end_frame = round(duration_seconds * FPS)
    fractions = (0.0, 0.25, 0.5, 0.75, 1.0)
    back_angles = {
        "idle": (0.0, 1.5, 0.0, -1.5, 0.0),
        "walk": (8.0, 13.0, 9.0, 6.0, 8.0),
        "run": (10.0, 15.0, 11.0, 7.0, 10.0),
    }[action_name]
    down = Vector((0.0, 0.0, -1.0))
    locked_chain_rotations = {
        "LeftLeg": align_direction(
            basis,
            "LeftLeg",
            basis.directions["LeftUpLeg"],
        ),
        "RightLeg": align_direction(
            basis,
            "RightLeg",
            basis.directions["RightUpLeg"],
        ),
        "LeftForeArm": align_direction(
            basis,
            "LeftForeArm",
            basis.directions["LeftArm"],
        ),
        "RightForeArm": align_direction(
            basis,
            "RightForeArm",
            basis.directions["RightArm"],
        ),
    }

    for fraction, back_angle in zip(fractions, back_angles):
        frame = round(fraction * end_frame)
        reset_pose(armature, basis)
        for bone_name, rotation in locked_chain_rotations.items():
            set_rotation(armature, bone_name, rotation)
        pendulum_angle = math.radians(back_angle)
        pendulum_direction = (
            down * math.cos(pendulum_angle)
            + basis.backward * math.sin(pendulum_angle)
        ).normalized()
        for bone_name in ("LeftArm", "RightArm"):
            rotation = align_direction(
                basis,
                bone_name,
                pendulum_direction,
            )
            set_rotation(armature, bone_name, rotation)
        key_all_bones(armature, frame)

    excursion = max(back_angles) - min(back_angles)
    return end_frame, {
        "authoredStyle": "ceremonial-glide",
        "armMotionMode": "straight-pendulum-rear-trail",
        "armBackBiasDegrees": [min(back_angles), max(back_angles)],
        "armExcursionDegrees": round(excursion, 6),
        "armSymmetryErrorDegrees": 0,
        "legMotionDegrees": 0,
        "pendulumOpposesTravel": True,
        "maximumLimbExcursionDegrees": round(
            max(
                quaternion_delta_degrees(
                    basis.rotations[bone_name],
                    locked_chain_rotations[bone_name],
                )
                for bone_name in locked_chain_rotations
            ),
            6,
        ),
    }


def author_pale_maw_creep(
    armature: bpy.types.Object,
    basis: RigBasis,
    action_name: str,
) -> tuple[int, dict[str, Any]]:
    is_idle = action_name == "idle"
    gait = PALE_MAW_GAIT[action_name]
    duration_seconds = gait["durationSeconds"]
    end_frame = round(duration_seconds * FPS)
    fractions = (0.0, 0.25, 0.5, 0.75, 1.0)
    phases = (0.0, 1.0, 0.0, -1.0, 0.0)
    left_hip_swing = gait["leftHipSwingDegrees"]
    right_hip_swing = gait["rightHipSwingDegrees"]
    arm_swing = gait["armSwingDegrees"]
    maximum_excursion = 0.0

    for fraction, phase in zip(fractions, phases):
        frame = round(fraction * end_frame)
        reset_pose(armature, basis)

        rotations = {
            "LeftUpLeg": directed_swing(
                basis,
                "LeftUpLeg",
                phase * left_hip_swing,
            ),
            "RightUpLeg": directed_swing(
                basis,
                "RightUpLeg",
                -phase * right_hip_swing,
            ),
            # Move each arm from its upper-arm parent and each leg from its
            # hip. Leaving the forearm and lower-leg rotations on their clean
            # bind values carries every distal chain as one rigid shape
            # instead of folding the generated skin weights at its elbows and
            # knees.
            #
            # These are strict diagonal pairs: left arm with right leg, right
            # arm with left leg.
            "LeftArm": directed_swing(
                basis,
                "LeftArm",
                -phase * arm_swing,
            ),
            "RightArm": directed_swing(
                basis,
                "RightArm",
                phase * arm_swing,
            ),
        }
        for bone_name, rotation in rotations.items():
            set_rotation(armature, bone_name, rotation)
            maximum_excursion = max(
                maximum_excursion,
                quaternion_delta_degrees(
                    basis.rotations[bone_name],
                    rotation,
                ),
            )
        key_all_bones(armature, frame)

    return end_frame, {
        "authoredStyle": "anatomical-creep",
        "kneeBendDirection": "anatomical-backward-flex",
        "maximumKneeTwistDegrees": 0,
        "maximumLimbExcursionDegrees": round(maximum_excursion, 6),
        "bilateralPhaseOffset": 0.5,
        "jointStabilization": "bind-angle-locked-distal-chains",
        "armDriver": "upper-arm-parent-rigid-distal-chain",
        "diagonalPairs": {
            "leftArm": "rightLeg",
            "rightArm": "leftLeg",
        },
        "limbDriverExcursionDegrees": {
            "leftArm": arm_swing,
            "rightArm": arm_swing,
            "leftLeg": left_hip_swing,
            "rightLeg": right_hip_swing,
        },
        "gait": (
            "settled-contralateral-idle"
            if is_idle
            else "speed-matched-contralateral"
        ),
        "propulsionMode": (
            "settled-four-contact"
            if is_idle
            else "four-limb-contact-push"
        ),
        "swingConstruction": "twist-free-directional-quaternion",
        "bindBasisMaximumAxialTwistDegrees": 0,
    }


def make_action(
    armature: bpy.types.Object,
    basis: RigBasis,
    slug: str,
    action_name: str,
) -> tuple[bpy.types.Action, int, dict[str, Any]]:
    armature.animation_data_create()
    action = bpy.data.actions.new(name=f"{slug}-{action_name}")
    armature.animation_data.action = action
    if slug == "banquet-saint":
        end_frame, metrics = author_banquet_glide(
            armature,
            basis,
            action_name,
        )
    else:
        end_frame, metrics = author_pale_maw_creep(
            armature,
            basis,
            action_name,
        )
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "SINE"
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = end_frame
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.frame_set(0)
    return action, end_frame, metrics


def select_only(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def export_animation_glb(
    output_path: Path,
    armature: bpy.types.Object,
) -> None:
    select_only([armature])
    requested = {
        "filepath": str(output_path),
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_animations": True,
        "export_animation_mode": "ACTIONS",
        "export_merge_animation": "ACTION",
        "export_frame_range": True,
        "export_force_sampling": False,
        "export_optimize_animation_size": False,
        "export_bake_animation": False,
        "export_skins": False,
        "export_morph": False,
        "export_cameras": False,
        "export_lights": False,
        "export_draco_mesh_compression_enable": False,
        "export_use_gltfpack": False,
    }
    available = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    result = bpy.ops.export_scene.gltf(
        **{key: value for key, value in requested.items() if key in available}
    )
    if "FINISHED" not in result:
        raise RuntimeError("Blender failed to export the locomotion GLB")


def world_bounds(meshes: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = [
        evaluated.matrix_world @ Vector(corner)
        for mesh in meshes
        for evaluated in (mesh.evaluated_get(depsgraph),)
        for corner in evaluated.bound_box
    ]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def joint_angle_degrees(
    armature: bpy.types.Object,
    parent_name: str,
    joint_name: str,
    child_name: str,
) -> float:
    parent = armature.pose.bones[parent_name].head
    joint = armature.pose.bones[joint_name].head
    child = armature.pose.bones[child_name].head
    incoming = parent - joint
    outgoing = child - joint
    if incoming.length < 1e-6 or outgoing.length < 1e-6:
        raise RuntimeError(f"Invalid joint chain at {joint_name}")
    return math.degrees(incoming.angle(outgoing))


def measure_action_metrics(
    slug: str,
    armature: bpy.types.Object,
    meshes: list[bpy.types.Object],
    basis: RigBasis,
    end_frame: int,
) -> dict[str, Any]:
    joint_specs = {
        "leftKnee": ("LeftUpLeg", "LeftLeg", "LeftFoot"),
        "rightKnee": ("RightUpLeg", "RightLeg", "RightFoot"),
        "leftElbow": ("LeftArm", "LeftForeArm", "LeftHand"),
        "rightElbow": ("RightArm", "RightForeArm", "RightHand"),
    }
    joint_samples = {name: [] for name in joint_specs}
    limb_projections = {
        name: []
        for name in ("LeftHand", "RightHand", "LeftFoot", "RightFoot")
    }
    facing_alignments: list[float] = []
    arm_trails = {"left": [], "right": []}
    armature_to_world = armature.matrix_world.to_3x3()
    world_forward = armature_to_world @ basis.forward
    world_forward.normalize()
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bind_edge_lengths: dict[str, list[float]] = {}
    bind_positions_by_mesh: dict[str, list[Vector]] = {}
    for mesh in meshes:
        evaluated = mesh.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        world = evaluated.matrix_world
        positions = [world @ vertex.co for vertex in evaluated_mesh.vertices]
        bind_positions_by_mesh[mesh.name] = positions
        bind_edge_lengths[mesh.name] = [
            (positions[edge.vertices[0]] - positions[edge.vertices[1]]).length
            for edge in evaluated_mesh.edges
        ]
        evaluated.to_mesh_clear()
    bind_floor_z = min(
        position.z
        for positions in bind_positions_by_mesh.values()
        for position in positions
    )
    surface_floor_heights: list[float] = []
    maximum_surface_edge_stretch = 1.0
    minimum_surface_edge_scale = 1.0
    maximum_surface_edge_growth = 0.0
    maximum_surface_edge_detail: dict[str, Any] | None = None

    for frame in range(end_frame + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        frame_floor_z = math.inf
        for name, chain in joint_specs.items():
            joint_samples[name].append(joint_angle_degrees(armature, *chain))

        hips = armature.pose.bones["Hips"].head
        for bone_name in limb_projections:
            relative = armature_to_world @ (
                armature.pose.bones[bone_name].head - hips
            )
            limb_projections[bone_name].append(
                relative.dot(world_forward) * basis.runtime_scale
            )

        posed_forward = (
            armature.pose.bones["headfront"].head
            - armature.pose.bones["Head"].head
        )
        posed_forward.z = 0
        if posed_forward.length < 1e-6:
            raise RuntimeError("Authored pose lost its horizontal facing direction")
        posed_forward.normalize()
        facing_alignments.append(posed_forward.dot(basis.forward))

        for side, arm_name, hand_name in (
            ("left", "LeftArm", "LeftHand"),
            ("right", "RightArm", "RightHand"),
        ):
            arm_trails[side].append(
                (
                    armature_to_world
                    @ (
                        armature.pose.bones[hand_name].head
                        - armature.pose.bones[arm_name].head
                    )
                ).dot(world_forward)
                * basis.runtime_scale
            )
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for mesh in meshes:
            evaluated = mesh.evaluated_get(depsgraph)
            evaluated_mesh = evaluated.to_mesh()
            world = evaluated.matrix_world
            positions = [world @ vertex.co for vertex in evaluated_mesh.vertices]
            frame_floor_z = min(
                frame_floor_z,
                min(position.z for position in positions),
            )
            for edge_index, (edge, bind_length) in enumerate(zip(
                evaluated_mesh.edges,
                bind_edge_lengths[mesh.name],
            )):
                if bind_length <= 1e-6:
                    continue
                current_length = (
                    positions[edge.vertices[0]]
                    - positions[edge.vertices[1]]
                ).length
                scale = current_length / bind_length
                maximum_surface_edge_stretch = max(
                    maximum_surface_edge_stretch,
                    scale,
                )
                minimum_surface_edge_scale = min(
                    minimum_surface_edge_scale,
                    scale,
                )
                growth = (
                    current_length - bind_length
                ) * basis.runtime_scale
                if growth > maximum_surface_edge_growth:
                    maximum_surface_edge_growth = growth
                    maximum_surface_edge_detail = {
                        "mesh": mesh.name,
                        "frame": frame,
                        "edge": edge_index,
                        "vertices": list(edge.vertices),
                        "bindLengthMeters": round(
                            bind_length * basis.runtime_scale,
                            6,
                        ),
                        "posedLengthMeters": round(
                            current_length * basis.runtime_scale,
                            6,
                        ),
                        "stretchRatio": round(scale, 6),
                        "bindPositions": [
                            [
                                round(component * basis.runtime_scale, 6)
                                for component in bind_positions_by_mesh[mesh.name][
                                    vertex_index
                                ]
                            ]
                            for vertex_index in edge.vertices
                        ],
                        "posedPositions": [
                            [
                                round(component * basis.runtime_scale, 6)
                                for component in positions[vertex_index]
                            ]
                            for vertex_index in edge.vertices
                        ],
                        "vertexWeights": {
                            str(vertex_index): {
                                mesh.vertex_groups[group.group].name: round(
                                    group.weight,
                                    6,
                                )
                                for group in mesh.data.vertices[
                                    vertex_index
                                ].groups
                            }
                            for vertex_index in edge.vertices
                        },
                    }
            evaluated.to_mesh_clear()
        surface_floor_heights.append(
            (frame_floor_z - bind_floor_z) * basis.runtime_scale
        )

    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    contact_sweeps = {
        bone_name: round(max(values) - min(values), 6)
        for bone_name, values in limb_projections.items()
    }
    measured = {
        "kneeLockMinimumDegrees": round(
            min(joint_samples["leftKnee"] + joint_samples["rightKnee"]),
            6,
        ),
        "elbowLockMinimumDegrees": round(
            min(joint_samples["leftElbow"] + joint_samples["rightElbow"]),
            6,
        ),
        "minimumFacingAlignment": round(min(facing_alignments), 6),
        "groundContact": {
            "maximumClearanceMeters": round(max(surface_floor_heights), 6),
            "maximumPenetrationMeters": round(
                max(0.0, -min(surface_floor_heights)),
                6,
            ),
        },
        "surfaceEdgeDeformation": {
            "maximumStretchRatio": round(maximum_surface_edge_stretch, 6),
            "minimumScaleRatio": round(minimum_surface_edge_scale, 6),
            "maximumGrowthMeters": round(maximum_surface_edge_growth, 6),
            "maximumGrowthEdge": maximum_surface_edge_detail,
        },
        "jointAngleExcursionDegrees": {
            name: round(max(values) - min(values), 6)
            for name, values in joint_samples.items()
        },
        "contactSweepMeters": contact_sweeps,
        "minimumContactSweepMeters": round(min(contact_sweeps.values()), 6),
        "armTrailMeters": {
            side: [
                round(min(values), 6),
                round(max(values), 6),
            ]
            for side, values in arm_trails.items()
        },
    }
    if slug == "banquet-saint":
        measured["lockedJointTargetDegrees"] = 180
    return measured


def aim_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def preview_material(
    name: str,
    color: tuple[float, float, float, float],
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = 0.9
    return material


def render_previews(
    slug: str,
    action_name: str,
    meshes: list[bpy.types.Object],
    end_frame: int,
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
    scene.world.color = (0.006, 0.008, 0.012)
    scene.view_settings.look = "AgX - Medium High Contrast"

    minimum, maximum = world_bounds(meshes)
    height = maximum.z - minimum.z
    center = (minimum + maximum) * 0.5
    floor_z = minimum.z - 0.008
    bpy.ops.mesh.primitive_plane_add(size=max(6.0, height * 4.0), location=(0, 0, floor_z))
    floor = bpy.context.object
    floor.name = "Demon_Locomotion_Preview_Floor"
    floor.data.materials.append(
        preview_material("Demon_Locomotion_Preview_Floor_Material", (0.015, 0.018, 0.024, 1))
    )

    light_specs = (
        ((-height * 1.3, -height * 1.4, maximum.z + height * 0.35), 950, (0.68, 0.8, 1.0)),
        ((height * 1.2, height * 0.7, center.z), 760, (1.0, 0.4, 0.22)),
        ((0, 0, maximum.z + height), 500, (0.85, 0.9, 1.0)),
    )
    lights: list[bpy.types.Object] = []
    for location, energy, color in light_specs:
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = height
        light.data.color = color
        aim_at(light, center)
        lights.append(light)

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.lens = 58
    scene.camera = camera
    distance = height * (2.5 if slug == "pale-maw" else 2.2)
    sample_frames = (
        ("a", round(end_frame * 0.25)),
        ("b", round(end_frame * 0.75)),
    )
    views = {
        "front": Vector((center.x, minimum.y - distance, center.z)),
        "right": Vector((maximum.x + distance, center.y, center.z)),
    }
    outputs: list[str] = []
    for sample_name, frame in sample_frames:
        scene.frame_set(frame)
        for view_name, location in views.items():
            camera.location = location
            aim_at(camera, center)
            output_path = preview_dir / (
                f"{slug}-{action_name}-{view_name}-{sample_name}.png"
            )
            scene.render.filepath = str(output_path)
            bpy.ops.render.render(write_still=True)
            outputs.append(str(output_path))

    for obj in [floor, camera, *lights]:
        obj.hide_render = True
    return outputs


def main() -> None:
    args = parse_args()
    input_path = args.input.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    report_path = output_path.with_suffix(".animation-report.json")
    protected = [output_path, report_path]
    if args.save_blend:
        protected.append(args.save_blend.expanduser().resolve())
    if any(path.exists() for path in protected) and not args.force:
        raise FileExistsError("Refusing to replace locomotion outputs without --force")
    if not input_path.is_file():
        raise FileNotFoundError(f"Input model not found: {input_path}")

    reset_scene()
    armature, meshes, basis = import_runtime_model(input_path, args.slug)
    action, end_frame, metrics = make_action(
        armature,
        basis,
        args.slug,
        args.name,
    )
    metrics.update(
        measure_action_metrics(
            args.slug,
            armature,
            meshes,
            basis,
            end_frame,
        )
    )
    hemisphere_flips = action_hemisphere_flips(action)
    if hemisphere_flips:
        raise RuntimeError(
            f"Authored action contains {hemisphere_flips} quaternion hemisphere flips"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_animation_glb(output_path, armature)
    preview_files: list[str] = []
    if args.preview_dir:
        preview_files = render_previews(
            args.slug,
            args.name,
            meshes,
            end_frame,
            args.preview_dir.expanduser().resolve(),
        )
    if args.save_blend:
        blend_path = args.save_blend.expanduser().resolve()
        blend_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "format": "animation-only-glb",
        "pipeline": "blender-authored-demon-locomotion",
        "source": portable_report_path(input_path),
        "file": output_path.name,
        "name": args.name,
        "stationary": True,
        "loopClosed": True,
        "compression": "none",
        "blenderVersion": bpy.app.version_string,
        "bones": len(BONE_NAMES),
        "rotationTracks": len(BONE_NAMES),
        "translationTracks": 0,
        "scaleTracks": 0,
        "rootMotion": False,
        "durationSeconds": round(end_frame / FPS, 6),
        "keyframesPerTrack": 5,
        "quaternionHemisphereFlips": hemisphere_flips,
        "baselineSourcePhase": basis.source_phase,
        "baselinePose": basis.baseline_pose,
        "bytes": output_path.stat().st_size,
        "previews": [portable_report_path(Path(path)) for path in preview_files],
        **metrics,
    }
    report_path.write_text(
        json.dumps(report, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
