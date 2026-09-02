/* ============================================================
   SAINTFALL - Kenosis authored gold inlays

   The Meshy bodies and shield each arrive as one texture-atlased
   material. Their visor slots and reliquaries therefore cannot be
   made emissive through a material toggle without making the whole
   atlas self-light. These tiny meshes sit on the measured surfaces
   instead: one hard-edged lamp shape, one warm emissive hierarchy,
   and no change to the collision or skinned source assets.
   ============================================================ */

import { patchMaterial } from "saintfall/art.js";

export function unitsPerWorldMetre(THREE, node) {
  node.updateWorldMatrix(true, false);
  const scale = node.getWorldScale(new THREE.Vector3());
  const uniform = Math.max(1e-6,
    (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3);
  return 1 / uniform;
}

export function makeGoldLampMaterial(THREE, atmos, {
  name,
  intensity = 4.2,
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    name: name || "kenosis-gold-lamp",
    /* Almost-black diffuse keeps the inlay reading as a lit aperture,
       not as a yellow sticker pasted over the texture beneath it. */
    color: 0x3b2608,
    emissive: 0xffc23c,
    emissiveIntensity: intensity,
    roughness: 0.30,
    metalness: 0,
    /* The Bastion shield can yaw far enough during the held stance that
       its inset aperture is viewed from the reverse side. Keep the lamp
       readable through that arc; the pointed outline and depth offset
       still keep it contained by the metal frame. */
    side: THREE.DoubleSide,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  /* The centre vertex is the hot core and the perimeter stays below
     it. Multiplying emission by that radial vertex channel preserves
     gold at the edge while bloom is allowed to lift only the centre. */
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.r;");
  };
  patchMaterial(material, atmos, { rim: 0, glitter: 0 });
  material.userData.sfGoldLamp = true;
  return material;
}

/**
 * Build several pointed lamp inlays into one draw call.
 *
 * Positions and directions are parent-local. Width, height and
 * standoff remain world metres so the same helper works on centimetre
 * bones and on raw prop meshes with an arbitrary runtime scale.
 */
export function makeGoldLampMesh(THREE, {
  name,
  material,
  targets,
  unitsPerMetre = 1,
  standoffM = 0.0025,
} = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colours = [];
  const indices = [];
  const segments = 8;
  const normal = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const point = new THREE.Vector3();

  for (const target of targets || []) {
    normal.fromArray(target.normal).normalize();
    up.fromArray(target.up || [0, 1, 0]);
    up.addScaledVector(normal, -up.dot(normal));
    if (up.lengthSq() < 1e-8) up.set(0, 0, 1)
      .addScaledVector(normal, -normal.z);
    up.normalize();
    right.crossVectors(up, normal).normalize();
    centre.fromArray(target.position)
      .addScaledVector(normal, (target.standoffM ?? standoffM) * unitsPerMetre);

    const base = positions.length / 3;
    positions.push(centre.x, centre.y, centre.z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(0.5, 0.5);
    const centreBrightness = target.centreBrightness ?? 1;
    const perimeterBrightness = target.perimeterBrightness ?? 0.34;
    colours.push(centreBrightness, centreBrightness, centreBrightness);

    const halfW = target.widthM * unitsPerMetre * 0.5;
    const halfH = target.heightM * unitsPerMetre * 0.5;
    /* Most lamps use the compact octagon below. Props with a raised
       frame can provide their measured aperture silhouette instead;
       this keeps a lamp inside the metal mask at oblique camera angles
       rather than relying on a broad card hidden by depth precision. */
    const outline = Array.isArray(target.outline) && target.outline.length >= 3
      ? target.outline
      : Array.from({ length: segments }, (_, i) => {
        const angle = Math.PI / 2 + (i / segments) * Math.PI * 2;
        return [Math.cos(angle), Math.sin(angle)];
      });
    for (const [x, y] of outline) {
      point.copy(centre).addScaledVector(right, x * halfW)
        .addScaledVector(up, y * halfH);
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(0.5 + x * 0.5, 0.5 + y * 0.5);
      colours.push(perimeterBrightness, perimeterBrightness, perimeterBrightness);
    }
    for (let i = 0; i < outline.length; i += 1) {
      const next = (i + 1) % outline.length;
      indices.push(base, base + i + 1, base + next + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name || "kenosis-gold-inlay";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  mesh.userData.sfGoldTargets = (targets || []).map((target) => target.name || "lamp");
  return mesh;
}
