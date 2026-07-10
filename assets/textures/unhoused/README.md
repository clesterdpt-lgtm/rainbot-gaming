# Unhoused and Unhinged generated texture set

The current runtime uses six 1024x1024 JPEGs created for the top-down Three.js city board with the built-in OpenAI image-generation workflow on 2026-07-09. They are original generated assets and keep flat-color material fallbacks if an image cannot load.

| Runtime asset | Surface | Generation brief |
| --- | --- | --- |
| `generated/asphalt-ai.jpg` | Vertical and horizontal road grids | Seamless blue-charcoal cartoon asphalt with broad cracks, patched tar, and restrained aggregate, rendered as neutral top-down albedo. |
| `generated/concrete-ai.jpg` | City ground and sidewalk strips | Seamless cool-gray concrete slabs with hairline cracks, repairs, and sparse pastel street wear, kept low contrast for gameplay readability. |
| `generated/rooftop-rough-v2-ai.jpg` | Rough flat-roof tier | Calm charcoal tar membrane with a handful of broad violet/teal repairs and restrained paint scuffs. |
| `generated/rooftop-maintained-v2-ai.jpg` | Maintained flat-roof tier | Warm light-gray TPO membrane with broad welded seams, neat repairs, subtle drains, and sparse utility marks. |
| `generated/rooftop-upscale-v2-ai.jpg` | Clean/upscale flat-roof tier | Premium off-white standing-seam membrane with pale maintenance paths and limited teal roof strips. |
| `generated/pitched-shingles-v2-ai.jpg` | Pitched residential roofs | Neutral chunky asphalt shingles shared across three quality tints on slope-correct triangular UVs. |

The 1254px PNG masters remain in the local Codex generated-image archive. V2 runtime copies were resized to power-of-two 1024px and JPEG-compressed at quality 86 for static-site delivery. The three earlier flat-roof JPEGs remain beside them as unreferenced V1 history.

The runtime loads these files asynchronously from `assets/js/unhoused-and-unhinged-topdown.js`, shares one mipmapped GPU texture per generated image, and retains the original procedural colors as a failure-safe fallback. Warm flat roofs use the rough texture, gold roofs use the maintained texture, and cool roofs use the upscale texture. Flat-roof art is mapped only to upward faces; fascia remains solid. World-scaled UVs are transformed before seeded quarter-turn rotation, and pitched roofs use custom per-face UVs, so rectangular and sloped roofs keep consistent texel density.
