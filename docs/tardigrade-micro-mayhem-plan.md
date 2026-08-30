# Tardigrade: Micro Mayhem

## Pitch

A bright low-poly 3D sandbox comedy in which a tiny but indestructible tardigrade creates escalating scientific chaos across a Petri Dish, Aquarium, Rat Stomach, Lava Cavern, and Space Station.

## Core gameplay loop

Explore each open research environment, follow the active guide target, eat or bonk microscopic props, push objects, use traversal toys, discover zones and landmarks, and complete the stage's research goals before accepting the next increasingly irresponsible experiment.

## Game rules

- The existing JavaScript state owns player movement, collision proxies, prop physics, creature routes, scoring, goals, store ownership, saves, and five-stage progression.
- The hero can scuttle, jump, dash-bonk, curl, use traversal toys, and equip earned skins plus head, face, back, trail, and research-camera cosmetics.
- Roaming creatures orbit authored routes, hover at type-specific heights, chatter near the player, and react when struck at speed without becoming gameplay-blocking enemies.
- Visual models and animation never add root motion or change the simple physics radii used by gameplay.

## Art direction

Bright microscopic comedy rather than realistic body horror: chunky faceted anatomy, clean warm/cool color blocking, slightly moist or translucent biological surfaces, expressive readable faces, and distinct silhouettes at desktop and phone play distance.

The hero is an unmistakable charming eight-legged tardigrade with a segmented armored body, short claws, dark bead eyes, and a readable oral tube. Rotifers, ciliates, waterbearlings, and later joke creatures should feel like residents of the same playful miniature world without collapsing into one silhouette.

Meshy may supply textured low-poly source geometry. Blender remains authoritative for mesh cleanup, non-humanoid armatures, animation, material and texture limits, orientation, scale, grounding, attachment sockets, and browser-safe uncompressed GLB export. Procedural geometry remains the runtime fallback until each model is loaded and whenever a model fails.

## Current authored-asset milestone

Milestone 55 covers the persistent hero, the recurring rotifer/ciliate/waterbearling trio, and the four Petri tutorial interactions: algae, bacteria, droplets, and pollen. Stage-specific joke creatures, traversal toys, bulk scatter, terrain, lighting, UI, and audio remain follow-up work after this core set is visually approved.

## Target platform and session

- Desktop and mobile web through the existing static GitHub Pages site.
- Five short sandbox stages inside the existing run/save structure.
- Keyboard, pointer, and touch controls remain unchanged by the authored-asset layer.

## Anti-goals for the asset pass

- No gameplay, balance, collision, goal, save, store-economy, camera, or level-order changes.
- No realistic gore, medical photorealism, humanoid redesign, runtime Meshy calls, new engine, or bundler migration.
- No blank spaces while assets load and no loss of playability when a GLB request fails.
