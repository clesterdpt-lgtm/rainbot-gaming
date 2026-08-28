# Saintfall local SFX

- `insects-nearby.wav` comes from `Dark Fantasy Studio- Insects 5.wav` and
  is looped only while a Bloom insect is inside its authored melee reach.
  Its playback gain is capped at `0.12` before the shared world bus.
- `lightgun-main.wav` comes from `Dark Fantasy Studio-lightgun-52.wav` and
  is used for the player's main autogun shot at a restrained `0.42` gain.

Enemy ranged fire continues to use Saintfall's existing procedural shot, so
the player and insect ranged attacks remain distinct.
