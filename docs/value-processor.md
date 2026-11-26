# Value Processor

Use `fn.valueProcessor` to evaluate a uniform formula and return named graph values. Compute several results from the same inputs and intermediate values, then wire each result to its consumers. A formula can drive dimensions, comparison scores, ranges, directions, or other value inputs. It can also run inside a declared function graph.

## Derive a native extent

This formula rounds a requested width down to an eight-pixel boundary and returns both the width and an XY extent.

```json
{
  "format": "ink-studio/value-processor",
  "version": 1,
  "precision": "f32",
  "parameters": {
    "requested": { "type": "i32", "default": 139 }
  },
  "outputs": {
    "width": { "type": "i32", "port": "pixelCount" },
    "extent": { "type": "vec2", "port": "pixels" }
  },
  "body": [
    { "let": "whole", "value": ["div", ["param", "requested"], ["i32", 8]] },
    { "let": "width", "value": ["mul", ["get", "whole"], ["i32", 8]] }
  ],
  "result": {
    "width": ["get", "width"],
    "extent": ["vec2", ["toF32", ["get", "width"]], 96]
  }
}
```

Provide this document as the node's literal `program` input. The `requested` socket accepts a graph integer, and the `width` output can feed a pixel count on an image generator or raster canvas. For a formula with no statements, omit `body` and write the expressions in `result`.

## Value types

Declare each parameter with `type` and an optional `default`. An output can use the type name directly, such as `"direction": "vec2"`, or declare a compatible graph port with `{ "type": "i32", "port": "pixelCount" }`. The graph validates that port's domain on every evaluation. A `pixelCount` value must be positive and a `unitScalar` value must lie between zero and one.

| Program type | Default graph port | Additional graph ports |
| --- | --- | --- |
| `f32` | `number` | `unitScalar`, `seconds` |
| `i32` | `integer` | `pixelCount`, `frames` |
| `bool` | `boolean` | |
| `vec2` | `vec2` | `pixels`, `uv` |
| `vec3` | `vec3` | `worldPosition` |
| `vec4` | `vec4` | |

Use a `vec2` for paired values such as `[minimum, maximum]`. Write each output expression once, using an expression with the declared program type. Values can be linked, inspected, and saved in an editable material.

## Evaluate a formula

The Value Processor uses the [Pixel Processor expression and control language](pixel-processor.md#expressions-and-control-flow) for scalar and vector arithmetic, comparisons, `let`, `set`, `if`, and bounded `for`. Use parameters for values supplied by the graph. The uniform system expressions `["time"]` and `["seed"]` read evaluation time in seconds and the effective project's signed 32-bit seed. The formula runs as a single value computation with up to 32 parameters, 16 results, and an 8,192-unit static work bound. Use the Pixel Processor for per-texel coordinates and image sampling.

```js
const plan = KIT.procedural.valueProcessor.compile(program);
const values = plan.run({ parameters: { requested: 150 } });
// { width: 144, extent: [144, 96] }
```

## Meridian demo

```sh
node examples/value-processor/demo.cjs /tmp/ink-meridian
open /tmp/ink-meridian/index.html
```

Meridian derives a 144 × 128 canvas from its default requested width. Turn the compass needle or click the dial to set a heading. The heading vector places the marker, the target range places two pips, and the alignment score changes the needle's finish. Change the formula in the browser and save the resulting material to replay it in the CLI.

```sh
ink-studio graph inspect /tmp/ink-meridian/meridian.material.json --node solve --port direction
ink-studio graph run /tmp/ink-meridian/meridian.material.json --out /tmp/ink-meridian-render
```
