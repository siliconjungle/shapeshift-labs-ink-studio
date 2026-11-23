# Hybrid depth in water, portals, and fog

Ink renders each camera with its own depth buffer. Native meshes, reconstructed sprites, and opaque splats share the camera's depth test. Depth-only mesh proxies reject deeper splats and remain invisible. The WebGL renderer repeats those tests with the reflected camera or the mapped portal camera. Reflection and destination clipping planes bound the region each camera can see.

WebGL composites a portal in three pieces. The opaque coverage pass holds out the source geometry in front of the opening. A premultiplied foreground pass retains soft splats and glass over the opening. The destination supplies the view behind them. Source fog is evaluated up to the aperture, and destination fog starts at the arrival clip plane. A portal can also appear in a live planar water reflection. Reflected views use the existing portal nesting limit and omit additional water captures.

For coverage-aware glass, indexed meshes and reconstructed sprites contribute their opaque color to the rear layer when behind the pane. In front of the pane they block its contribution. Refraction within the destination and reflected scenes uses those layers. Source-side transparency over a portal uses the foreground alpha composite.

## Matched captures

```sh
node scripts/build.js node
node cli/ink-studio.js hybrid-depth-review --hardware --out out/hybrid-depth-review
```

This command uses [Mirror Station](../examples/hybrid-depth-review.js). It renders the same view with a single feature disabled for each comparison. The folder contains color PNGs, RGB difference images, 16-bit depth previews, little-endian Float32 depth files, and a `review.json` report. The report counts RGB changes above two byte levels and depth pixels that became occupied, cleared, or moved by more than 0.001 world units. The WebGL run includes the camera, water reflection, portal destination, and reflected portal destination. The headless run covers the camera and water reflection.

Node and the WebGL renderer also accept a `hybridDepthFrame` callback:

```js
const views = [];
renderer.render(scene, {
  width: 320,
  height: 180,
  portal,
  hybridDepthFrame: view => views.push(view)
});
```

Each view contains `view` (`camera`, `reflection`, or `portal`), optional `reflection` plane ID, `portalDepth`, `width`, `height`, and a top-down `Float32Array` named `depth`. A sample is axial distance in world units or `Infinity` when no opaque geometry owns the pixel. Reflections use their actual capture resolution. WebGL samples use the existing packed render-graph depth range. The callback is synchronous and requires a GPU readback in WebGL, so use it for review captures.
