# Indexed pixel drawing and animated stamps

Pixel stamps use a shared art grid and exact palette indices for material
paint, contour masks, and animated effects. Draw one cel for a patch of
moss, or give several cels different holds for a sparkle, bubble, or spell.

Build the browser bundle with `npm run build` and open
[Pixel Stamp Workshop](../examples/pixel-stamp-editor.html) through a local
static server. The workshop has a one-pixel pencil, an optional pixel grid,
and a brush, eraser, eyedropper, connected fill, and polygon. The eyedropper
selects the swatch of the sampled texel. Fill replaces the connected region
of that exact swatch or transparency on the current frame. It previews holds and saves
the same JSON the renderer reads. The star, glint, and bubble studies let you
open each separately drawn size.

**Pixel-perfect pencil** starts enabled. As you draw, a one-pixel elbow
resolves to a diagonal when the next pixel makes the middle one redundant.
Both views show the resolved stroke before you release. Single taps and
stroke endpoints stay in place. Turn the option off to draw square
corners. Previously painted pixels stay in place during cleanup.

Choose **Shape** to draw lines, Bézier curves, rectangles, ellipses,
polygons, bitmap text, and stepped patterns. Drag from the first pixel
to the last for lines, rectangles, and ellipses. Rectangles, ellipses, and
polygons offer filled and outlined styles. For a curve, click the start,
one or two control points, and the end. For a polygon, click each vertex
in order. Apply or cancel the preview from the Draw panel. Text and
staircases use a click to place the configured shape at its native anchor.
Each placed shape has one undo step.

