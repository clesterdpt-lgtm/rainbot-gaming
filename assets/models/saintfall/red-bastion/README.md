# Bastion Penitent playable character

`red-bastion-player.glb` is the browser runtime asset for the selectable
heavy operative on Kenosis. The body is intentionally unarmed: its future
hammer and shield remain separate meshes and can attach through the shared
player equipment contract.

Runtime audit:

- 44,320 triangles
- 24 Meshy humanoid joints
- 4.39 MB embedded WebP GLB
- zero-duration Meshy placeholder clip removed; Saintfall owns locomotion/IK
- generated at 2.00 m, front-facing A-pose

Generation lineage:

- Source image-to-3D task: `01a0364d-aa66-7ab3-80d3-b8ae42ef2f4e`
- Rigging task: `01a03651-f8fa-7eed-b419-464bfa99d1af`
- Raw rig: `red-bastion-player-rigged.glb`
- Meshy reference motions: `red-bastion-player-walk.glb` and
  `red-bastion-player-run.glb`
- Runtime preparation: `scripts/saintfall-prepare-playable.mjs`

The source concept is
`assets/concepts/saintfall/playable-characters/heavy-b1-bastion-penitent-red-meshy-unarmed-v1.png`.
