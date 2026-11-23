# Local SDF-to-mesh updates

Use `KIT.procedural.brickMeshes` to turn a signed field into indexed
scene meshes and keep those meshes current as the field changes.
The field uses the [sparse brick snapshot API](procedural.md#sparse-bricks).
Union, subtraction, and material paint all go through the same update path.

```js
const P = KIT.procedural;
const slab = sculpt.box([0, 1, 0], [2, 1, .35], null, { hold: true });
const bricks = P.sparseBricks.create({ cell: .1, brickSize: 8, base: slab.sd });
const gate = P.brickMeshes.create({
  bricks,
  bounds: { min: [-2.3, -.3, -.65], max: [2.3, 2.3, .65] },
  objectId: 'gate',
  materials: [
    { id: 'sandstone', color: 0xad7860 },
    { id: 'cut-stone', color: 0xe3b789 }
  ]
});
const world = builder.finish({ cam, brickMeshes: [gate] });

const tool = sculpt.box([0, 1, 0], [.55, .8, .8], null, { hold: true });
const edited = gate.edit({
  operation: 'subtract',
  bounds: { min: [-.85, -.1, -.65], max: [.85, 2.1, .65] },
  sdf: tool.sd,
  material: 'cut-stone'
});
console.log(edited.work);
```

The authored domain rounds outward to the signed lattice. Leave padding
around solids you want closed. Each brick owns the faces incident to the
zero-crossing edges in its range. The mesher uses neighboring samples
for the fit at a shared boundary. Adjacent bricks agree on vertex
positions and publish each seam face once. The dual-contour fit retains
hard corners when the lattice resolves them. Openings and thin details
must span enough samples to register in the field.

The optional `materialAt(x,y,z)` returns a declared material ID for the
base surface. Sparse material paint takes precedence near the
zero crossing. Each face keeps a discrete material ID. The sampling
resolution sets the accuracy of the boundary between materials.

## Commit an edit

`gate.current()` returns an immutable revision. `gate.edit(brush)`
edits the live revision. `gate.update(snapshot)` accepts another snapshot
from the original sparse field and supports restoring an earlier state.
The brush bounds need to cover the full change, including any blend
distance. World simulation or editor code can pass the resulting
snapshot through the same API.

Geometry and material changes rebuild the bricks whose extraction
samples overlap the change and its halo. Untouched chunks keep their
mesh handles. Brick mesh publications are atomic, including when a
material or triangle budget fails. Medium-only changes retain the mesh
buffers. A revision has the following work fields.

| Field | Meaning |
| --- | --- |
| `rebuilt` | Brick IDs that ran extraction in this update |
| `changed` | Brick IDs whose mesh data changed, including empty bricks |
| `reused` | Brick IDs that kept their previous mesh data |
| `cells`, `samples` | Lattice cells and field calls used by the update |
| `triangles` | Triangle count for the published revision |

Node and WebGL 2 draw these meshes in the scene and expose their
object and material IDs. Mesh picking follows the current revision.
Use [surface-grown strands](surface-grown-strands.md#grow-from-an-editable-sdf)
to attach editable curves to the signed field through cuts and undo.
Set `brickMeshes: false` on a frame or use `--brick-meshes off`
to hide the editable fields.

## Choose direct tracing for a close-up

Headless rendering can trace the current signed field with
[`sdfAssist`](sdf-assist.md). Set an object, material, or world-space
box in the existing rules to use tracing locally while the rest of the
asset uses cached triangles. WebGL 2 uses the triangle meshes.

```js
ink.render(world, {
  w: 240, h: 144, px: 1, passes: ['opaque-surface'],
  sdfAssist: {
    rules: [{
      select: { object: 'gate' },
      bounds: { min: [-.9, -.02, -.55], max: [.9, 2, .55] }
    }]
  }
});
```

The [Verdigris sluice demo](../examples/brick-mesh-gate.js) cuts a
passage through a wall and chips the edge of one pier. Use `--t 0`
for the sealed wall, `--t 1.2` for the passage, and `--t 2.3` for
both edits.
