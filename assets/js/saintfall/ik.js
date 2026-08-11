/* ============================================================
   SAINTFALL - inverse kinematics

   Extracted so the trooper's arms and the bestiary's legs solve
   through the same code. They had drifted into two copies once
   already, and the copy that was not being looked at was the one
   with the sign error.

   Everything here is allocation-free after module load: these run
   six times per creature per frame with dozens of creatures, and a
   solver that allocates a Vector3 per joint is a garbage collector
   with a limp.
   ============================================================ */

import { clamp } from "saintfall/core.js";

let V = null;
let Q = null;

/** Bind the scratch pool to a THREE namespace. Called once. */
export function initIk(THREE) {
  if (V) return;
  V = {
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(),
    head: new THREE.Vector3(), dir: new THREE.Vector3(), cur: new THREE.Vector3(),
    axis: new THREE.Vector3(), pole: new THREE.Vector3(), knee: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
  };
  Q = { a: new THREE.Quaternion(), b: new THREE.Quaternion(), c: new THREE.Quaternion() };
}

/**
 * Point a joint's local axis at a world-space target.
 *
 * `axis` is the direction the SEGMENT runs in the joint's own
 * space - +Y for a bone from a glTF armature, but -Y for an arm
 * authored hanging down. Passing the wrong one does not fail
 * loudly; it silently aims the limb backwards.
 */
export function aimJoint(joint, targetWorld, axis, weight = 1) {
  joint.updateWorldMatrix(true, false);
  V.head.setFromMatrixPosition(joint.matrixWorld);
  V.dir.copy(targetWorld).sub(V.head);
  if (V.dir.lengthSq() < 1e-10) return;
  V.dir.normalize();

  joint.getWorldQuaternion(Q.a);
  V.cur.copy(axis).applyQuaternion(Q.a).normalize();
  Q.b.setFromUnitVectors(V.cur, V.dir);
  Q.a.premultiply(Q.b);

  if (joint.parent) {
    joint.parent.getWorldQuaternion(Q.c);
    Q.c.invert();
    Q.a.premultiply(Q.c);
  }
  if (weight >= 1) joint.quaternion.copy(Q.a);
  else joint.quaternion.slerp(Q.a, weight);
  joint.updateWorldMatrix(false, false);
}

/**
 * Analytic two-joint IK, law of cosines, with a pole vector.
 *
 * The knee/elbow position is solved first and then each joint is
 * simply aimed - upper at the elbow, lower at the target. Aiming
 * the upper joint straight at the END EFFECTOR instead, which is
 * the tempting simplification, produces a straight line: the bend
 * is the entire silhouette of a limb, and losing it turns six
 * insect legs into six spikes and two arms into two poles.
 *
 * `poleDir` is a world-space direction the bend should point
 * toward - up-and-out for an insect knee, down-and-back for a
 * human elbow.
 */
export function solveTwoJoint(upper, lower, targetWorld, poleDir, len1, len2, axis) {
  upper.updateWorldMatrix(true, false);
  V.head.setFromMatrixPosition(upper.matrixWorld);

  V.dir.copy(targetWorld).sub(V.head);
  let d = V.dir.length();
  if (d < 1e-5) return;
  // Clamped inside the reachable annulus. Outside it, acos() is
  // NaN and every joint downstream becomes non-finite for the rest
  // of the session - a failure that survives long after the frame
  // that caused it.
  d = clamp(d, Math.abs(len1 - len2) + 1e-4, len1 + len2 - 1e-4);
  V.dir.normalize();

  /* ONLY THE PERPENDICULAR PART OF THE POLE MEANS ANYTHING.
   *
   * The elbow rides a circle about the shoulder-wrist line, and the
   * pole picks the point on it. Whatever component the pole has ALONG
   * that line is not a choice - it cancels in the cross product - so
   * project it out and keep what is left. Feeding the raw pole to
   * `cross(dir, pole)` instead, as this used to, hides how much of it
   * was real: the trigger arm's authored pole ran 8.9 degrees off the
   * arm, so 98.8% of it was cancelling and the elbow was being placed
   * by the 1.2% that survived, which is to say by rounding noise. It
   * span freely, and inverted whenever the residual changed sign.
   *
   * CALLERS MUST SUPPLY A POLE THAT IS NOT PARALLEL TO THE LIMB. That
   * is a property of the authored pose, and it cannot be rescued from
   * in here: any substitute axis this function invents is unrelated
   * to the pose and pops the elbow somewhere else instead. An earlier
   * attempt faded to an axis from the joint's own frame, which is
   * worse than it sounds - that frame IS last frame's solve, so the
   * elbow drove itself. `perp` is reported by the elbow sweep for
   * exactly this reason; keep it well clear of zero there.
   */
  V.pole.copy(poleDir).normalize();
  V.pole.addScaledVector(V.dir, -V.pole.dot(V.dir));
  // Degenerate: hold the pose rather than snap to an invented one.
  if (V.pole.lengthSq() < 1e-6) return;
  V.pole.normalize();
  V.axis.crossVectors(V.dir, V.pole);
  if (V.axis.lengthSq() < 1e-10) return;
  V.axis.normalize();

  const cosA = clamp((len1 * len1 + d * d - len2 * len2) / (2 * len1 * d), -1, 1);
  // POSITIVE: with the axis taken as cross(dir, pole), a positive
  // rotation swings the bend TOWARD the pole. Negated, the elbow
  // ends up on the wrong side of the arm.
  V.knee.copy(V.dir).applyAxisAngle(V.axis, Math.acos(cosA))
    .multiplyScalar(len1).add(V.head);

  aimJoint(upper, V.knee, axis);
  aimJoint(lower, targetWorld, axis);
}

/** World-space distance between two objects' origins. */
export function jointLength(a, b, out) {
  a.updateWorldMatrix(true, false);
  b.updateWorldMatrix(true, false);
  V.a.setFromMatrixPosition(a.matrixWorld);
  V.b.setFromMatrixPosition(b.matrixWorld);
  const d = V.a.distanceTo(V.b);
  if (out) out.copy(V.b);
  return d;
}
