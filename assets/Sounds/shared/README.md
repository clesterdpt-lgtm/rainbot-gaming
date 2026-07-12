Rainbot shared SFX
==================

This folder contains a small curated subset of Kenney's free CC0 audio packs.

- `ui/` comes from Kenney Interface Sounds.
- `impact/` comes from Kenney Impact Sounds.
- `sci-fi/` comes from Kenney Sci-Fi Sounds.
- `ambience/` contains looping ambience beds (rain-heavy-loop.mp3 comes from
  "Rain (loopable)" by Ylmir on OpenGameArt, CC0).
- `licenses/` contains the original license files from each downloaded pack.

Sources:

- https://kenney.nl/assets/interface-sounds
- https://kenney.nl/assets/impact-sounds
- https://kenney.nl/assets/sci-fi-sounds
- https://opengameart.org/content/rain-loopable

The shared loader lives in `assets/js/main.js` as `window.RBSfx`. Sounds are lazy-loaded after player interaction, so adding this folder does not make every page download all audio upfront.
