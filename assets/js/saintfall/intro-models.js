/* ============================================================
   SAINTFALL - AUTHORED INTRO VEHICLES

   The two lander states are approved Meshy assets. This module owns
   their one network load, their measured bounds and safe material
   cloning. pod.js swaps the sealed and opened lander while retaining
   the established heat, light, impact and collision contracts.

   Every load is optional. A missing GLB falls back to the procedural
   object that shipped before it, so an asset CDN failure can cost
   fidelity but never the operation.
   ============================================================ */

import { patchMaterial } from "saintfall/art.js";

const MODEL_SPECS = Object.freeze({
  closedPod: Object.freeze({
    file: "sanctum-drop-pod-closed.glb",
    sourceImage: "choirblade-drop-pod-meshy-source-v2.png",
  }),
  openPod: Object.freeze({
    file: "sanctum-drop-pod-open.glb",
    sourceImage: "choirblade-drop-pod-open-meshy-source-v1.png",
  }),
});

function modelUrl(file, build) {
  const url = new URL(`../../../assets/models/saintfall/intro/${file}`, import.meta.url);
  if (build) url.searchParams.set("v", build);
  return url;
}

/** Load the approved vehicle sources once, before collision and shader warm-up. */
export async function loadIntroVehicleModels(ctx, { includeFlight = true } = {}) {
  const { THREE } = ctx;
  const models = Object.create(null);
  const failures = Object.create(null);
  const keys = includeFlight ? ["closedPod", "openPod"] : ["openPod"];

  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    await Promise.all(keys.map(async (key) => {
      const spec = MODEL_SPECS[key];
      try {
        const gltf = await loader.loadAsync(modelUrl(spec.file, ctx.build).href);
        const source = gltf.scene;
        source.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(source);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        if (!(size.x > 1e-6 && size.y > 1e-6 && size.z > 1e-6)) {
          throw new Error("model has no measurable volume");
        }

        let meshes = 0;
        let triangles = 0;
        source.traverse((node) => {
          if (!node.isMesh) return;
          meshes += 1;
          const geometry = node.geometry;
          const count = geometry.index
            ? geometry.index.count : (geometry.attributes.position?.count || 0);
          triangles += count / 3;
        });
        models[key] = {
          key,
          ...spec,
          source,
          box,
          size,
          center,
          meshes,
          triangles: Math.round(triangles),
        };
      } catch (error) {
        failures[key] = error?.message || String(error);
        console.warn(`[saintfall] intro vehicle "${key}" failed to load; using procedural fallback`, error);
      }
    }));
  } catch (error) {
    failures.loader = error?.message || String(error);
    console.warn("[saintfall] intro vehicle loader unavailable; using procedural fallbacks", error);
  }

  return {
    models,
    failures,
    includeFlight: !!includeFlight,
    diagnostics() {
      const loaded = {};
      for (const [key, asset] of Object.entries(models)) {
        loaded[key] = {
          file: asset.file,
          sourceImage: asset.sourceImage,
          meshes: asset.meshes,
          triangles: asset.triangles,
          size: asset.size.toArray(),
        };
      }
      return { loaded, failures: { ...failures } };
    },
  };
}

/**
 * Clone one static source without sharing mutable PBR materials.
 * `collision` is explicit because a hidden fallback mesh must never
 * remain as an invisible wall beside its authored replacement.
 */
export function instantiateIntroVehicle(ctx, asset, {
  name = asset?.key || "intro-vehicle",
  atmosphere = false,
  envMapIntensity = 0.82,
  collision = "none",
  castShadow = true,
} = {}) {
  if (!asset?.source) return null;
  const root = asset.source.clone(true);
  root.name = name;
  const materialClones = new Map();
  const materials = [];
  const meshes = [];

  const cloneMaterial = (original) => {
    if (!original) return original;
    if (materialClones.has(original)) return materialClones.get(original);
    const material = original.clone();
    material.name = `${name}-${original.name || "material"}`;
    if ("envMapIntensity" in material) material.envMapIntensity = envMapIntensity;
    if (atmosphere) patchMaterial(material, ctx.atmos, { rim: 0.58, glitter: 0 });
    materialClones.set(original, material);
    materials.push(material);
    return material;
  };

  root.traverse((node) => {
    if (!node.isMesh) return;
    node.name = `${name}-mesh`;
    node.material = Array.isArray(node.material)
      ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
    node.castShadow = castShadow;
    node.receiveShadow = true;
    if (collision === "solid") node.userData.collisionSolid = true;
    else node.userData.noCollide = true;
    node.userData.authoredIntroVehicle = asset.key;
    meshes.push(node);
  });

  return { root, materials, meshes, asset };
}
