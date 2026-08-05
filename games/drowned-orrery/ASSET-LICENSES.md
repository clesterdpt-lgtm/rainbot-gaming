# The Drowned Orrery — asset provenance

The shipped game uses no Nintendo, Zelda, Ocarina of Time, stock-game, or third-party franchise assets.

| Asset/system | Provenance |
| --- | --- |
| `assets/img/drowned-orrery/drowned-orrery-key-art.png` | Original image generated for this project with OpenAI's built-in ImageGen tool on 2026-08-04. The prompt required original characters, architecture, symbols, and typography and explicitly excluded copyrighted game designs. |
| World, terrain, water, vegetation, mechanisms, VFX, and character meshes | Original procedural Three.js geometry, materials, canvas textures, and shaders in this repository. |
| Music, ambience, and sound effects | Original real-time Web Audio synthesis in `js/audio.js`; no recorded music or sound files. |
| Typography | Local system font stacks only; no downloaded font files. |
| Three.js r128 | Repository-local dependency under `assets/vendor/three/`; see its adjacent `LICENSE`. |

## ImageGen production prompt

Use case: stylized-concept. Asset type: 16:9 game key art and social preview card. Create cinematic key art for an original third-person action-adventure titled “THE DROWNED ORRERY”: a storm-cleared observatory valley fused with colossal pale rootwood, black basalt ruins, wind-carved grass, a reflective stream, suspended water spheres, and a circular astronomical mechanism pierced by a luminous tree. Show an original athletic sky-cartographer from behind with a dark navy outfit, asymmetrical ivory mantle, coral sash, crescent survey-spear, and cyan bracer. Use premium stylized 3D adventure-game art, a wide low-angle S-curve composition, low solar-gold light and cool storm atmosphere, and the exact text “THE DROWNED ORRERY” and “A RAINBOT ORIGINAL.” Original designs only; no copyrighted characters, logos, symbols, franchise motifs, pointed cap, green tunic, shield, fairy, castle, or watermark.
