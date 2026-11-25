# Split, shuffle, and pack typed image channels

Use these nodes while building a material graph. Their images can feed another stage, be inspected independently, or be exported through the graph’s existing delivery settings.

| Node | Inputs and result |
| --- | --- |
| `image.split` | Send a typed `source` and a literal `channels` record. The keys become output ports. For example, `{"red":"r","coverage":"alpha"}` adds two scalar outputs. |
| `image.shuffle` | Send a typed `source` and one to four ordered `routes`. For example, `["b",{"channel":0},0.25,"alpha"]` routes blue, red, a constant, and coverage to four output slots. |
| `image.pack` | Collect named inputs with `data.record` and supply one to four routes. A route such as `{"source":"roughness","channel":"r"}` can select any available channel. Bare numbers supply constants. |
| `image.channelMath` | Send a numeric image `a`, a number or numeric image `b`, and an `operation`. A scalar image broadcasts across the channels of `a`. |

Channel selectors take layout letters such as `r` or `x`, and indices starting at zero. Use `"alpha"` for declared coverage. A numeric fourth slot named `a` remains an ordinary data channel when the image declares no alpha. A missing channel is an error. Use the constant `1` to supply opaque coverage when needed.

Split copies native samples at the original precision. The coverage output has mask intent. Color channel outputs carry the stored values, including premultiplied RGB if the source uses that encoding. Use `image.convert` with `alpha: "straight"` on the color image before splitting to obtain unassociated RGB. To associate it again, pack straight RGBA and use `image.convert` with `alpha: "premultiplied"`. A zero-coverage premultiplied image stores zero RGB, so later unassociation keeps those texels black.

## Routing and encoding

Shuffle and Pack default to a data image with layout inferred from the number of routes. Supply a literal `descriptor` containing `intent` and any of `layout`, `precision`, `units`, `colorSpace`, or `alpha` to control the result. Packing color channels into RGB requires the source channels to already use the destination color space and association. Use `image.convert` for appearance-preserving conversion. Routing raw split planes into a color destination interprets the planes according to the author’s explicit destination descriptor.

The first routed source supplies the extent, pivot, pixel pitch, tiling, sampling, and seed. Other routed images must match its extent, pivot, pitch, tiling, and sampling. A constant-only route list takes its grid from the first input image. For mixed source units, explicitly choose the output units.

If all sources share a precision, the output uses it. Mixing 8-bit and 16-bit normalized inputs uses 16-bit precision. Other mixed precision inputs use float64. Constants use decoded values, so `0.5` is half intensity at either UNORM width. Choose the destination precision explicitly to support signed, HDR, or between-code constant values. Invalid samples produce an error.

## Channel math and delivery

`image.channelMath` supports `add`, `subtract`, `multiply`, `divide`, `min`, `max`, `difference`, `power`, `greater`, `less`, and `equal`. It works on aligned data, mask, and height samples without alpha association and carries the left image’s contract. Image arithmetic uses the stored sample meanings and units authored by the graph.

Operations decode unsigned normalized samples to the unit range, then compute and store in float64 by default. For example, code `30001` in a UNORM16 plate plus one quarter of a code delivers `30001.25 / 65535`. An explicit `options.precision: "unorm16"` rounds the final value once. Set `options.outOfRange: "clamp"` to allow bounded output clipping. Nonfinite arithmetic, including division by zero, produces an error.

## Signal Dial demo

```sh
node examples/typed-image-channels/demo.cjs /tmp/ink-signal-dial
ink-studio graph run /tmp/ink-signal-dial/signal-dial.material.json --out /tmp/ink-signal-dial/replay
```

Open the generated `index.html` to change every slot, shuffle red and blue, and inspect straight or premultiplied HDR samples alongside the split alpha. The editable graph exports the packed map and separate sample planes as JSON.
