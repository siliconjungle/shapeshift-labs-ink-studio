# Fit geometry from turntable edits

Use silhouette edits to reshape a rigid part such as a handle, frame or strap.
Shape fitting takes an object-local signed-distance field or a saved voxel
proxy and produces one volume to use from every view. Keep the selected part
in its own field so the surrounding scene can keep its materials and geometry.

## Capture, paint and fit

A shape recipe exports a function that receives the same toolkit as a JavaScript
scene. Return an object with `distance(x, y, z)`, `bounds: { min, max }` and an
optional voxel size `cell`. Negative distances mark the inside. For a
`makeSculpt` part, call `S.ready()` and give the recipe `distance: S.sdf` before
baking. Leave room inside the bounds for the material you plan to add. The
[lantern handle recipe](../examples/turntable-shape-lantern.js) is a complete
example with a separate lantern body.

```sh
ink-studio shape capture examples/turntable-shape-lantern.js --out handle-views --yaw -55,0,55
ink-studio shape fit handle-views --out handle-proxy.json
```

Between the commands, edit `view-01.png`, `view-02.png` and `view-03.png`.
Paint solid pixels to add material and erase to transparent to cut it away.
Keep the dimensions, framing and `capture.json` alongside the PNGs. Alpha of
50% or more marks material. RGB is available for drawing guides in your editor.
Use two to twelve orthographic angles, with at least one pair separated by ten
degrees excluding opposite silhouettes. Capture uses degrees and accepts
`--pitch`, `--w`, `--h` and `--cell`. You can recapture a fitted JSON file to
start a new round of edits.

The fitter retains source cells supported by every edited silhouette.
It grows material from the surviving shape where a view requests new coverage
and the other views permit it. `--growth` limits expansion to a number of
connected voxel steps and defaults to four. Use zero for a carve-only fit.
The report counts added and cut voxels, and lists missing pixels in each view.
Missing pixels can identify conflicting views, isolated paint, or a growth
limit too small for the edit. Rotate and check angles between the edits before
using the proxy. Concealed details follow the source field where the views
leave them unconstrained. Fine structure is limited by the voxel grid.

## Use the fitted shape in a bake

Load the JSON, turn it into the existing voxel surface plan and draw it in place
of the selected part. The plan stays in the source's coordinate system.

```js
const part = require('./handle-proxy.json');
const proxy = KIT.turntableShape.proxy(part);
KIT.voxelSurface.draw(builder, proxy, {
  object: 'lantern-handle',
  material: 'cast-brass',
  color: '#e2aa6b'
});
```

The same plan works with `KIT.voxelSurface.toMesh` when you need triangles. Use
`KIT.turntableShape.fromSdf`, `.camera`, `.silhouette` and `.fit` to drive the
same workflow from JavaScript. The [lantern browser example](../examples/turntable-shape.html)
contains preset edits and a live silhouette brush. Run `npm run build` and serve
the repository to open the example.
