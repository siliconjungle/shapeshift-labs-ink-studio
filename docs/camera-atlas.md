# Multi-camera render atlases

Use a camera atlas to capture several views of a posed world at different
resolutions and cadences. Route the same feed to an on-screen overlay, a
render-graph layer, or a depth-tested world panel.

The [Relay Yard example](../examples/camera-atlas.js) captures three feeds and
shows the west camera both in the overlay and on a monitor inside the scene.

```sh
node cli/ink-studio.js render examples/camera-atlas.js --w 840 --h 510 --t 1.8 --out relay-yard.png
```

## Capture and schedule feeds

In WebGL, import `createCameraAtlas` from `webgl.mjs` and pass the canvas
that the main renderer uses. In Node, use `studio.createCameraAtlas(definition)`
with the same definition object.

```js
const definition = {
  width: 172, height: 60,
  maxViewsPerFrame: 1,
  maxPixelsPerFrame: 96 * 60,
  views: [
    { id: 'yard', rect: [0, 0, 96, 60], fps: 12,
      frame: { camera: { target: [0, 1, 0], dist: 8, pitch: .35 } } },
    { id: 'drone', rect: [100, 0, 72, 48], fps: 5,
      frame: ({ time }) => ({
        camera: { target: [2, 1, 0], yaw: time * .2, pitch: .1, dist: 4 }
      }) }
  ]
};

const atlas = createCameraAtlas(canvas, { toolkit, ...definition });
const result = atlas.capture(world, { time: 1.2 });
```

- `rect` is `[left, top, width, height]` in atlas pixels. Rectangles can differ
  in size and must fit without overlap. The atlas supports up to 64 views.
- `fps` caps the refresh rate of a view. Each call schedules due views in
  rotating order under both budgets. A deferred view keeps its last frame and
  gets the first opportunity at the next call. `capture` reports `updated`,
  `deferred`, `pixels` and `rewound`. Call once per host frame to apply the
  budgets per frame.
- Supply any shared native render options in `capture(world, { time, frame })`.
  The view's `frame` object or synchronous callback can override those options,
  including its orbit camera and camera shot. WebGL views can also use
  `camera.pose` or a snapshot from `captureCamera`.
- Pose or step the world before calling `capture`. Capture uses the provided
  world and fixes the render time to the supplied time.
- A feed defaults to the base scene. It can opt into composite layers, a render
  graph, inspection, or afterimages through its own `frame`. Use a separate
  afterimage history for each feed that enables it. Camera capture resets shared
  screen history between views. Use
  `spriteSurfaces: false` on a feed if it would otherwise see its own monitor.
- `lastCapture(id)` returns the last captured time. A rewind clears the atlas
  before filling it again. Call `reset()` on a scene cut, and `dispose()` when
  the atlas is no longer needed. Uncaptured pixels are transparent.

## Compose a view

```js
const inset = atlas.layer('drone', { rect: [24, 24, 144, 96], opacity: .9 });
renderer.render(world, { composite: { layers: [inset] } });

// This same layer can be positioned anywhere in a render graph.
const feedPass = { id: 'inset', type: 'composite', layer: inset };
```

`layer(id, options)` selects one feed. Omit the ID to show the whole atlas,
including spacing. Options are the normal raster layer controls, including
placement, filter, opacity and blend. The WebGL renderer samples these layers
directly from the shared atlas texture when the context matches. Linear
filtering clamps inside the selected tile. Node and cross-context consumers
use the raster path. `read(id?)` returns an independent, top-down
`{ w, h, rgba }` raster.

For a custom WebGL consumer, `atlas.texture` exposes the shared texture and
`atlas.tiles` lists each tile's dimensions and top-down
`uv: [left, top, right, bottom]`. Convert top-down Y to WebGL V when
sampling it in your own shader.

## Route a feed to the world

```js
const panels = SpriteSurface.make(256);
const screen = panels.reserve(72, 48);
panels.faceRegion([-1, 1, 0], [2, 0, 0], [0, 1.33, 0], screen);
const spriteSurfaces = panels.finish();
const syncDronePanel = atlas.bindSurface(spriteSurfaces, 'drone', screen);

// Use spriteSurfaces when finishing or rendering the world.
// After capture, synchronize the latest feed before drawing the main view.
syncDronePanel();
```

Reserve the region in the same builder as the other authored textures.
Use `meshRegion` to map the region onto an arbitrary textured mesh, or
reuse it on several faces. The binding updates the region only when the
feed changes and returns whether it copied pixels. On WebGL, this path reads
the updated feed and marks the sprite texture region dirty for its next
upload. Monitor geometry uses the normal world depth tests.
