# Painted shadow bands

Paint when an area crosses its diffuse ramp. Use positive bias to hold an
incision in shadow, negative bias to bring a broad face into the light sooner,
and zero to erase back to the original response. The surface still responds to
the animated finish light and uses the same authored palette swatches.
With the usual shadow visibility enabled, fully occluded areas stay on the
shadow stop.

## Paint a material

Add `shadowBand.strokes` to a named `diffuse` layer. A stroke is a swept
brush in the baked rest frame of that material. It can be a point or a path.
The radius is in scene units. Bias ranges from -1 to 1 in normalized light
response units. `softness` ranges from 0 for a hard edge to 1 for a brush
that feathers over its entire radius. It defaults to .16. Later strokes
replace earlier values under their solid cores and blend at their edges.

```js
const stone = KIT.surface.material({ r: [1, 2, 3, 4] }, {
  layers: {
    diffuse: {
      type: 'diffuse',
      lightingRamp: {
        role: 'stone', positions: [0, .38, .56, .78], interpolation: 'step'
      },
      shadowBand: {
        strokes: [
          { points: [[-.48, .35, .22], [.16, .31, .24]], radius: .07, bias: .25 },
          { points: [[.14, .54, .30]], radius: .18, bias: -.18, softness: .1 }
        ]
      }
    }
  }
});
```

Use scene palette roles or explicit stops as in
[material lighting ramps](surface-materials.md#material-lighting-ramps).
The brush shifts the lookup for that layer and leaves its mask, blend
strength, and ramp weights available for further art direction. The
headless renderer samples the paint on the surface using the material's
rest coordinates, including through skeletal posing. Add the same
`surface.layers` settings to a JSON solid's material.

In the [scene editor](scene-editor.md#brushes-and-local-rebuilds),
`editor.paintShadowBand(stroke, { layer, keys })` appends the stroke to the
chosen material layer. It uses `diffuse` and the current selection by default.
Undo and redo use the existing editor history. Hosts can also use
`KIT.surface.shadowBandPaint.prepare(strokes)(position)` to inspect the
signed bias field.

## The Marsh Gate

The left relief uses the original lighting and the right relief uses paint.
Both use the same motion and palette. The right wing enters the light as a
broader shape while thin marks hold the feather grooves in shadow. Open
the [brush workshop](../examples/painted-shadow-bands.html) to paint more
bias, scrub the lantern, toggle the paint, and export strokes as JSON.
The workshop evaluates this relief's diffuse ramp at its splat centers
for interactive WebGL preview. The headless export evaluates the surface
finish at render samples.

```sh
npm run build
python3 -m http.server 8000
# Visit /examples/painted-shadow-bands.html on the local server.
```

```sh
ink-studio clip examples/painted-shadow-bands.js --from 0 --to 4 --fps 12 \
  --w 384 --h 216 --px 1 --out marsh-gate.png
```

Use `--shadow-band-paint off` to bypass paint during headless rendering
while keeping the palette ramp and light. Junya Motomura shows how
*Guilty Gear Xrd* used artist-assigned threshold offsets in the
[GDC talk on its rendering](https://media.gdcvault.com/gdc2015/presentations/Motomura_Junya_GuiltyGearXrd.pdf#page=19).

## Paint the shade normal

Paint the normal when a cheek, sleeve, or fold needs to turn into the light
as a single shape. Add `shadeNormals.strokes` to a diffuse layer with a
lighting ramp. A stroke's XYZ normal points in the material's baked rest
frame. Its radius and softness behave like the threshold brush. Use
`strength` from 0 to 1 to blend toward the target, or `normal: null` to erase
toward the sculpted normal. Later strokes apply over earlier ones.

```js
const cheek = {
  type: 'diffuse',
  lightingRamp: { stops: [[0, '#663443'], [.45, '#ae6557'], [.72, '#e4a781']], interpolation: 'step' },
  shadeNormals: {
    strokes: [
      { points: [[-.31, 1.76, .49], [-.13, 1.61, .49]], radius: .14, normal: [-.9, -.3, .3] }
    ]
  }
};
editor.paintShadeNormal(cheek.shadeNormals.strokes[0], { layer: 'diffuse' });
```

The normal turns with the posed material. The diffuse ramp still uses light
visibility and any `shadowBand` bias. Geometry, specular lighting and
view-facing effects use their existing normals. The browser evaluates the
authored diffuse ramp on the posed splat carriers and gives it priority over
their baked pixel ramp. The software renderer evaluates it at surface samples.
Set `shadeNormals: false` in either renderer, or use
`--shade-normals off` from the CLI to compare with sculpted normals.

Open [Saltwind Courier](../examples/shade-normals/index.html) after building
the browser bundle. Sweep the light, orbit the courier, and paint either
direction on the cheek or cloak.
