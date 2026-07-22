// =============================================================
// entity-shadow.js - the hooded shadow shared by both game phases
//
// This model follows the supplied bedroom reference: an impossibly tall,
// almost featureless shroud with a rounded hood and two dim pinprick eyes.
// Its lack of readable anatomy is the point.
// =============================================================

(function () {
window.TW = window.TW || {};
const THREE = window.THREE;

function shadowClothTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const longFold = Math.sin(x * 0.105 + Math.sin(y * 0.018) * 1.8) * 11;
      const broadFold = Math.sin(x * 0.031 - y * 0.008) * 7;
      const cloth = Math.sin(x * 0.41 + y * 0.13) * 2;
      const grain = (Math.random() - 0.5) * 4;
      const v = Math.max(70, Math.min(135, 101 + longFold + broadFold + cloth + grain));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.9, 3.4);
  texture.anisotropy = 4;
  return texture;
}

function drapeGeometry() {
  const controls = [
    { y: 0.02, rx: 0.69, rz: 0.34, x: 0.015, hem: 0.04 },
    { y: 0.2,  rx: 0.7,  rz: 0.36, x: -0.01 },
    { y: 0.62, rx: 0.67, rz: 0.35, x: 0.01 },
    { y: 1.08, rx: 0.64, rz: 0.34, x: -0.008 },
    { y: 1.53, rx: 0.61, rz: 0.34, x: 0.008 },
    { y: 1.8,  rx: 0.6,  rz: 0.35, x: -0.006 },
    { y: 1.98, rx: 0.59, rz: 0.36, x: 0.0 },
    { y: 2.1,  rx: 0.56, rz: 0.34, x: 0.0 },
    { y: 2.18, rx: 0.47, rz: 0.32, x: 0.0 },
    { y: 2.24, rx: 0.37, rz: 0.3,  x: 0.0, z: 0.02 },
    { y: 2.34, rx: 0.36, rz: 0.31, x: 0.0, z: 0.05 },
    { y: 2.49, rx: 0.35, rz: 0.3,  x: 0.0, z: 0.06 },
    { y: 2.61, rx: 0.3,  rz: 0.26, x: 0.0, z: 0.045 },
    { y: 2.7,  rx: 0.2,  rz: 0.18, x: 0.0, z: 0.025 },
    { y: 2.74, rx: 0.06, rz: 0.06, x: 0.0, z: 0.015 },
  ];
  const profileCurve = new THREE.CatmullRomCurve3(
    controls.map((level) => new THREE.Vector3(level.rx, level.y, level.rz)),
    false, 'centripetal',
  );
  const offsetCurve = new THREE.CatmullRomCurve3(
    controls.map((level, i) => new THREE.Vector3(level.x || 0, i, level.z || 0)),
    false, 'centripetal',
  );
  const levels = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const profile = profileCurve.getPoint(t);
    const offset = offsetCurve.getPoint(t);
    levels.push({
      y: profile.y,
      rx: Math.max(0.04, profile.x),
      rz: Math.max(0.04, profile.z),
      x: offset.x,
      z: offset.z,
      hem: i === 0 ? 0.04 : 0,
    });
  }
  const radial = 32;
  const stride = radial + 1;
  const vertices = [];
  const uvs = [];
  const indices = [];

  levels.forEach((level, ring) => {
    const ringV = ring / (levels.length - 1);
    for (let i = 0; i <= radial; i++) {
      const u = i / radial;
      const a = u * Math.PI * 2;
      const fold = 1
        + Math.sin(a * 5 + ringV * 5.2) * 0.012
        + Math.sin(a * 9 - ringV * 3.4) * 0.006;
      const hem = level.hem
        ? Math.sin(a * 3 + 0.7) * level.hem + Math.sin(a * 7) * level.hem * 0.35
        : 0;
      const frontWeight = Math.max(0, Math.sin(a));
      vertices.push(
        level.x + Math.cos(a) * level.rx * fold,
        level.y + hem,
        (level.z || 0) + Math.sin(a) * level.rz * fold + frontWeight * Math.sin(a * 4 + ringV * 7) * 0.008,
      );
      uvs.push(u, ring / (levels.length - 1));
    }
  });

  for (let ring = 0; ring < levels.length - 1; ring++) {
    for (let i = 0; i < radial; i++) {
      const a = ring * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const bottomCenter = vertices.length / 3;
  vertices.push(0, 0.015, 0);
  uvs.push(0.5, 0.5);
  const topCenter = vertices.length / 3;
  vertices.push(0, levels[levels.length - 1].y, 0);
  uvs.push(0.5, 0.5);
  const top = (levels.length - 1) * stride;
  for (let i = 0; i < radial; i++) {
    indices.push(bottomCenter, i, i + 1);
    indices.push(topCenter, top + i + 1, top + i);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

TW.buildWraith = function (options = {}) {
  const huntPose = options.pose === 'hunt';
  const model = new THREE.Group();
  const clothTexture = shadowClothTexture();

  const shadowMaterial = new THREE.MeshStandardMaterial({
    color: 0x010203,
    roughness: 1,
    metalness: 0,
    emissive: 0x010101,
    emissiveIntensity: 0.08,
    bumpMap: clothTexture,
    bumpScale: 0.012,
  });
  const voidMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    fog: true,
    side: THREE.DoubleSide,
  });
  const hazeMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.2,
    side: THREE.BackSide,
    depthWrite: false,
    fog: true,
  });

  const body = new THREE.Group();
  model.add(body);

  const robeGeometry = drapeGeometry();
  const robe = new THREE.Mesh(robeGeometry, shadowMaterial);
  robe.castShadow = true;
  robe.receiveShadow = true;
  body.add(robe);

  const robeHaze = new THREE.Mesh(robeGeometry, hazeMaterial);
  robeHaze.scale.set(1.018, 1.004, 1.018);
  robeHaze.position.y = -0.003;
  body.add(robeHaze);

  const hoodGroup = new THREE.Group();
  hoodGroup.position.z = huntPose ? 0.025 : 0;
  body.add(hoodGroup);

  // The face is not a mask. It is a shallow absence inside the hood.
  const faceVoid = new THREE.Mesh(new THREE.CircleGeometry(1, 32), voidMaterial);
  faceVoid.position.set(0, 2.42, 0.368);
  faceVoid.scale.set(0.245, 0.285, 1);
  hoodGroup.add(faceVoid);

  const eyeMaterial = new THREE.MeshBasicMaterial({
    color: 0xa7b0b2,
    transparent: true,
    opacity: 0.42,
    fog: false,
    depthWrite: false,
  });
  const eyeGeometry = new THREE.SphereGeometry(0.009, 8, 8);
  const eyes = [];
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(side * 0.078, 2.455, 0.379);
    hoodGroup.add(eye);
    eyes.push(eye);
  });

  // Intentionally weak: just enough for the pinpricks to survive fog.
  const eyeGlow = new THREE.PointLight(0x9eabb0, 0.04, 1.2, 2);
  eyeGlow.position.set(0, 2.45, 0.395);
  hoodGroup.add(eyeGlow);

  model.traverse((object) => {
    if (!object.isMesh) return;
    const translucent = object.material && object.material.transparent;
    object.castShadow = !translucent;
    object.receiveShadow = !translucent;
  });

  const rig = {
    body,
    robeHaze,
    hoodGroup,
    eyes,
    eyeMaterial,
    huntPose,
  };
  return { model, eyeGlow, rig };
};

