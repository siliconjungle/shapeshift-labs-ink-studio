# Signed-distance function graphs

Set a reusable function’s result type to `field`. Its `result` port carries the distance function, a finite XYZ domain, and any authored surface attributes. Wire the same port to `sdf.render`, `sdf.slices`, or a volumetric shape library for `image.shapeSplatter`. Other field consumers, including mesh and voxel conversion, can use the geometry.

| Node | Use |
| --- | --- |
| `sdf.primitive` | Choose a sphere, rounded box, torus, capsule, or cylinder. Wire the exposed dimensions, center, and Euler rotation in radians. Capsule, cylinder, and torus use local Y as the up axis. |
| `sdf.transform` | Translate, rotate, or scale a field and keep its attributes attached. Nonuniform scale uses a conservative signed distance for tracing. |
| `sdf.repeat` | Place up to 256 copies on a finite, centered XYZ grid. An optional prefix assigns each copy an object name that ends with its zero-based X, Y, and Z indices. |
| `sdf.symmetry` | Union a field with its reflection across an X, Y, or Z plane. |
| `sdf.boolean` | Union, intersect, or subtract two fields. The earliest input wins exact ties. Cut surfaces retain the body’s object ID and take any material or color authored on the cutter. |
| `sdf.bound` | Supply a different domain for sampling and baking. Intersect with a solid box when the operation needs to cut the geometry itself. |
| `sdf.bounds` | Read the domain’s size from `value`, or wire `min`, `max`, and `center` separately. |
| `sdf.attributes` | Set object and material names or an opaque sRGB surface color. Blank names and omitted color inherit. |
| `sdf.sample` | Read the signed distance, object name, material name, and color at a position and the current graph time. `hasColor` identifies authored color. |

Render passes carry object and material IDs alongside the shaded pixels. Scatter provides aligned `objectId`, `materialId`, and `pigment` images alongside its stamp IDs and height maps. Slice baking provides an RGB-plus-alpha stack and matching stacks of integer object and material IDs. Resolve numeric IDs against the name tables in each pass or layout. Scatter pigment is straight sRGB with coverage in alpha. Untagged scatter and slice IDs use zero.

A material saves the nodes, links, and controls of the function. Evaluating that graph reconstructs the runtime field. Geometry construction and point queries can run in a declared function. Render, scatter, and bake operations run in the calling material graph.

## Demo

```sh
node examples/sdf-functions/demo.cjs
```

Open the generated `index.html` to orbit the Moonlock, change the crescent cut and fastener count, and inspect the same field as a slice stack and a stamped texture. The editable material and sample PNG exports are written beside it.
