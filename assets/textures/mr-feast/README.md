# Mr Feast mansion texture sources

These four 1024×1024 runtime JPEGs were created specifically for the clean-room mansion build with the built-in OpenAI image-generation workflow on 2026-07-09. They are original generated assets, not copied from the previous Mr Feast implementation or a third-party texture library.

| Runtime asset | Surface | Generation brief |
| --- | --- | --- |
| `generated/blue-damask-wallpaper-ai.jpg` | Main and second-floor walls | Seamless aged midnight-blue silk damask, Victorian botanical pattern, subtle grime and water staining, flat neutral light, no baked shadows. |
| `generated/smoked-oak-herringbone-ai.jpg` | Floors, ceiling wood, doors, and furniture | Seamless smoked-oak herringbone parquet, dark waxed seams, restrained wear, orthographic PBR-friendly albedo. |
| `generated/damp-limestone-ai.jpg` | Basement foundation | Seamless hand-laid gray limestone, irregular mortar, damp staining, mineral bloom, sparse moss, neutral diffuse capture. |
| `generated/antique-marble-ai.jpg` | Foyer, stair treads, fireplaces, and counters | Seamless black-and-cream antique marble, fine age cracks and restrained mineral variation, no baked reflections. |

The 1254px generated PNG masters remain in the local Codex generated-image archive. Runtime copies were resized to a power-of-two 1024px and JPEG-compressed at quality 84 for static-site delivery.

## Cryptic portrait collection

These ten original paintings were generated on 2026-07-11 with the built-in OpenAI image-generation workflow after the dedicated Gemini game-image credential probe returned `GEMINI_API_KEY=`. The first six translate the requested evil-philanthropist satire into fictional old-master scenes; the four host-free additions use only empty architecture, objects, gloves, moths, and stone animals. No real people, minors, real victims, copied real-world artwork, logos, or text appear. Portrait runtime copies are center-cropped 768×1152 JPEGs at quality 84; the ballroom diptych is a 1024×1024 JPEG whose left and right UV halves occupy separate frames.

| Runtime asset | In-world title and purpose | Final generation brief |
| --- | --- | --- |
| `generated/portraits/portrait-patron-empty-plates-v1-ai.jpg` | *The Patron of Empty Plates* — drawing room hero portrait | Fictional smiling adult game-show philanthropist before empty silver plates, false ring-light halo, contradictory shadow, mouse escaping with a coin; late-Baroque oil, charcoal/oxblood/tarnished-gold palette, aged varnish and craquelure. |
| `generated/portraits/portrait-generosity-engine-v1-ai.jpg` | *The Generosity Engine* — main and upper galleries | Mahogany boardroom machine converts applause into coins and blank tickets while adult attendants crank backward; impossible brass loop and clockwork pigeon; surreal institutional old-master oil. |
| `generated/portraits/portrait-infinite-giveaway-diptych-v1-ai.jpg` | *The Infinite Giveaway* — split ballroom diptych | Adult contestants circle endlessly with gilded prize boxes, false exit doors, eye-like chandeliers, fictional host on a dais, peacock with stopwatch; square composition designed for a centered two-panel split. |
| `generated/portraits/portrait-feast-of-merit-v1-ai.jpg` | *The Feast of Merit* — dining room hero painting | Gloomy adult banquet around a padlocked mansion cake, host offers an invisible slice, unowned smile reflected in silver, clockwork crab beneath the platter; Dutch banquet surrealism. |
| `generated/portraits/portrait-garden-good-deeds-v1-ai.jpg` | *The Garden of Good Deeds* — main gallery | Storm-dark hedge maze shaped like an open hand, adult figures push blank ceremonial checks toward a central lamp, exits curl inward, groundskeeper trims a thumbs-down; aerial Flemish surreal landscape. |
| `generated/portraits/portrait-audit-of-souls-v1-ai.jpg` | *The Audit of Souls* — main and upper galleries | Faceless adult accountants weigh canned food, applause hands, coins, and blank tokens; empty executive chair with red button and absent smiling host shadow; severe symmetrical institutional oil painting. |
| `generated/portraits/portrait-banquet-forgot-guests-v1-ai.jpg` | *The Banquet That Forgot Its Guests* — upper gallery | Empty Baroque banquet, cloches opening onto black mirrors, candles leaning toward an invisible diner, one buttered doorknob, and a chair politely affixed upside down to the ceiling. |
| `generated/portraits/portrait-last-applause-v1-ai.jpg` | *The Last Applause* — main and upper galleries | Empty Victorian theater, crimson curtain sewn shut, bodiless opera gloves applauding, eye-like proscenium ornament, and a solemn moth conducting with a matchstick. |
| `generated/portraits/portrait-orchard-porcelain-teeth-v1-ai.jpg` | *The Orchard of Porcelain Teeth* — upper gallery | Moonlit winter trees bearing porcelain teeth and brass keys, ladders ending in air, and three stone rabbits counting the fallen ceramic fruit on an abacus. |
| `generated/portraits/portrait-house-dreams-back-v1-ai.jpg` | *The House That Dreams Back* — upper gallery | Recursive impossible corridor, upward rain from closed umbrellas, watchful carpet motifs, and a brass snail towing an unlit chandelier through the dreaming house. |

The game loads these through a clamp-wrapped sRGB portrait manifest. If a portrait file is unavailable, its frame falls back to the original procedural shadow-ancestor silhouette instead of delaying or breaking the mansion.
