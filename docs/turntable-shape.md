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

## Fit to approved perspective views

Use a versioned view plan to fit the same local volume against native grids
from production cameras. A view can reference an authored camera, or carry
the exact camera grid and axial depth from a prior capture.

```sh
ink-studio shape capture examples/turntable-shape-perspective.js \
  --views examples/turntable-shape-perspective-views.json --out handle-capture
ink-studio shape fit handle-capture --out handle-proxy.json --review handle-review
```

The [workshop lantern plan](../examples/turntable-shape-perspective-views.json)
uses three authored perspective cameras. Rebuild its edited masks, fitted
handle, and before/after renders together with the [demo script](../examples/turntable-shape-perspective-demo.js).

```sh
node examples/turntable-shape-perspective-demo.js out/workshop-lantern
```

A plan has `format: "ink-studio/perspective-shape-views"`, `version: 1`,
and two to twelve uniquely named `views`.

- For an authored camera, set `width`, `height`, and `camera` to Ink's usual
  lens and framing settings. With a production scene you can select a
  `cameraShot` and sample its `time` in seconds. Set `occluders` at the plan
  level to the scene file, relative to the plan. Build that scene with the
  fitted part hidden and the rest of the opaque set intact. The capture uses
  the production renderer's native camera matrix and opaque depth.
- For a saved camera, use `camera: {width,height,view,tangent,ortho,clipNear,clipFar}`
  with `ortho: false`. The view is the native column-major world-to-camera
  matrix and tangent is the vertical half-angle tangent. An optional
  relative `depth` path supplies top-down little-endian float32 axial scene
  depth with positive infinity for a pixel without an opaque hit.
- Supply a `placement` with the part's world-space `position` and row-major
  rigid 3×3 `matrix` when the shape is in a different coordinate frame.
  Set it once in the plan or override it per view. Rotation and translation
  preserve axial distances.

The capture directory records exact camera grids, visible silhouettes,
separate occlusion PNGs, and checksummed depth files. Edit only the numbered
silhouette PNGs as in the turntable workflow. The fitter traverses the
projected voxel intervals at pixel centers. Empty pixels carve the visible
part of each ray. Pixels outside the camera volume and voxels behind a
closer opaque surface receive no vote from that view. Other views can still
constrain them. An optional per-view `depthBias` in scene units reserves a
small tolerance in front of a blocker.

The report distinguishes foreground-obscured geometry and paint requests
from missing visible geometry. The optional review images mark occlusion
in blue, visible mismatches in orange or pink, and clear protected areas
in green.

### Keep an opening clear across shots

Put an entry such as `{"id":"handle-opening","rect":[75,59,12,7]}` in a
view's `openings` array. The rectangle uses top-left native pixel coordinates
and specifies the required clear width and height. Reuse the ID in each
approved camera to require all of those projected openings on one fitted
shape. The fitter treats the witness as a carve constraint where visible
and reports any opaque paint in the witness as a conflict. An occluded
or unobserved witness remains unverified. Read `report.openings` for the
individual measurements and the shared approval.

From JavaScript, `KIT.turntableShape.perspectiveCamera(grid, placement)`
registers an approved camera in the part's frame.
`KIT.turntableShape.observe(shape, camera, { occluderDepth, depthBias })`
returns the visible `mask`, an `occluded` mask for hidden-only geometry,
a `sampled` mask for rays that enter the fit volume, and `blocked` values
of 0, 1 or 2 for clear, partially blocked or fully blocked rays. Supply
`{id, camera, mask, occluderDepth, depthBias, openings}` per approved view
to `KIT.turntableShape.fit`. Pass `{review: true}` to retain native
per-pixel evidence alongside the fit. Voxel size and camera resolution limit
the detail available to the fit.

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
