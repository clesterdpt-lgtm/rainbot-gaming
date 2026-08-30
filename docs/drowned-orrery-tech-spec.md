# The Drowned Orrery — vertical-slice technical spec

This is an original Three.js action-adventure for the existing static Rainbot site. It uses the repo-local `assets/vendor/three/three-r128.min.js`; there is no build step and no external runtime asset dependency.

## Creative pillars

- Celestial botany: black basalt, pale rootwood, oxidized bronze, suspended water, wind-cut grass, refracted cyan/gold light.
- Hero: athletic sky-cartographer, asymmetrical ivory mantle, navy outfit, coral sash, collapsible crescent survey-spear, luminous bracer. Never a green tunic, pointed cap, shield, elf, fairy, or franchise silhouette.
- Threats: low split-antler Rootbound; tall ring-shouldered Orrery Wardens; the radial-plate Hollow Astronomer boss.
- The landmark is a huge circular Orrery pierced by a luminous root-tree, visible throughout the valley.

## Playable loop

The player crosses the valley, defeats Rootbound, and activates three star mechanisms with `E`. Each activation fills one Orrery ring and unlocks the boss gate. Combat uses a three-hit spear chain, dodge, guard/parry, target lock, and a charged prism pulse. The Hollow Astronomer is defeated in three stagger cycles. The restored Orrery transforms the lighting and ends on a completion screen.

## Coordinates and progression

- Start: `(0, ground, 68)` facing negative Z.
- Mechanisms: `(-24, 20)`, `(25, 2)`, `(0, -27)`.
- Gate threshold: around `z=-43`; closed until three mechanisms are active.
- Boss arena: center `(0, -66)`, radius about 20.
- World bounds: roughly `x ±55`, `z 84..-92`.

## Module contracts

### `world.js`

Expose `window.DrownedWorld.create(THREE, scene, renderer, { quality, reduceMotion })` returning:

- `root: THREE.Group`
- `mechanisms: Array<{ id, root, position: THREE.Vector3, active: boolean, ring, light, activate() }>`
- `gate: { root, open: boolean, setOpen(value) }`
- `arena: { center: THREE.Vector3, radius: number }`
- `orrery: THREE.Group`
- `colliders: Array<{ x, z, radius }>` for simple circular movement blockers
- `heightAt(x, z): number`
- `resolvePosition(previous, desired, radius): THREE.Vector3`
- `setRestored(value): void`
- `update(dt, elapsed, runtimeState): void`

The world owns sky, fog, terrain, stream/water, roots, cliffs, grass, stones, observatory structures, mechanisms, gate, Orrery landmark, motes, and lighting. Shadows and materials must be tuned, not defaults. Procedural textures may use canvas.

### `actors.js`

Expose `window.DrownedActors` with:

- `createHero(THREE): actor`
- `createRootbound(THREE, variant?): actor`
- `createWarden(THREE, variant?): actor`
- `createBoss(THREE): actor`
- `updateHero(actor, visualState, dt, elapsed): void`
- `updateEnemy(actor, visualState, dt, elapsed): void`
- `updateBoss(actor, visualState, dt, elapsed): void`

Every actor returns `{ root, body, shadow, hitParts, kind }`; hero additionally exposes useful named parts (`spear`, `bracer`, `sash`, limb pivots). Actor update state will include normalized movement speed, grounded, attack phase/combo, guarding, dodging, hurt, dead, facing, and boss-specific phase/charge/stagger. Geometry must have intentional silhouette, material separation, contact shadow, and no copied franchise motifs.

### `audio.js`

Expose `window.DrownedAudio` as a class with `start()`, `setVolume(value)`, `setIntensity(value)`, `setRestored(value)`, `play(name, options)`, `pause()`, and `resume()`. It must synthesize an original ambient score and feedback with Web Audio only.

### `game.js`

Own renderer, camera, input, player movement, camera collision, combat, enemies, boss, progression, HUD, pause, gamepad/touch mapping, VFX, checkpoints, QA query modes, performance readout, and lifecycle.

## QA query modes

- `?qa=vista`: menu hidden, controlled opening render with hero and Orrery.
- `?qa=combat`: game starts in a staged encounter.
- `?qa=boss`: game starts in boss arena with boss active.
- `?qa=finale`: restored world and completion composition.
- `?debug=1`: compact FPS/draw-call readout.

## Performance budget

Target 60 FPS desktop and 30 FPS coarse-pointer/mobile. Prefer instancing for grass/rocks, bounded particles, one shadowed directional light, and no network requests. High preset may use up to 1.6 device pixel ratio; medium up to 1.25.
