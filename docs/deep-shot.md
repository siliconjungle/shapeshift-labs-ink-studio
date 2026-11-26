# Headless deep shot compositing

Edit Ink's native deep point samples before flattening a shot. The
headless CLI imports camera plates, aligned takes, or RGBA image cards
at declared depths. It publishes a new deep sequence and a display PNG
for each frame.

```sh
ink-studio deep-shot inspect camera.exr --pixel 104,66
ink-studio deep-shot operators
ink-studio deep-shot run prism-relay.shot.json --out composite
```

Inspection reports sample counts, calibrated camera and per-pixel
samples with front-to-back depth, alpha, visible coverage, linear
premultiplied RGB, and named IDs. Coordinates are top-down art pixels.

## Register a shot

```json
{
  "format": "ink-studio/deep-shot",
  "version": 1,
  "reference": "camera",
  "working": "display-p3-linear",
  "display": {"space": "srgb", "outOfRange": "clamp"},
  "clock": {"tolerance": 0.01},
  "inputs": [
    {"id": "camera", "file": "camera/deep.json"},
    {
      "id": "key",
      "kind": "card",
      "file": "cards.json",
      "offset": [63, 30],
      "timeOffset": -0.125,
      "depth": 6.1,
      "object": "prism service key",
      "material": "rose enamel"
    }
  ],
  "effects": [
    {
      "id": "recover-front",
      "operator": "opacity",
      "select": {"object": "teal front sheet"},
      "params": {"scale": 0.85}
    },
    {
      "id": "light-key",
      "operator": "color",
      "select": {"source": "key"},
      "color": {"input": "srgb-linear", "output": "srgb-linear"},
      "params": {"exposure": 0.16}
    }
  ]
}
```

- Paths are relative to the file declaring them. A deep input takes a
  native EXR or an exported `deep.json`. A `card` input takes a PNG or an
  `ink-studio/deep-shot-sequence` version 1 manifest with
  `frames: [{"file":"card.png","time":0.125}]`.
- The reference plate defines the art grid and camera. Set increasing
  `clock.times` in seconds or inherit the reference timestamps.
  Sequence frames align to the nearest time after `timeOffset`,
  within `clock.tolerance`. Ties select the earlier frame. A single
  file holds across the shot. The receipt includes selected times,
  residuals, and source hashes.
- By default, deep layers require a matching camera calibration and
  art grid. Set `alignment` to `registered` for plates you have already
  calibrated to the same rays and depth units with integer artwork
  translations and axial offsets. `offset` adds [X,Y] in art pixels.
  `depthOffset` adds world units along the positive camera axis.
  Both default to zero. Samples outside the reference grid are clipped.
  Cards use their declared depth in the reference camera. This
  workflow translates pixel addresses and depths. Camera changes
  require a replacement plate rendered for the reference camera.
- A ray can retain up to 16 samples after editing. If those do not
  fit, the run fails with the affected pixel. A source that already
  dropped samples requires `allowTruncated: true`. Its loss counts
  appear in the per-source receipt. The re-export carries upstream
  loss forward with a capped aggregate pixel count.
- Equal-depth samples retain input and sample order. Reference IDs
  remain intact. Additional plates share named IDs by label, while
  their unnamed numeric IDs receive source-qualified labels.

## Set color and edit samples

Native deep input and delivery use premultiplied linear sRGB. Select
`srgb-linear` or `display-p3-linear` as the working space. A card takes
straight normalized PNG codes and can declare its own `color` space.
This defaults to sRGB. Each operator runs on straight RGB with the
declared input and output color contracts, then returns to the linear
working space. The existing Ink color descriptor accepts `space`,
`range`, and `outOfRange`. PNG previews map to normalized sRGB with
explicit clamp or error behavior. Extended values remain in the deep
output. Capture-native surface, scatter, and transmission channels
preserve their original values for inspection.

| Operator | Parameters | Effect |
| --- | --- | --- |
| `trim` | None | Remove selected samples. |
| `opacity` | `scale` in [0,4] | Scale coverage and preserve straight RGB. |
| `depth` | `offset` | Move selected point samples before the ray is sorted. |
| `color` | `exposure`, `matrix`, `bias` | Apply the 3×3 matrix, exposure gain, then bias in declared coordinates. |
| `lut` | `table` | Sample an inline Ink RGB lookup table in declared coordinates. |

Effects run in order. Select any combination of `source`, `object`,
`material`, fragment `kind`, `depth: [near,far]`, and
`rect: [x,y,width,height]`. Object and material selectors accept
names or original numeric sample IDs. Depth selectors see the
current depth, including changes by earlier effects.

### Register a Node effect

Trusted Ink code can pass an `operators` record to `runDeepShot`.
A definition names a positive integer `version`, ASCII operator ID,
`description`, allowed parameter keys, and a
`prepare(params, {input, output})` function. Return a synchronous
function that edits the supplied sample and returns undefined. It can
read the source, object and material names and IDs, kind, and output
coordinates. Set `rgb`, `alpha`, `z`, or `drop` to edit the working
sample. Sample objects are reused. Define the extension in trusted
caller code and pass matching versions in the shot plan.

```js
ink.runDeepShot('prism-relay.shot.json', {
  out: 'composite',
  operators: {
    'warm-signal': {
      version: 1,
      description: 'Raise the red component of selected samples.',
      parameters: ['red'],
      prepare({ red }) {
        if (!Number.isFinite(red)) throw new TypeError('Expected a red offset');
        return sample => { sample.rgb[0] += red; };
      }
    }
  }
});
```

## Replay the demo

```sh
node examples/deep-shot-prism-relay.cjs prism-relay
ink-studio deep-shot run prism-relay/prism-relay.shot.json --out prism-replay
```

The demo exports a three-frame camera take. A separately timed
service key goes between the teal and amber plates. The probe
shows the retained order and edited coverage. Read `latest.json`
for the committed revision's deep manifest and receipt. Use that
deep manifest as a source for another shot. A failed run leaves
the previously published revision available.

The importer supports Ink's single-part native deep scanline plates
with sorted point samples. Reflected-camera captures can be used as
separate registered plates. Flattening uses front-to-back over on the
stored point colors. The live renderer handles refracted pixel routing,
continuous media intervals, and the screen look.
