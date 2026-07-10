# Unhoused and Unhinged 3D Asset Attribution

This directory contains a deliberately selected subset of free third-party assets used by the game. The Kenney packs are released under Creative Commons Zero (CC0), so attribution is not required; it is recorded here for provenance and thanks.

## Kenney Blocky Characters 2.0

- Creator: Kenney (`https://kenney.nl`)
- Pack page: `https://kenney.nl/assets/blocky-characters`
- Source archive: `https://kenney.nl/media/pages/assets/blocky-characters/8369c0cf30-1749547469/kenney_blocky-characters_20.zip`
- Pack version: 2.0 (as identified by the archive's bundled `License.txt`)
- License: Creative Commons Zero 1.0 Universal (CC0)
- License text: `https://creativecommons.org/publicdomain/zero/1.0/`

Selected model files:

```text
characters/character-a.glb
characters/character-b.glb
characters/character-c.glb
characters/character-e.glb
characters/character-f.glb
characters/character-i.glb
characters/character-j.glb
characters/character-k.glb
characters/character-l.glb
characters/character-n.glb
characters/character-o.glb
characters/character-p.glb
characters/character-q.glb
```

Matching external textures:

```text
characters/Textures/texture-a.png
characters/Textures/texture-b.png
characters/Textures/texture-c.png
characters/Textures/texture-e.png
characters/Textures/texture-f.png
characters/Textures/texture-i.png
characters/Textures/texture-j.png
characters/Textures/texture-k.png
characters/Textures/texture-l.png
characters/Textures/texture-n.png
characters/Textures/texture-o.png
characters/Textures/texture-p.png
characters/Textures/texture-q.png
```

## Kenney Nature Kit 2.1

- Creator: Kenney (`https://kenney.nl`)
- Pack page: `https://kenney.nl/assets/nature-kit`
- Source archive: `https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip`
- Pack version: 2.1 (as identified by the archive's bundled `License.txt`)
- License: Creative Commons Zero 1.0 Universal (CC0)
- License text: `https://creativecommons.org/publicdomain/zero/1.0/`

Selected model files:

```text
trees/tree_default.glb
trees/tree_default_fall.glb
trees/tree_oak.glb
trees/tree_small.glb
trees/tree_tall.glb
trees/tree_thin.glb
```

## Three.js r128 loader utilities

- Project: Three.js
- Revision: r128
- Source tree: `https://github.com/mrdoob/three.js/tree/r128/examples/js`
- `GLTFLoader-r128.js`: `https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/js/loaders/GLTFLoader.js`
- `SkeletonUtils-r128.js`: `https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/js/utils/SkeletonUtils.js`
- License: MIT
- License text: `https://github.com/mrdoob/three.js/blob/r128/LICENSE`

The loader utilities are stored in `assets/vendor/three/` alongside the existing Three.js r128 browser runtime and its local MIT license copy.

`GLTFLoader-r128.js` has one compatibility-only adjustment: a
`KHR_texture_transform` entry using the default `texCoord: 0` no longer emits
the loader's custom-UV warning. Non-default UV sets still warn and loader
behavior is otherwise unchanged.