In **Selection**, choose a rectangle or ellipse marquee, freehand lasso,
polygon lasso, magic wand, or color range. Drag a marquee or freehand
lasso on the native canvas. For a polygon, place vertices and use **Close
polygon**, Enter, or a double-click to finish. The wand follows connected
color and **Color range** also finds matching islands. Both use the color
tolerance field.
**Swatch** selects the exact palette entry under the pointer. **Swatch
cluster** follows the same entry across edges, or across edges and
corners. Scene object, part, material, channel, and depth masks can be
saved through the CLI and recalled from a stamp export.
[Semantic selections](pixel-art-authoring.md#select-by-meaning)

The active mask limits painting on that frame. Use **New selection**
to replace it, add to it, subtract the next selection, or intersect the
two. **Modify selection** inverts, grows, shrinks, or outlines the active
mask. Set the radius in art pixels and put outlines inside, outside, or
on both sides of the boundary. **Undo** restores the previous mask.

Use **Saved masks** to store a selection by ID and recall it on the
current frame. These masks travel with the stamp JSON and can be recalled
after reopening the file. **Clear** removes the active selection.
[Selection query and mask syntax](pixel-art-authoring.md#edit-and-recall-masks)

**Capture** turns the highlighted footprint into a reusable brush with
its original colors and transparent gaps, then clears the mask so you can
stamp elsewhere. Set the brush-local anchor, size, angle, and swatch mode
in the brush controls. **Stamp brush** places the anchor
at the pointer. Click for one dab or drag a stroke. **Save brush** and
**Open brush** exchange the same brush JSON with the document tools.

Enable **Brush dynamics** to set the stabilization time and map pen pressure
and pointer speed to brush size. Mouse and touch use full pressure. The
stabilized stroke previews on both canvases while you draw and ends at your
release pixel. Brush JSON also saves the dynamics.
[Brush capture and dynamics](pixel-art-authoring.md#brush-dynamics)

Choose a **Brush mode** after capturing or opening a brush. **Recolor with
coverage lock** applies the active swatch only to visible pixels of the
current frame. **Shade along ramp** takes an ordered list of 1-based palette
slots and a signed step. **Set alpha** changes opacity without changing the
swatch. Use 0 to hide the pigment and 255 to bring it back. A stroke is one
undo step. [Document shading operations](pixel-art-authoring.md#coverage-lock-and-shading)

A stamp or animated frame can carry an optional `alpha` array with one byte
per texel alongside its indexed paint. Omitting the array gives painted
texels full opacity. Sprite atlases and projected indexed paint and masks
carry this coverage through sampling. Optional `swatchIds` align with
the palette entries and distinguish colors with identical RGB values.
Use `pixelStamps.image(stamp, { preserveHidden: true })` to include the
original RGB bytes at zero alpha in a straight RGBA image.

Choose **RGBA** under **Pencil color** to paint with an RGB color and an
alpha byte. Ink adds an exact swatch if needed and keeps the current
swatch when only alpha changes. **Open stamp or PNG** loads stamp JSON
or a still PNG. **Save PNG frame** exports the current frame as indexed
or RGBA and keeps Ink's swatch IDs, indexed pixels, and alpha on reimport.
Use **Save JSON** to retain the animation and guides.
[PNG modes and editable RGBA patches](pixel-art-authoring.md#edit-and-exchange-exact-rgba-pixels)

In **Palette**, name or lock the active swatch, or move it in the display
order. **Edit swatch color in all frames** changes its definition.
**Replace swatch in selection** paints over matching pixels in the
active selection of the current frame. **Remap palette indices**
reassigns matching pixels in every frame. Use **Palette ramps** to set an
explicit order by swatch ID. Choose that ramp under the brush's
**Saved ramp** control to shade with it after any palette reorder.
**Palette files** can extract colors from the current frame or a PNG,
merge a palette JSON, and export swatches, locks, and ramps. Each palette
edit can be undone with the artwork.
[Palette file and edit syntax](pixel-art-authoring.md#edit-palettes-and-ramps)

Under **Symmetry and wrapping**, enable **Mirror X** or **Mirror Y** and
move the axis using its position field. Whole values run through pixel
centers and half-pixels run between them. Enable **Wrap X** to repeat
left and right, or **Wrap Y** to repeat above and below. Neighbor tiles
update while you draw, and you can draw in any visible repeat. Zoom out
to expose more of the neighboring tiles. Use both axes to check corners
and both directions of a repeating texture.

The Workshop saves one native tile and retains the drawing settings in the
stamp JSON. [Symmetry and wraparound in document edits](pixel-art-authoring.md#symmetry-and-wraparound)

Use **Transform pixels** to float the selected pixels. Drag on the
canvas or use arrow keys for one-pixel nudges. The fields set integer
position and size, flips, angle, and the rotation sampler. Watch both
canvases as you edit. **Leave source** turns a move into a copy. Press
Enter or **Apply transform** to commit, or Escape to cancel.

**Copy** and **Paste** use the Workshop clipboard across frames or stamps
opened in the same Workshop tab. The viewport also accepts Ctrl/Cmd+C and
Ctrl/Cmd+V. Pasting starts an editable preview. A single undo restores
the paint and selection. [Document transform and clipboard syntax](pixel-art-authoring.md#transform-and-paste-selections)

The main canvas zooms in whole steps. Use **−**, **+**, and **Fit**, or
Ctrl-scroll or ⌘-scroll around the cursor. Middle-drag, use **Pan** and drag,
or focus the canvas and use the arrow keys to move it. The grid appears at
4× and above when **Grid** is on. Cursor coordinates start at zero in the
upper left. The second view stays at one CSS pixel per art pixel and
updates during drawing and animation playback.

Use **Canvas transforms** to transform all frames together. **Crop** keeps a
rectangle you enter or takes the bounds of the active selection. **Trim**
finds the bounds of visible paint across the animation. **Pad** adds
transparent margins. **Resize** places the old grid at a chosen anchor
inside the new bounds. **Resample** scales the artwork with nearest-pixel
or area filtering.

Pivots, registration guides, and saved selections follow the transform.
If the stamp carries scene bindings, choose whether to preserve their
source coordinates or map the whole new canvas before applying. Undo
restores the previous grid, artwork, guides, and bindings.
[Canvas transforms in a pixel document](pixel-art-authoring.md#transform-the-whole-canvas)

Use **Guides** in the Workshop sidebar to add, edit, or remove grid origins,
axes, pivots, and registration points. Put a guide on all frames or just
the current frame. Enable **Snap** above the canvas to snap drawing near a
guide. The cursor shows the resulting pixel and the guide that caught it.
The **Guides** checkbox controls overlay visibility separately.

The built-in studies include the two layers of the Red Spring spell, so
the ink and the eye can be edited separately.
The [animated tile library](pixel-tiles.md) uses the same editable cels
for copper pulses and creeping frost.
[Directional contact marks](contact-marks.md) add cels for direct hits and
glancing skids with two authored sizes and diagonal poses.
[Light-driven highlight cels](highlight-cels.md) add individually drawn
pins, hooks, and arcs for brass, enamel, and glass.
[Jointed sprite chains](jointed-sprite-chains.md) register authored link cels
to two spring-driven sockets and switch drawings as the links deform.

## Drawing and timing

```js
const stamp = {
  width: 12, height: 8,
  palette: ['#376772', '#90bbb0', '#f6e7ba'],
  origin: 'top-left',
  strokes: [
    { slot: 0, shape: { type: 'polygon', points: [[1, 3], [9, 2], [11, 4], [4, 6]] } },
    { slot: 2, shape: { type: 'path', points: [[4.5, 3.5], [7.5, 3.5]], width: 1 } },
    { slot: null, shape: { type: 'rect', rect: [5, 3, 1, 1] } }
  ]
};
```

- A cel can start with a `slots` array, paint ordered `strokes`, or do both.
  Each stroke has a rectangle, polygon, or path. `null` erases the texel.
  Slot `0` is a paint color. Edges snap to the stamp grid at half coverage.
- Use `rows` in place of `slots` to write a small shape exactly as it should
  appear. `.` is transparent. `0–9`, `A–Z`, and `a–z` select entries 0–61
  in order. Every row must contain exactly `width` characters, and each cel
  has exactly `height` rows. For example, the four-by-three star's flash is
  `['.2..', '1243', '..1.']`. It shifts the top and bottom rays to different
  columns, where a three-by-three star can center both rays in one column.
- For animation, supply `frames: [{ duration, slots, strokes }, …]` in place
  of the single cel. Frames also accept `rows`. `duration` is in seconds and defaults to `1 / fps`
  (12 fps by default). Use `{ duration: 0.18 }` for a blank hold. `playback`
  defaults to `loop`. Use `once` to hold the last cel and `phase` to offset
  playback in seconds. Sampling is independent of frame order.
- Palette entries can be hex, normalized RGB, scene indices, or named scene
  roles that resolve to one swatch. Without a local `palette`, the slots
  address the scene palette directly. The workshop edits literal hex swatches.

`KIT.pixelStamps.paint(width, height, cel)` resolves the marked slots.
`KIT.pixelStamps.image(stamp, { time, scenePalette, paletteRoles })` gives a
straight RGBA preview. Both methods work in the browser bundle and Node.

To use the same viewport in another browser tool, import
`mountPixelGridCanvas` from `src/pixel-grid-canvas.mjs` and load the matching
CSS. Pass each native `{ width, height, rgba }` frame to `view.setFrame()`.
Use `view.pixelAt(clientX, clientY)` to get the art coordinate for an edit
and `view.dispose()` when removing the canvas.

Stamp JSON stores guides shared by the whole animation in `guides`.
Individual entries in `frames` can also carry a local `guides` list with its
own IDs. Both use the [pixel guide definitions](pixel-art-authoring.md#register-frames-and-align-texture-pixels)
with scope implied by the list. When using the browser canvas, pass
`{ guideTool: KIT.pixelGuides }` when mounting, then call
`view.setGuides(activeGuides)` on frame changes.

To use a drawn pivot when placing an animated stamp, pass
`{ pivotGuide: 'foot' }` to `KIT.pixelStamps.atlas` or `KIT.pixelStamps.place`.
Each frame uses the matching pivot's exact position, including half pixels.
Pass `{ pivotGuide: true }` to use one pivot per frame even when the IDs
differ. The existing sprite pivot settings still apply when rendering
without this option.

## Marking a surface

```js
const projection = { origin: [-1, 0, 0], along: [1, 0, 0], across: [0, 1, 0] };
const moss = {
  type: 'projected', pattern: 'indexed', stage: 'material', projection,
  raster: { ...stamp, size: [2, 1.33] }
};
```

Put a projected layer under the named layers of a native material. Paint
large color masses and shade regions at `stage: 'material'` so the surface
keeps its lighting. Paint explicit specular bands and broken wet highlights
at `stage: 'lit'`. `ink: true` marks detail for the art resolve. Use `size`
for the projection span in scene units. Projected paint is rest-space by
default, so it stays attached to moving splats and SDF-backed surfaces.
Other projection and palette-cycle options continue to work.

To use the same grid as a binary mask, set
`mask: { type: 'indexed', projection, raster: { ...stamp, size: [2, 1.33] } }`.
Any painted slot enables the mark. The mask works on material finishes and on
`silhouette`, `crease`, or `boundary` rules in `finish.look.ink`. Use it to
draw where a line starts and stops, and use `invert: true` to paint exclusions.
Choose `space: 'world'` for marks fixed to the scene. See the
[selective ink rules](art-passes.md#selective-ink-and-stable-pixels) for target
selectors. A silhouette can also set
`contrast: { dark: '#192632', light: '#98b3aa', minGain: 0.04 }`. It samples the
pixels immediately beyond the contour and chooses the swatch that improves
value separation by at least `minGain` on a 0–1 scale.

## Placing an effect in depth

Use `finish.pixelStamps` in a JSON diorama or `pixelStamps` in `B.finish()`.
Each placement has `stamp`, a three-coordinate `at`, and `unitsPerPixel`.

```js
return B.finish({
  cam,
  pixelStamps: [
    { stamp: sparkle, at: [0, 1.2, 0], unitsPerPixel: 0.045, phase: 0.25 },
    { stamp: ghostEye, at: [1.1, 1.8, -0.4], unitsPerPixel: 0.055, emissionSlots: [4, 5] }
  ]
});
```

The placements become ordinary depth-aware sprite atlas cards. Use
`nativePixels: true` with the camera-facing card at scale 1 to snap the card
origin to the art grid and assign each source texel to one art pixel. The
stamp keeps its drawn width and height as the camera moves and zooms. Choose
a separately authored size for a larger or smaller silhouette. A normal
card uses `unitsPerPixel` for a size in scene units. Covered
texels can sit behind native geometry. An emission slot follows the drawn
cel and can drive the scene's art-pixel glow. Use `scale` for instances and
separate phases for repeated effects. In JavaScript, `at(time)` can follow
a prop, drift with a bubble, or sample a rig anchor. For a stamp that lies
against the surface itself, use a projected material layer. Use actual
geometry for silhouette changes to a solid, or layer a separate stamp in
depth for shapes that extend beyond the solid.

The software renderer and CLI render the complete scene. Browser hosts share
the indexed raster and atlas construction API. See
[WebGL feature coverage](browser-renderer.md#feature-coverage) for projected
finishes, selective ink, and sprite atlas integration.

## Effect presets and reusable clips

The [shoreline foam](shore-foam.md) clips include separately drawn cardinal
and diagonal cels for straight banks, inside corners, and rock tips.

`KIT.pixelStamps.catalog()` lists the effect families and their variants,
plus the editable clips they use. Open **Library clips** in the workshop to
draw or retime any clip. `KIT.pixelStamps.clip(id, { swatches })` returns a
fresh, JSON-serializable descriptor, with its named `swatchRoles`.

| Preset | Variants | Placement |
| --- | --- | --- |
| `star` | `tall`, `wide`, `distant` | Pinned twinkle, repeating by default |
| `glint` | `sweep`, `echo` | A catch and directional sweep followed by a smaller echo |
| `bubble` | `full`, `small` | An authored rise, then a pop and ripple at its endpoint |
| `ember` | `rising`, `chip`, `fleck`, `bed` | Whole-pixel trails and individual cooling poses |
| `burst` | `spray`, `fork`, `diamond`, `fan` | An expanding mark that breaks into detached pixels |
| `glyph` | `cross`, `outline-cross`, `split-cross`, `ring`, `diamond`, `four-dot`, `brackets` | A fixed-center signal pulse with four individually drawn cels |

```json
{
  "pixelStamps": [
    { "preset": "star", "variant": "wide", "at": [0, 2, -3], "phase": 1.2 },
    { "preset": "bubble", "at": [0.4, 0.3, 0.2], "start": 0.6, "period": 3 },
    { "preset": "ember", "variant": "chip", "at": [1, 0.2, 0],
      "start": 1, "swatches": { "hot": "#ffe8a6", "ember": "#d85d48" } }
  ]
}
```

Place this under `finish` in a diorama, or pass it to `B.finish()`. Presets
use native-pixel placement. `at` anchors them in the scene. `offset` nudges
the whole effect by `[x, y]` art pixels. Positive X is right and positive Y
is down. `start` and `period` schedule the effect in seconds. `phase` offsets
cel playback. Star twinkles and the coal bed repeat by default. Presets keep
their own swatches in the standard palette resolve. Set `keepSwatches: false`
to use the scene palette, or supply named swatches of your own. Later shading,
compositing, and grading can affect the visible result.

`KIT.pixelStamps.preset(name, options)` returns ordinary stamp placements
that can be edited or flattened into a scene. To compose one yourself, set
`cue: { start, period }` on a placement with a custom `stamp`. A cue is
invisible before its start and after the clip finishes. Add `period` for a
repeat with an optional gap. On a native-pixel card, `offsets` takes a list
of `[seconds, x, y]` keys relative to its cue. Motion rounds to whole pixels.
Cel size, timing, and swatch indices are independent from motion.

The [preset reel](../examples/pixel-effect-presets.js) places stars, glints,
bubbles, embers, and bursts over a painted scene.

```sh
node cli/ink-studio.js clip examples/pixel-effect-presets.js --w 244 --h 156 --px 1 \
  --from 0 --to 4 --fps 18 --out pixel-effects.png
```

### Signal Fall

[Signal Fall](../examples/signal-fall.js) runs seven glyphs in a descending
stream and shows the four cels of each at twice their native size. Each
clip keeps a common 7×7 grid and changes the contour as it brightens and
decays. Open the **Signal** clips under **Library clips** in the workshop to
edit individual pixels and holds.

Use `clip('glyph-ring')` for a single editable clip or place
`{ preset: 'glyph', variant: 'ring', at: [0, 1, 0] }` in a scene. The swatch
roles are `residue`, `dim`, `lit`, and `peak`. The example samples the same
clips in one raster layer. A clock advances the pulse in each column while
the glyph cells stay in place.
The motion study was inspired by [ama_plaka’s ‡┼⁕⌑ loop](https://x.com/ama_plaka/status/2124116076803871198).

```sh
node cli/ink-studio.js clip examples/signal-fall.js --w 388 --h 240 --px 1 \
  --from 0 --to 4 --fps 24 --out signal-fall.png
```

## Red Spring Observatory

The [example scene](../examples/red-spring.js) combines painted stone planes
and moss, an edited rock contour, wet brass highlights, staggered air bubbles,
and a rising ink spell with separately timed emission and a painted reflection.

```sh
node cli/ink-studio.js render examples/red-spring.js --w 272 --h 160 --px 1 \
  --t 2.85 --out red-spring.png
node cli/ink-studio.js clip examples/red-spring.js --w 272 --h 160 --px 1 \
  --from 0 --to 6 --fps 12 --out red-spring-loop.png
```

Pass `--params '{"paint":false}'` for a matched comparison of the native
surfaces, or `--params '{"effects":false}'` for the quiet spring.

[The Starfall Window](../examples/starfall-window.js) isolates the smaller
effects. It uses phased star twinkles behind an arch, brief glints on brass
and water, and a drawn meteor trail. Star twinkle is also an editable study
in the workshop.

```sh
node cli/ink-studio.js clip examples/starfall-window.js --w 244 --h 142 --px 1 \
  --from 0 --to 4 --fps 12 --out starfall-loop.png
```

[Glitter Burst Reel](../examples/glitter-burst-reel.js) shows three drawn
bursts whose bright cores give way to open shapes and detached embers. The
same cels and smaller flecks are phased along a spell trail. Open the fork,
diamond, or fan under **Library clips** to edit their individual cells.

```sh
node cli/ink-studio.js clip examples/glitter-burst-reel.js --w 244 --h 128 --px 1 \
  --from 0 --to 1.5 --fps 24 --out glitter-reel.png
```
