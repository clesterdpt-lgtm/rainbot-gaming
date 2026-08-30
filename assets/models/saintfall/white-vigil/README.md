# White Vigil playable character

`white-vigil-player.glb` is the browser runtime asset. It is the unarmed,
1.90 m humanoid loaded only by `summit-player.js`; weapons are intentionally
separate meshes and no weapon geometry is present in this GLB.

Runtime audit:

- 46,207 triangles
- 42,929 skinned vertices
- 24 Meshy humanoid joints
- 3.7 MB embedded WebP GLB
- zero-duration Meshy placeholder clip removed; Saintfall owns locomotion/IK

The accepted rig source came from the front turnaround as an explicit A-pose:

- Image-to-3D task: `01a02e57-20c2-728f-b0d7-36cedb8cffb1`
- Rig task: `01a02e59-b7ab-7333-87aa-c746b8de6b81`
- Raw rig: `white-vigil-player-rig-source-rigged.glb`
- Included Meshy motions: `white-vigil-player-rig-source-walk.glb` and
  `white-vigil-player-rig-source-run.glb`

The four-view reconstruction remains preserved as
`white-vigil-player-master.glb` because its model/texture are the strongest
turnaround match. Meshy's rig service returned a collapsed, meshless armature
for that task despite a `SUCCEEDED` status. Therefore the 23 KB files named
`white-vigil-player-rigged.glb`, `white-vigil-player-walk.glb`, and
`white-vigil-player-run.glb` are diagnostic failed outputs and must not be used
at runtime.
