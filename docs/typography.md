# Typography as geometry and animation

`Typography` is a dependency-free, DOM-free outline/layout/animation core.
`K.typography` connects it to the existing SDF sculptor, splat rigs, textured
sprite surfaces, transported curves and surface materialisation. The core of
the renderer remains SDFs and splats; sprite text is an optional surface.

Open [The shape of words](../examples/typography.html) to orbit a live specimen,
write its contours, scramble a bitmap signal, and detach/reassemble its actual
SDF lettering. The example uses original Ink Sans outlines and the existing
bitmap atlas, without downloading fonts or libraries.

Use timed story dialogue as input to bitmap lettering and subtitle exports. [Actor performance adapters](actor-performance.md)

## Fonts and layout

```js
const T = K.typography;
const outline = T.fonts.sans();       // original curved Ink Sans capitals
const bitmap = T.fonts.bitmap();     // existing 6×8 pixel atlas, traced outlines
const font = T.trueType(bytes);      // Uint8Array, Buffer, ArrayBuffer or view
const run = T.layout('AVATAR\nIN MOTION', {
  font, size: 1, tracking: .02, lineHeight: 1.3, align: 'center'
});
// run.glyphs contains code-point indices, advances, baselines and glyph outlines.
```

Size is **em height**, not cap height. Tracking and line height are world units.
Kerning is on by default; set `kerning: false` for unkerned advances. Alignment
applies separately to each line. Newlines, CRLF, tabs (four space advances),
empty lines, Unicode code points and fallback glyphs have deterministic layouts.
The core form is `Typography.layout(text, font, options)`; the kit wrapper takes
the font inside options and defaults to Ink Sans.

Ink Sans has original scalable uppercase contours, paired spacing, counters and
quadratic curves; lowercase aliases capitals. Other symbols/digits use the
existing pixel glyphs as a fallback. Its design is intentionally distinct from
a complete imported typeface. The existing pixel atlas retains its original
Adafruit BSD attribution in `src/kit/kza-ascii.js`.

Portable outline fonts need no binary file:

```js
const font = T.font({
  name: 'My face', unitsPerEm: 1000, ascender: 800, descender: -200,
  lineGap: 100, fallback: '?',
  glyphs: {
    A: { advance: 700, commands: [
      ['M', 0, 0], ['L', 300, 700], ['L', 600, 0], ['Z']
    ] },
    ' ': { advance: 300, commands: [] }
  },
  kerning: { 'A,V': -80 }
});
```

Commands are absolute `M x y`, `L x y`, `Q cx cy x y`,
`C c1x c1y c2x c2y x y`, and `Z`. Close each contour. Nested loops are counters
using the sculptor's even-odd convention. `font.glyph(character)` exposes
immutable commands, advance and ID; `font.kerning(left, right)` uses design
units. Providers (`glyphs(character)` and `kerning(a,b)`) can adapt other font
sources. `outline(font, character, {tolerance})` caches adaptively flattened
loops; tolerance is in design units. `flatten(commands,tolerance)` also works
independently.

### TrueType scope

The native reader handles uncompressed SFNT **glyf-based TrueType**: Unicode
`cmap` formats 4 and 12, horizontal metrics, implied quadratic points, composite
glyph transforms/point attachment, legacy format-0 horizontal `kern`, and
unflagged GPOS `kern` PairPos formats 1/2 (including extension lookups).
GPOS x-advance pair adjustments take precedence over legacy kerning; an explicit
`trueType(bytes,{kerning:{'A,V':-80}})` override wins over both.

