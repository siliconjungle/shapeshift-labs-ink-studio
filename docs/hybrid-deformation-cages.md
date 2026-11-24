# Shared deformation cages

One coarse lattice poses an indexed scene mesh, its registered atlas paint,
surface-grown curves, and selected residual splats. A pose preview returns a
renderable scene and the evidence for deciding whether to use it.

## Bind a cage

Use the **rest** scene with its native mesh and packed splat rows. Supply cage
bounds in the same coordinates as the mesh and enclose the entire host.
The grid has two to eight handles per axis. A handle such as `2:1:0` identifies
its integer X, Y, Z grid coordinates from the lower corner of the cage.

```js
const cage = KIT.deform.hybridCage(world, {
  id: 'sail-cage',
  mesh: 'sail-canvas',
  bounds: { min: [-3, -1.5, -.3], max: [3, 1.5, .3] },
  size: [5, 3, 2],
  growth: [{ id: 'fringe', binding: fringe }],
  residuals: [
    { id: 'paint-fleck-1', surface: { triangle: 12, weights: [.5, .2, .3] } }
  ],
  gaps: [{
    id: 'slot',
    minWidth: .34,
    probes: [{
      from: { triangle: 22, weights: [0, .5, .5] },
      to: { triangle: 46, weights: [.5, .5, 0] }
    }]
  }]
});

const pose = {
  format: 'ink-studio/hybrid-cage-pose',
  version: 1,
  cage: 'sail-cage',
  id: 'lift-tip',
  moves: [{ handle: '4:2:1', offset: [0, .12, .08] }]
};
const { world: candidate, report } = cage.preview(pose);
if (report.ready) render(cage.apply(pose).world);
```

An offset is relative to the rest handle, in scene units. An omitted handle
has zero offset. Preview and apply both start from the bound rest scene.
Select the returned world for rendering or retain the source world to restore
the rest pose. Rebind after altering the source geometry, its packed splat
rows, or the growth and gap definitions.

- **Mesh and paint.** The posed mesh retains its authored triangle order,
  object and material IDs, UVs, atlas texels, and rest-space surface data.
  Its geometric and authored shading normals are evaluated on the new surface.
- **Roots and stitches.** Pass the handles obtained from
  [indexed UV growth](surface-grown-strands.md). Each root retains its source
  triangle and barycentric weights. Strand knots bend with the lattice, and
  stitches correct both ends to their actual positions on the posed mesh.
- **Residual splats.** Use author-provided IDs or uniquely resolved rest IDs.
  Each splat follows the lattice with a correction to its triangle anchor.
  Covariance, footprint frames, and available normals follow the local
  deformation. Pigment, material assignment, opacity, and captured appearance
  coefficients carry through. The source is a baked scene with static rows
  and a single indexed host per cage. Directional scan coefficients retain
  their original direction basis.

## Read the preview

`cage.preview` returns the candidate even when it is blocked. Its report
contains handle and attachment positions, sampled cage determinants, triangles
whose edge lengths exceed the supplied stretch or compression ratio, and
measurements at each protected gap probe.

Gap probes connect two barycentric witnesses across an opening. The report
includes their rest and posed distances and checks for an opaque triangle of
the host along the open segment. Place several probes where clearance matters.
Cell folds are sampled at the center and just inside each corner. The report
covers those samples and the authored probes.

The pose is blocked by a lost attachment, sampled cell fold, collapsed host
triangle, or a missing, obstructed, or undersized protected gap. Stretch and
compression serve as review flags. `cage.apply` validates the same evidence
and includes the report on its error when the pose is blocked.

## Review the signal sail at 1×

```sh
node cli/ink-studio.js hybrid-cage examples/hybrid-cage-sail.js \
  --plan examples/hybrid-cage-sail-poses.json --raw --out out/hybrid-cage
```

The CLI scene declares its cage binding as `world.hybridCage`. Pass one
versioned pose or an array of up to 12 poses. The command writes clean native
renders, diagnostics, and a JSON report. It also writes a comparison sheet
for up to six poses. The sail includes an approved bend, an undersized
opening, and a folded tip with failed splat attachments. Orange and purple mark stretching
and compression,
yellow marks root positions, cyan marks residual splats, and green and red
show passing and failing gap witnesses.
