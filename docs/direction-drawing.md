# Direction-aware drawing

Direction drawing extracts editable paths from indexed geometry and projects them through the active camera. It works with perspective and orthographic cameras and the same drawing layer in the headless and WebGL renderers.

Add a `directionDrawing` layer to `look.composite.layers` or as the `layer` of a render graph `composite` pass.

```js
const layer = {
  directionDrawing: {
    sources: [
      { id: 'wing', mesh: wingMesh },
      { id: 'brace', mesh: braceMesh, emit: false }
    ],
    creaseAngle: 35,
    styles: {
      silhouette: { width: 1.5, color: '#b4f3e0' },
      crease: { width: 1, color: '#ffbd73' },
      occlusion: { width: 2, color: '#fc7f88' }
    },
    edits: {
      'wing/5-6': { width: 4, taper: [0, 1], color: '#fbeeaa' },
      'wing/7-8': { visible: false }
    }
  }
};
```

Sources use world-space indexed triangles (`pos` and `tri` arrays) or `points` and `faces` with convex planar faces. Reuse the same geometry sent to the scene or supply an indexed proxy for a baked splat, SDF, or sprite. Set `emit: false` for geometry that participates in visibility without emitting paths. Set `weld: true` to join exactly coincident positions within a source, such as duplicated vertices along an imported UV seam. Welded vertices use the lowest coincident index. The line layer treats source faces as opaque and two-sided. Supply the geometry that should take part in clipping, including a proxy for geometry rendered by another pass.

An open boundary or a transition between front- and back-facing faces produces a contour. The contour is a silhouette with empty space outside and an occlusion boundary when another face lies just across the edge in the image. `probe` sets that distance in output pixels (default `0.75`). Shared edges with a sufficient normal angle become creases (degrees, default `35`). Projected triangles trim the hidden spans along a path, with an adjustable `depthBias` in camera-depth units for nearly coincident surfaces (default `0.0001`).

Each path ID is `sourceId/smallerVertex-largerVertex`. IDs follow the same edges across camera movement, projection changes, and position edits with stable vertex indices and welds. A path can disappear and regain the same ID later, or change kind as the viewpoint or occluding geometry moves. Width is in output pixels. The two taper values multiply the width from the smaller to the larger vertex index, including when clipping interrupts the line. Per-ID edits take precedence over per-kind styles. Color can include alpha with `#rrggbbaa`, and `visible: false` skips painting the line while keeping its extracted spans available.

## Custom drawing

`KIT.directionDrawing.extract({ sources, camera, width, height, ...settings })` returns `{ paths, draw }`. You can also compile an unchanged geometry snapshot with `KIT.directionDrawing.prepare(sources)` and call `extract({ camera, width, height, ...settings })` on it as the view changes. Both use Ink's drawing camera format. For a camera from `CameraLens.frame`, multiply its `tangent` by `dist` when using orthographic projection.

Each path has its world-space endpoints, source ID, and its visible spans. Each span includes its kind, screen endpoints, style, and `range` in the original edge's 0–1 parameter. A painted span's `stroke` is the same editable screen-space primitive present in `draw`. For example, change the stroke's points and pass the resulting `draw` list into a drawing layer or `KIT.procedural.drawing2d.render`. Authored changes that should survive a fresh extraction belong in `edits`.

Generate the interactive [Fold Observatory demo](../examples/direction-drawing.cjs) with `node examples/direction-drawing.cjs fold-observatory.html`.
