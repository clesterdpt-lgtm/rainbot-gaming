# Bulk Storage Symbol Decals

These three 768×768 RGBA floor decals were created with OpenAI's built-in image generation on 2026-07-24, then locally chroma-keyed, edge-contracted, despilled, and downscaled for the browser runtime.

## Generation direction

- `bulk-storage-goat-star-v1-ai.png` — an original broken five-point ritual star with opposing horn crescents, concentric scored rings, invented runic notches, tally scratches, thorn marks, and distressed oxblood/soot/bone pigment.
- `bulk-storage-broken-halo-v1-ai.png` — an original shattered halo around an inverted triangular seal, seven uneven spokes, knotted occult geometry, invented marks, and distressed oxblood/soot/bone pigment.
- `bulk-storage-thorn-eye-v1-ai.png` — an original almond-shaped ritual eye with a vertical pupil, thorn vines, root-like tear channels, orbiting scratched rings, invented marks, and distressed oxblood/soot/bone pigment.

All prompts requested a flat `#00ff00` chroma background, no meaningful text, no real-world religious iconography, and no unrelated objects. The green background was removed with the built-in image-generation skill's `remove_chroma_key.py` helper using border-key detection, soft matte, despill, and one-pixel edge contraction. The checked-in PNGs are the runtime-ready outputs; the larger raw generation files are intentionally not shipped.

The mansion uses the existing procedural line symbols only if one of these textures fails to load.