It follows the OpenType [glyph](https://learn.microsoft.com/en-us/typography/opentype/spec/glyf),
[Unicode mapping](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap),
[kerning](https://learn.microsoft.com/en-us/typography/opentype/spec/kern) and
[pair positioning](https://learn.microsoft.com/en-us/typography/opentype/spec/gpos)
tables. Bounds, recursion, component and decoded-point budgets reject malformed
inputs. It does not execute font hinting or provide CFF/WOFF/TTC, variable-font
axes, GSUB ligatures, bidi or complex-script shaping. GPOS placement, mark
attachment, nonzero lookup flags and script/language feature selection are
outside this simple horizontal layout API. Supply already shaped glyph geometry
through an adapter for those cases. Only use font assets you can distribute.

## Seekable glyph animation and curve placement

```js
const frames = T.pose(run, seconds, {
  position: [0, 1, 0], rotation: [0, .2, 0], scale: 1,
  path: K.curve.create({ type: 'flower' }), // optional
  offset: .4, wrap: true, fit: false,
  writeOn: { start: 0, duration: .8, stagger: .08, reverse: false },
  scramble: { start: 0, duration: 1, stagger: .05, rate: 20,
    seed: 31, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' },
  transform: (glyph, time) => ({
    position: [0, .1 * Math.sin(time + glyph.index), 0],
    rotation: [0, 0, .04 * Math.sin(time)], scale: 1, opacity: 1
  })
});
```

Animation is sampled, not integrated: arbitrary seeks, held frames and different
frame rates give the same result. It can use any shared time domain. Per-glyph
transforms are local to the glyph's transported frame. Rotation uses radians
with Z, then X, then Y composition (`Ry * Rx * Rz`); scale can be a scalar or
XYZ. Global rotation/scale place the entire run. Output contains a world
`position`, row-major 3×3 `matrix`, character, font scale, opacity and write-on
progress. `transform(frame, localPoint)` places a point in world space.

Paths use existing distance-based `frame(distance)` results, including smooth
closed seams. Off-path glyph centers on open curves have zero opacity;
`wrap` repeats, and `fit` uniformly fits the advance width to the curve length.
Multiline baselines offset along the transported normal. Scrambling is seeded,
changes Unicode code points without changing final advances, and finishes on
the authored text. Spaces stay spaces.

`strokes(loops, progress)` writes by total contour arc length, including counters,
without joining separate contours. `outlineStrokes(run,time,options)` returns
world-space partial contours for line/ribbon/frame-splat drawing.

## SDF extrusion and materialisation

```js
const B = makeBuilder(1, palette), S = K.sculpt(makeSculpt(B));
const rig = K.rig(B, S);
const run = T.layout('FORM', { size: 2, align: 'center' });
const text = T.extrude(B, S, run, {
  id: 'title', rig, material: { r: [1,2,3] },
  position: [0,1,0], depth: .3, res: .045
});
S.bake();
const stage = K.stage(B.finish());
rig.bind(stage);
const binding = stage.add(text.bind(stage, {
  sample: t => T.pose(run,t,{position:[0,1,0],
    writeOn:{duration:1,stagger:.1}})
}));
const matter = stage.add(binding.materialise({ flow: K.flow.wind([1,.2,0]) }));
matter.release({ stagger: .5 });
matter.rejoin({ duration: 1.8 });
```

`extrude` adds native SDF solids and per-glyph rig tags **before bake**. It does
not change the scene to triangle meshes. `material(glyph)` can choose different
native materials. Reuse the scene's rig. Each `id` must be unique within it.
After baking, `text.ids` and `text.parts` expose the original carrier IDs and
native part IDs for scene hierarchy, sockets, inspection and destruction.

Bind after the rig, and add materialisation after the text binding. Transform,
covariance, paint, and geometry ownership use existing native systems. The
write-on binding precomputes each splat's nearest contour-distance coordinate;
runtime updates change coverage without rebaking. Exactly zero and one restore
fully hidden and fully covered text. This fill reveal is a nearest-contour
approximation; `outlineStrokes` gives the exact advancing pen contour.

SDF topology is fixed after baking: use sprite text for live scrambling, or
create/rebake another SDF run when the actual glyphs change. A binding returns
`inspect()` and `materialise(options)`, the latter delegating directly to
the comprehensive [surface materialisation](materialisation.md) system.

## Crisp sprite text

```js
const atlasBuilder = SpriteSurface.make(1024);
const run = T.layout('MAKE IT MOVE', { font:T.fonts.bitmap(), size:.25 });
const text = T.sprites(atlasBuilder,run,{
  pixelsPerEm:8, color:0xffcc88,
  scrambleChars:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
});
const atlas = atlasBuilder.finish();
world.spriteSurfaces = atlas;
stage.add(text.bind(atlas,{sample:t=>T.pose(run,t,{scramble:{duration:1}})}));
```

One nearest-sampled, depth-tested quad per glyph. Pixels-per-em equal to bitmap
font em height preserve exact pixels. Outline fonts can also be rasterized at
any specified resolution with `raster(font,char,{pixelsPerEm,padding,samples})`;
the standalone result includes RGBA and baseline-relative design-unit bounds.
Sprite text uses binary nearest-sampled coverage. Its write-on crops each quad
left to right, and zero opacity hides it; fractional glyph opacity is not
supported by the binary atlas surface renderer. SDF text supports fractional
opacity through its splat painter.

Reserve every possible scrambling character before `finish()`. Dynamic glyph
transforms and substitutions update only changed vertex ranges/UVs through the
existing atlas revision mechanism. They do not rebuild textures. Other atlas
content remains intact. The same run/frame data can drive custom renderers.

## Inspect from the CLI

```json
{
  "text": "AVATAR",
  "font": "sans",
  "layout": { "size": 2, "align": "center" },
  "animation": { "writeOn": { "duration": 1, "stagger": 0.1 } }
}
```

`ink-studio typography type.json --at .6` reports font metrics, baselines,
advances, outline counts and the exact animated glyph poses. `--font font.ttf`
imports a font relative to the JSON file; `fontFile` also works inside it.
`font` may be `sans`, `bitmap` or a portable outline definition; `path` accepts
an existing curve-family definition. `--out report.json` saves the result.
