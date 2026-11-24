# Artist-authored cards and impostors

Place a sprite atlas in a scene as a camera-facing card or as a directional impostor. One atlas can supply color, depth, normals, and emission. With directional placement, Ink chooses the closest authored heading and elevation. A card uses the first view for its frame and faces the camera throughout a turn.

```js
const atlas = studio.readSpriteAtlas('drone/atlas.json');
const sprite = K.sprite.placeAtlas({
  atlas,
  at: [0, 1.2, 0],
  mode: 'impostor',
  yaw: 0,
  scale: 1
});
return B.finish({ ...sceneSettings, spriteAtlases: [sprite] });
```

Use `K.sprite.atlas({ metadata, images })` with decoded RGBA byte buffers. `images.color` is required. `depth`, `normal`, and `emission` are optional and use the same dimensions and view rectangles. `at` and `frame` can be functions of scene time in JavaScript. Each placement can disable depth, relighting, or emission with `depth: false`, `lighting: false`, or `emission: false`.

Use [sprite-based object reconstruction](sprite-reconstruction.md) when one atlas should stand in for named native geometry at a distance in the headless or WebGL renderer.

Group placements into [sprite scanline budgets](sprite-scanline-budgets.md#an-atlas-placement-layer) to cap them per art row and inspect which rows were dropped.

## Map and view conventions

| Channel | Encoding |
| --- | --- |
| Color | Straight RGBA. Color alpha defines the silhouette. |
| Depth | RGB24 stores the normalized value `(R × 65536 + G × 256 + B) / 16777215`. Set `depthFormat: 'gray'` to use the red channel for grayscale depth. `depthRange` maps the image values from near to far in scene units, and `depthOrigin` gives the value at the pivot plane. Depth increases away from the viewer. Alpha zero uses the pivot plane. |
| Normal | Signed XYZ in RGB, mapped from [-1, 1] to [0, 255]. Alpha zero marks a missing normal. `normalSpace: 'view'` is the default for an authored atlas, with X right, Y up, and +Z toward the viewer. `'asset'` uses object axes. Normals respond to live sun in the headless renderer. |
| Emission | `emissionMode: 'add'` adds emission RGB weighted by the map alpha. `'baked'` describes an atlas with emission already included in its color, using premultiplied emission RGB. Emission is also available as an art pass. |

The manifest has the sheet `width`, `height`, a `files` object with relative PNG paths, and `frames` with view rectangles. Each entry can specify `frame`, `yaw`, `pitch`, `pivot`, `unitsPerPixel`, and `depthOrigin`. Angles use radians. Rectangles and pixel pivots use top-down atlas coordinates. Put shared `unitsPerPixel` and `depthOrigin` at the top level when they apply to every view.

```json
{
  "width": 192,
  "height": 64,
  "unitsPerPixel": 0.035,
  "depthRange": [-0.7, 0.7],
  "files": { "color": "color.png", "depth": "depth.png", "normal": "normal.png", "emission": "emission.png" },
  "frames": [
    { "yaw": 0, "pitch": 0.14, "rect": { "x": 0, "y": 0, "width": 64, "height": 64 } },
    { "yaw": 1.57, "pitch": 0.14, "rect": { "x": 64, "y": 0, "width": 64, "height": 64 } },
    { "yaw": 1.57, "pitch": 0.84, "rect": { "x": 128, "y": 0, "width": 64, "height": 64 } }
  ]
}
```

Ink's [atlas exporter](art-passes.md#directional-sprite-atlas) writes registered scale and depth for each view. Use `--pitches` to bake additional elevation rows. Older manifests can specify `unitsPerPixel`, `depthOrigin`, and `pitch` when the original export camera is known.

```sh
ink-studio atlas my-prop.js --directions 12 --pitches 0.14,0.48,0.84 --maps depth,normal,emission --out drone
ink-studio render my-scene.js --sprite-atlas drone/atlas.json --sprite-at 0,1.2,0 --live-sun on --raw --out scene.png
ink-studio render examples/relightable-impostor.js --t 3 --sprite-atlas-mode card --raw --out card.png
ink-studio render examples/relightable-impostor.js --t 3 --sprite-atlas-mode impostor --raw --out impostor.png
```

For animated sprites, `--maps normal` writes `normal.png` alongside the
color frames with matching tile rectangles, pivots, and timings. Use
`--normal-space view` for a screen-facing game sprite. Its normal axes are X
right, Y up, and +Z toward the viewer of each baked tile. The default is
`--normal-space asset`, which keeps the object's axes for world lighting.
Build the relightable Signal Courier example with
`node examples/baked-sprite-normals.cjs courier-normals.html`.

### Choose view angles by visible error

Add `--adaptive-views` when the asset needs more headings around a fast-changing detail. The baker renders probe views at the export's art resolution. For each probe it picks the tile the impostor player would use and measures the silhouette, closed holes and narrow gaps, and protected detail. It starts with an even set on each requested elevation and adds views that most reduce visible error, including views across the orbit seam. The same registered angles apply to every exported pose.

```sh
ink-studio atlas examples/adaptive-impostors/aperture-relay.js \
  --adaptive-views --directions 10 --min-directions 4 --view-probes 80 --view-error .03 \
  --view-protect '[{"material":"protected-glint"}]' --w 100 --h 96 --raw \
  --maps depth,normal,emission,silhouette --view-review --out aperture-relay
```

- `--directions` bounds the number of saved headings per elevation. `--min-directions` sets the evenly spaced anchors. A smooth orbit can stop at that minimum.
- `--view-probes` sets the assessment grid per elevation. The baker rounds up to include every anchor exactly. `--view-error` is a threshold on the weighted error. The report records residual error when the budget or sampling grid limits the result.
- Highlight scoring includes renderer-protected details, visible emission, and matching selectors passed to `--view-protect`. Use an object, material, or tag selector to give a small detail a say in the allocation.
- Exported animation needs a seekable source. `--view-pose-samples` sets how many evenly selected export poses to assess, up to eight. The worst assessed pose drives each tile comparison. Captures use a fixed orthographic camera registration and independent frame histories.
- All elevations participate in nearest-view selection and error scoring. Adaptive assessment has a combined limit of eight million probe pixels and 192 output views per pose.

Use `spriteAtlas(world, { adaptive: { minDirections, probes, tolerance, poseSamples, protect }, ...options })` in Node. The atlas uses the ordinary color and auxiliary maps, with the selected yaw and pitch on each tile. `atlas.json` also records the assessment poses, component weights, selected headings and insertion errors under `adaptiveViews`.

With one pose and one elevation, `--view-review` writes an offline orbit comparison under `review/`. It shows the direct render, an evenly spaced bake with the same number of views, and the selected bake on angles between the assessment probes. The overlays identify silhouette, gap and protected-detail disagreements. The directory includes the comparison clips, uniform atlas and JSON measurements.

### Bake a set of moves from one rig

Pass `--clips plan.json` to bake named moves into a single atlas. Each move
uses the same orthographic framing and world pivot across its poses and views.
Change the rig or the timing plan and run the same export again.

```sh
ink-studio atlas examples/pose-blocking.js --clips examples/signal-courier-sprite-clips.json \
  --directions 4 --w 60 --h 60 --pivot 0,1.58,0 --maps normal,silhouette \
  --normal-space view --out courier-atlas
node examples/rig-sprite-bake.cjs courier-bake.html
```

The plan is a JSON array. Give each move an `id` and optional display `name`.
Use either `range: [from, to]` with a sample rate in `fps`, or a list of
`cels: [{ at, duration }]` for selected source poses and their exposure
lengths. All times are in seconds. A range includes its start and ends at
its exclusive upper bound. Its last cel can have a shorter exposure.
For both formats, `playback` defaults to `"loop"`. Use `"once"` to hold
the final cel after playback.

Use this with a source rig that can seek to any pose time. The Node API
accepts the plan as `spriteAtlas(world, { clips, ...options })` and can use
the scene's normal animator or a custom `pose(world, sourceTime)` callback.
The PNGs share tile rectangles and the manifest retains each frame's source
time, playback time, and exposure. The manifest also names the frame IDs
belonging to each clip.

```js
const atlas = studio.readSpriteAtlas('courier-atlas/atlas.json');
const signal = K.sprite.placeAtlas({
  atlas, at: [0, 1.58, 0], playback: { clip: 'right-call' }
});
```

The placement uses the current camera direction and the selected clip's
clock. Supply `mode: "loop"` or `"once"` in the playback object to override
the clip default. With a manifest passed to `render --sprite-atlas`, select
its move with `--sprite-clip right-call`.

A JSON diorama can put an array of placements in `finish.spriteAtlases` and refer to each `atlas` by a path relative to the diorama. Use `--sprite-atlas off` to hide the authored placements in a comparison. A manifest passed with `--sprite-atlas` replaces the scene's placements for that render and defaults to the world origin. Set `--sprite-at x,y,z` and `--sprite-scale n` to place it.

Depth positions each texel along its draw ray and participates in the scene's depth, fog, and emission passes. By default the renderer uses the silhouette of the selected view. The [survey drone example](../examples/relightable-impostor.js) demonstrates both placement modes under changing camera and lighting angles.

## Depth-reprojected views

Bake registered depth and set `"viewBlend": "depth-reprojected"` to blend between authored views. This applies to standalone impostors in headless rendering and to bound sprite reconstruction in headless and WebGL rendering and picking.

```sh
ink-studio atlas examples/adaptive-impostors/aperture-relay.js \
  --directions 8 --w 136 --h 132 --yaw -.392699 --raw \
  --maps depth,normal,emission,silhouette --impostor-blend depth-reprojected --out relay-atlas
node examples/depth-reprojected-impostors.cjs /tmp/relay-review
```

Ink projects each source texel into the current camera view and resolves occlusion in each projected tile. The nearest authored view sets cutout coverage. Color, normals, emission, and depth blend where the other view covers the same surface at a compatible depth. Compatible view-space normals are converted to asset coordinates before blending. With `cutoutMipmaps` enabled, the view is reprojected from its selected registered mip.

Use `--impostor-blend nearest` or `--impostor-blend depth-reprojected` to compare the two playback modes from the same atlas. In Node and WebGL set `impostorBlend` on the render frame. The asset default is `nearest`. Ordinary cards and painted scenery keep their own placement rules. Missing depth, separate painted effects, and active painted transitions or fringes use the nearest tile. Exact authored orthographic views also use their original tiles.

At most two source tiles contribute to a draw, within 45 degrees of the observer. The shared CPU cache stores bounded reprojected tiles in half-degree camera bins. WebGL displays the result with its existing depth-bearing quad. Bound sprite frame reports give the neighbor angle, blend weight, and counts of blended texels, nearest-only texels, and neighbor texels rejected by cutouts in `states[i].reprojection`. Large or near-singular projections fall back to the nearest tile.

The Aperture Relay comparison renders the original geometry, closest-view playback, and depth-reprojected playback on the same art grid. Its orbit and JSON report show both improvements and residual errors from single-layer source depth.

Use [directional pixel editing](pixel-art-authoring.md#edit-a-set-of-directional-views)
to compare and repaint neighboring atlas views with a shared palette and part
anchors. A view marked `"handoff": "exact"` uses the nearest authored tile on
both sides of a switch that involves it, even in a depth-reprojected atlas.

## Cutout coverage at a distance

Add `"cutoutMipmaps": { "mode": "coverage", "cutoff": 0.5 }` to a card
or impostor manifest for hard-edged paint such as lace, feathers, and foliage.
Ink builds smaller versions of each view from its original alpha mask and
selects a level using the sprite's size on the native art grid. Each level
keeps the nearest whole number of occupied texels to the original coverage.
Ink gives priority to the most covered footprints and resolves ties with a
fixed spatial pattern. At very small sizes the available pixels limit which
parts of the pattern can survive.

Every occupied texel takes its color, depth, normal and emission from the
same contributing source texel. A hole with no covered source pixels stays
empty. Use `"mode": "average"` to compare with an ordinary area average
and hard cutoff. The option requires at most 262,144 pixels per view.
It applies to world-scaled cards and impostors in the headless renderer,
and to depth-aware reconstruction in WebGL, including picking. Native-pixel
cards and active painted transitions use their registered texels.

```sh
ink-studio atlas my-prop.js --maps depth,normal,emission --cutout-mipmaps coverage --out drone
```

Run `npm run build` and open the [Lacewing demo](../examples/atlas-cutouts/index.html)
from a local server to compare both modes and see a bar pass between the wing depths.

[Ignacio Castaño, Computing Alpha Mipmaps](https://www.ludicon.com/castano/blog/articles/computing-alpha-mipmaps/)

## Painted scenery

Painted scenery can cast [thick cutout shadows](painted-cutout-shadows.md#front-and-back-depth)
with a uniform thickness or paired depth maps.

A scenery atlas splits one painting into parallel planes in world space.
Paint named depths for things a character can pass behind or in front of.
The normal brush marks where the scene's live sun should relight the painting.
The color PNG provides the silhouette and can include transparent pixels.
Use `castsShadow: true` on the placement to cast shadows from those depth
bands. [Shadows from painted cutouts](painted-cutout-shadows.md)

Add the `scenery` section to an atlas manifest.

```json
{
  "width": 196,
  "height": 122,
  "unitsPerPixel": 0.046,
  "files": { "color": "arcade.png" },
  "scenery": {
    "bands": { "ivy": -0.98, "wall": 0, "recess": 1.32 },
    "base": "wall",
    "depthPaint": [
      { "band": "recess", "shape": { "type": "rect", "rect": [74, 60, 68, 48] } },
      { "band": "ivy", "shape": { "type": "path", "points": [[41, 15], [48, 28], [45, 46]], "width": 4 } }
    ],
    "lightPaint": [
      { "normal": [-0.5, 0.55, 0.72], "shape": { "type": "rect", "rect": [19, 35, 17, 2] } }
    ]
  }
}
```

- Each band is an offset from the reference plane in scene units. Negative
  offsets bring paint toward the viewer. Positive offsets set paint back.
  Use up to 16 bands. Unmarked paint uses `base`.
- Both brush lists accept paths with a width in pixels, polygon fills, and
  rectangles. Coordinates are on the full PNG with the origin at its top left.
  Later strokes can override earlier marks. Brush edges snap to the painted
  pixel grid and leave the source color and alpha intact.
- Light brush normals use the atlas's normal space. View-space axes default
  to right, up, and toward the viewer. The brush can add to or replace
  regions of an imported normal PNG. Unmarked texels with no normal retain
  their painted color.
- Scenery uses the band offsets in place of a depth PNG. Omit `frames`
  for a full-image view. Supply one to set the reference pitch, yaw or pivot.
  Placement scale changes both the pixel size and the depth offsets.

The usual `K.sprite.placeAtlas` and JSON `finish.spriteAtlases` placements
select `scenery` mode automatically for this kind of atlas. The plane stays
at its authored world orientation as the camera turns. Use the existing
`depth: false` to flatten it for comparison and `lighting: false` to see the
paint without live shading. The software renderer and CLI composite the
paint with real geometry and depth-dependent fog.

### Paint bump height

Add an optional `bump` block to a scenery, card, or impostor atlas. Paint
positive heights for raised castings, or negative heights for engraving.
The live light responds to the slopes at the painted edges. The bump layer
combines with any authored normal map or `lightPaint` underneath it.

```json
"bump": {
  "strength": 1,
  "paint": [
    { "height": 2, "shape": { "type": "rect", "rect": [18, 12, 27, 4] } },
    { "height": -1, "shape": { "type": "path", "points": [[21, 15], [36, 15]], "width": 1 } }
  ]
}
```

Heights are in texel units from −8 to 8. Later strokes replace earlier
heights. Use a height of zero to erase a mark. `strength` defaults to 1 and
accepts values from 0 to 4. Gradient samples stay within each tile, its
visible silhouette, and its scenery depth band. Color, opacity and placement
depth come from the atlas. Placement lighting and a scene light control the
resulting shade.

Run `node examples/painted-bump-demo.cjs signal-works.html` to paint, relight,
and download the Signal Works atlas. Put its JSON and color PNG next to each
other to load them through the usual atlas manifest path.

For a single flattened painting, match the reference camera and keep turns
short. Wider turns can expose gaps behind painted foreground details. Fill
those areas with a backing card or geometry when a shot needs them.

[The Ivy Arcade](../examples/painted-scenery.js) uses one painting for the
ivy, wall and recess. A courier crosses a floor baked to splats, and the
stone piers use [SDF-assisted coverage](sdf-assist.md).

```sh
ink-studio clip examples/painted-scenery.js --from 0 --to 5.6 --fps 10 \
  --w 224 --h 152 --px 1 --out ivy-arcade.png
ink-studio render examples/painted-scenery.js --t 3.2 --params '{"depth":false}' \
  --w 224 --h 152 --px 1 --out flattened.png
```

## Hand-edited animation cels

Bake the directional atlas as usual. Crop the view you want to paint from
`color.png` using its `rect` in `atlas.json`. Save your painted RGBA tile
outside the bake directory. The tile keeps the baked dimensions and
alignment, including any transparent margin around the original sprite.
Keep the edits in a separate JSON file so you can rebake the 3D animation
without overwriting the paint.

```json
{
  "poses": { "reach": 5, "brace": 6 },
  "replacements": [
    { "frame": "reach", "direction": 0, "effectDepth": -0.30, "files": { "effect": "sleeve-smear.png" } },
    { "frame": "brace", "direction": 0, "files": { "color": "brace.png" } }
  ],
  "holds": [
    { "frame": "brace", "direction": 0, "frames": 2 }
  ]
}
```

- `frame` accepts a baked frame number or a name from `poses`. Each
  replacement must select exactly one view. Add `pitch` in radians if the
  bake contains the same direction at multiple elevations.
- A hold displays the named frame for the specified number of consecutive
  baked frames, counting the source frame. A hold can target selected views
  or omit `direction` and `pitch` to cover all views. It changes the displayed
  cel while scene time, camera motion, and other animations advance.
- Replacing `color` inherits the baked pivot, scale, and per-texel depth,
  normal, and emission. You can supply aligned `depth`, `normal`, or
  `emission` PNGs using the same encodings as the atlas. Paint outside the
  original alpha requires an authored depth texel or a numeric
  `extensionDepth` in scene units relative to the pivot plane.
- An optional `effect` PNG can paint outside the silhouette. It is a
  separate color layer that participates in sorting without writing depth.
  Use `effectDepth` to place it relative to the pivot plane. Negative offsets
  place paint toward the viewer.

To load the edits from a scene, reference them with `"cels": "edits.json"`
in `atlas.json`. The patch PNG paths are relative to the sidecar. In Node
you can pass `{ cels: '/path/to/edits.json' }` to `readSpriteAtlas`. For
an in-memory atlas use the same `metadata.cels` structure, with decoded RGBA
tiles in `images` instead of paths in `files`.

Set `playback: 'once'` or `playback: 'loop'` on a placement to sample the
baked timing from the scene clock. Elapsed time starts at the first frame.
Existing explicit `frame` controls can also select edited or held frames.
The Node renderer and CLI support cel edits on card and impostor atlases.

```sh
ink-studio clip my-scene.json --sprite-atlas path/to/atlas.json \
  --sprite-cels path/to/edits.json --sprite-playback once
ink-studio clip examples/lantern-catch.js --from 0 --to 1.65 --fps 24 \
  --w 192 --h 140 --px 1 --out lantern-catch.png
```

[Lantern catch](../examples/lantern-catch.js) bakes a roughly 32-pixel
character, paints its catch sleeve and holds the braced pose for two frames
while the swinging lantern and camera keep moving. Use `--params
'{"edited":false}'` for the original bake.

## Authored transition cels

Use `metadata.cels.transitions` to animate small patches of a held sprite
or replace its whole face for an expression that moves the silhouette.
A clip is a sequence of drawings on a registered rectangle. Each drawing
holds for its authored duration. Several clips can run on the same pose.

```json
{
  "poses": { "listen": 0 },
  "transitions": [
    {
      "id": "look-and-blink",
      "frame": "listen",
      "direction": 0,
      "rect": [12, 18, 11, 5],
      "start": 0.4,
      "frames": [
        { "duration": 0.10, "files": { "color": "half-lid.png" } },
        { "duration": 0.08, "files": { "color": "closed.png" } },
        { "duration": 0.12, "files": { "color": "look-left.png" } }
      ]
    },
    {
      "id": "jaw-drop",
      "frame": "listen",
      "direction": 0,
      "rect": [8, 10, 22, 29],
      "mode": "replace",
      "extensionDepth": -0.04,
      "start": 1.2,
      "frames": [
        { "duration": 0.15, "files": { "color": "jaw-start.png" } },
        { "duration": 0.30, "files": { "color": "jaw-open.png" } }
      ]
    }
  ]
}
```

- `rect` is `[x, y, width, height]` in top-left view-local art pixels.
  Choose the same registration for every drawing in a clip. Omit `frame`
  to use a patch on all matching poses. `direction` and `pitch` target
  separately drawn views. When the body holds a pose, its displayed view
  selects the paint and the clips continue on the placement clock.
- In the default `patch` mode, each nontransparent texel supplies its
  exact RGBA value. Paint any skin or shadow needed to cover an old line.
  In `replace` mode every texel in the rectangle is replaced. Use its
  transparent pixels to erase the old cheek or jaw. Include any collar
  or hair pixels the rectangular replacement should preserve. When
  active clips intersect, the last one listed supplies the pixel.
- Use matching-size PNGs in a cel's `files`, decoded RGBA buffers in
  `images`, or a `paint` object with `rows`, `slots`, or `strokes`.
  Indexed paint uses the clip's RGB hex `palette`. Existing visible
  pixels inherit the body cel's depth, normals, and emission. You can
  supply aligned auxiliary channels with the color. Newly occupied
  pixels need a `depth` texel or `extensionDepth` in scene units.
  The patch may extend beyond the view tile by up to 128 pixels.
- `start` sets the first exposure in seconds and `fps` supplies each
  drawing's default duration. Use different durations for uneven
  timing, including a one-frame half-lid or a held half-smile. A
  duration-only cel reveals the layers underneath. A clip releases
  when it reaches the end. Use `period` to repeat it on a longer clock.

The Node/CLI sprite atlas renderer supports transition cels on cards and
impostors. PNG paths in a `cels` sidecar stay relative to the sidecar.

[The Wrong Password](../examples/face-transition-cels.js) holds the body
while two patches animate a startled blink and a mouth catching
mid-word. A full-face drawing widens the cheek and drops the jaw for
the laugh. Use `--params '{"transitions":false}'` for the held pose.

```sh
node cli/ink-studio.js clip examples/face-transition-cels.js --w 316 --h 190 --px 1 \
  --raw --from 0 --to 6 --fps 20 --out wrong-password.apng
```

### Overlay stencils and emission

Give a transition cel its own stencil to clip the registered color,
depth, normal and emission channels to the same art pixels. Draw
`maskPaint` with slot `0` to show the cel and `.` to reveal whatever is
underneath. A registered `files.mask` PNG or `images.mask` RGBA buffer
uses alpha ≥ 128 for the same hard stencil. In `replace` mode, transparent
color erases the silhouette only inside the stencil.

Paint a separate emitter with `emissionPaint`, using the clip palette,
or supply an aligned `emission` PNG or RGBA channel. You can mix indexed
color with auxiliary PNGs by declaring `paint` and `files` on the
same cel. Each channel takes one source. The atlas emission encoding still
applies. `add` adds emission to the painted color and `baked` preserves
the painted color while supplying a signal to effects such as glow.

```json
{
  "id": "spell-iris",
  "rect": [22, 14, 5, 3],
  "palette": ["#341c29", "#d44149", "#ff6a48"],
  "inheritEmission": false,
  "frames": [
    {
      "duration": 0.25,
      "paint": { "rows": [".111.", "01110", ".111."] },
      "maskPaint": { "rows": [".....", "00000", ".000."] },
      "emissionPaint": { "rows": [".222.", ".222.", "..2.."] }
    }
  ]
}
```

Draw the hair and lid as later clips so their visible texels cover the
iris. Set `inheritEmission: false` on those clips to suppress baked body
emission wherever they draw. Opaque paint then covers both the color and
glow source. Clips without this option retain the existing body-emission
fallback. The visible emission pass drives the halo, so a fully closed eye
stops emitting even while its iris clip is running.

[The Crimson Lock](../examples/sprite-overlay-masks.js) runs the iris,
lid and bangs on separate tracks. Frame times around 1.55 seconds show
the upper lid cutting into the iris and 1.75 seconds shows it shut.

```sh
node cli/ink-studio.js clip examples/sprite-overlay-masks.js --w 184 --h 116 --px 1 \
  --from 0 --to 4 --fps 20 --out crimson-lock.apng
```

## Native-size cel preview

Scrub a sprite atlas one art pixel at a time with the [cel preview example](../examples/sprite-cel-preview.cjs).
The clean pane always shows the export raster at 1×. The onion pane also
supports integer zoom. Cyan marks the previous drawing and pink marks the
next. **Changes only** highlights the pixels that differ from the current
drawing. **Distinct drawings** skips identical holds. **Export frames**
compares with the immediately adjacent samples.

```sh
node examples/sprite-cel-preview.cjs cinder-courier.html
node examples/sprite-cel-preview.cjs actor-preview.html --atlas actor.json \
  --width 128 --height 128 --fps 12 --frames 48 --yaw 0 --pitch 0
```

Open the generated HTML in a browser. The first command generates a
head-turn study with a deliberate one-pixel iris shift on frame 9.
The second loads your atlas, including any transition cels in its sidecar.
Angles are in radians. Use `--mode card` for a front-facing card.

Call `KIT.sprite.celPreview.create({ atlas, width, height, fps, count })`
to sample a registered sprite against its pivot, including transition cels
and painted fringes. Set `origin: [x, y]` in art pixels to offset the pivot,
or supply `viewAt(time, index)` for a changing view angle. To inspect frames
that already include scene shading or compositing, pass their aligned
native RGBA buffers to `KIT.sprite.celPreview.fromFrames({ width, height, fps, frames })`.
Both work with `mountSpriteCelPreview(host, { preview })` from `webgl.mjs`.

For an independently timed outline, use [silhouette tracks](silhouette-tracks.md).
The preview can isolate one track and align its onion skins at the moving pin.

## Painted sprite fringes

Add `fringe` to the same `cels` sidecar used for replacements and
holds. Paint the **attachment sites** on a sprite view with indexed
brushes. Each painted texel pins an independently timed, hand-drawn
cel sequence. A brush can trail behind a hem, flicker along a banner,
or send a small detached fragment past the tile edge.

```json
{
  "poses": { "hover": 1 },
  "fringe": {
    "clips": {
      "wisp": {
        "width": 3,
        "height": 3,
        "pin": [1, 0],
        "palette": ["#8ed6cb", "#4a9aaa"],
        "frames": [
          { "rows": [".0.", ".01", "..1"], "duration": 0.12 },
          { "rows": [".0.", "10.", "1.."], "duration": 0.16 },
          { "rows": ["...", ".0.", "..1"], "offset": [2, 3], "duration": 0.14 },
          { "duration": 0.08 }
        ]
      }
    },
    "brushes": [
      { "clip": "wisp", "depth": 0.04, "opacity": 0.85 },
      { "clip": "wisp", "phase": 0.19, "depth": 0.07, "opacity": 0.7 }
    ],
    "paint": {
      "strokes": [
        { "slot": 0, "shape": { "type": "rect", "rect": [16, 31, 1, 1] } },
        { "slot": 1, "shape": { "type": "rect", "rect": [20, 31, 1, 1] } }
      ]
    }
  }
}
```

- Clips use the [indexed pixel stamp](pixel-stamps.md) cel format, so a
  pose can be authored as `rows`, `slots`, or `strokes`. Each clip
  has a palette of RGB hex swatches and a `pin` in top-left art-pixel
  coordinates. `fps` and optional per-cel `duration` control timing.
  Playback loops by default. Use `playback: 'once'` and a final empty cel
  to play a wisp once and clear it.
- Each painted site selects a brush index. For exact placement, use
  single-pixel marks and leave holes between strands. Use whole-view
  `rows` or `slots`, or ordered strokes. A stroke with `slot: null`
  erases sites. Each view supports up to 512 painted sites. A clip
  supports up to 96 cels on a grid up to 64×64 pixels.
- `phase` offsets the clip clock in seconds. Choose different phases for
  neighboring strands. A cel can also nudge its painted pixels with an
  integer `offset: [x, y]`. For a release, leave a gap at the pin and
  offset successive cels away from the hem. The detached fragment is
  animated in sprite-local pixels and can extend beyond the bake.
- Use `views: [{ frame: 'hover', direction: 0, paint: { ... } }]` to
  replace the default anchor map for a pose or direction. Add `pitch`
  to distinguish elevations. Use an empty `paint: {}` to clear the
  anchors for a matching view. A held pose keeps its own anchor map
  while the fringe clock keeps advancing.
- `depth` sorts the fringe relative to the pivot plane in scene units,
  using the same convention as `effectDepth`. It participates in
  occlusion and fog as translucent paint. Set an optional `emission`
  gain from zero to one for glow passes. Painting the fringe keeps the
  registered body color and auxiliary maps intact.

The Node renderer and CLI draw fringes on card and impostor atlases,
including native-pixel cards. An editor can query
`atlas.fringe(atlas.select(frame, mode, direction), time)` for a
view-local packet with exclusive `bounds` and `at(x, y)` samples.

[The Drowned Belfry](../examples/tidekeeper-fringe.js) uses three clips for
a ghost's fluttering hem, long ribbons, and small released wisps. Render
with `--params '{"fringe":false}'` to inspect the underlying silhouette.

```sh
node cli/ink-studio.js clip examples/tidekeeper-fringe.js --w 322 --h 214 --px 1 \
  --raw --from 0 --to 6 --fps 15 --out drowned-belfry.apng
```
