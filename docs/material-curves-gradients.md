# Material curves and gradients

The typed transfer nodes work directly on the material image contract. Author a transfer as a serializable record, expose it as a graph parameter, or wire a preset into it. The Copper Tide editor shows how to drag named stops, change cubic handles and ramp pins, and save the edited graph.

| Node | Role |
| --- | --- |
| `image.curve` | Apply a scalar transfer to a numeric plane or to all or selected RGB channels of a typed color image. |
| `image.transferPreset` | Return a fresh curve or ramp from a named preset, alongside its kind and label. |
| `image.gradient` | Sample a ramp into a typed RGBA image along the UV segment `options.from` to `options.to` at native pixel centers. |
| `image.gradientMap` | Drive a ramp from a typed scalar plane, or from color luminance, `r`, `g`, `b`, or `alpha`. |
| `image.gradientFromImage` | Sample a typed color image along a UV polyline to create editable gradient pins. |

## Stops, handles and addressing

A stop has an `at` coordinate, a `value` and an optional stable `id`. Order the stops by strictly increasing input coordinate. Existing two-element pairs such as `[0.5, 0.35]` still work. Use 2–256 stops.

```json
{
  "interpolation": "bezier",
  "address": "clamp",
  "stops": [
    { "id": "shadow", "at": 0, "value": 0.08, "out": [0.18, 0.08] },
    { "id": "light", "at": 1, "value": 0.92, "in": [0.72, 0.96] }
  ]
}
```

Choose `step`, `linear`, `smooth`, or `bezier` globally. A stop can override the outgoing segment with its own `interpolation`. Smooth uses smoothstep. Bézier uses an outgoing `out: [x,y]` handle on the left and the incoming `in: [x,y]` handle on the right. Handle X coordinates stay inside the segment in order. A curve handle Y uses the output’s numeric units, and a ramp handle Y is a color mix weight from zero to one. Missing handles use linear defaults. Sampling a stop returns its authored value, subject to premultiplied ramp interpolation at zero coverage.

Clamp holds the first or last value outside the transfer. Repeat wraps the interval from first to last stop, with the last coordinate wrapping to the first. The built-ins are `linear`, `soft-contrast`, and `lifted-ink` for curves and `copper-tide`, `silver-mist`, and `night-signal` for ramps. Each load gives an editable copy.

Curves apply to decoded values and preserve precision, color encoding, and alpha association by default. Choose `options.channel` as `all`, `r`, `g`, or `b` for color, and `value` or `all` for scalar images. `options.precision` chooses a destination precision and `outOfRange: "error"` detects clipping to bounded storage.

## Ramp color and image sampling

Ramp pins accept a hex RGB swatch or a numeric RGB(A) tuple in the ramp’s `colorSpace`. The default space is sRGB. Linear floating tags allow signed and HDR RGB. Set `interpolationSpace: "linear"` to blend in linear light or use the default `native` to blend in the tagged space. The ramp associates the RGB with alpha while interpolating, then returns straight RGBA. The default output precision of gradient and gradient map is float64. An explicit bounded target rejects out-of-range samples unless `outOfRange: "clamp"` is set.

Gradient map normalizes the selected source channel using `options.range` and uses the ramp’s addressing policy. Color luminance is linear Rec. 709. The output retains image alignment, uses the ramp’s color space, and multiplies ramp coverage by source alpha.

Image extraction takes a `path` of 2–32 points and a `count` of 2–256 pins. The pins are spaced evenly along the path in source pixel space. The sampler uses the image’s nearest or linear filter by default. Override it using `options.filter`. UVs cover the bounds of the image and clamp at the border. The resulting transfer retains the source color tag and is editable regardless of extraction count.

## Copper Tide demo

```sh
node examples/typed-material-curves/demo.cjs /tmp/ink-copper-tide
ink-studio graph run /tmp/ink-copper-tide/copper-tide.material.json --out /tmp/ink-copper-tide/replay
```

Open `index.html` to edit the curve and ramp, sample a new ramp from the reference artwork, and save a graph with your changes.