TW.animateWraith = function (rig, t, threat = 0.5) {
  if (!rig) return;

  // Almost still. The player should wonder whether it moved at all.
  const drift = Math.sin(t * 0.19);
  const breath = Math.sin(t * 0.31 + 0.8);
  if (rig.body) {
    rig.body.rotation.z = drift * 0.0025;
    rig.body.scale.set(1 + breath * 0.0015, 1, 1 + breath * 0.002);
  }
  if (rig.hoodGroup) {
    rig.hoodGroup.position.x = Math.sin(t * 0.17 + 1.4) * 0.0025;
    rig.hoodGroup.position.y = Math.sin(t * 0.13) * 0.0015;
    rig.hoodGroup.position.z = (rig.huntPose ? 0.025 : 0) + breath * 0.0015;
    rig.hoodGroup.rotation.y = Math.sin(t * 0.11 + 0.5) * 0.004;
    rig.hoodGroup.rotation.z = -drift * 0.0018;
  }
  if (rig.eyeMaterial) {
    rig.eyeMaterial.opacity = 0.4 + Math.min(1, threat) * 0.05 + Math.sin(t * 0.15) * 0.006;
  }
  if (rig.robeHaze && rig.robeHaze.material) {
    rig.robeHaze.material.opacity = 0.18 + Math.min(1, threat) * 0.025;
  }
};
})();
