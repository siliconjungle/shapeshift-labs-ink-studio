# Pixel Processor

Use `image.pixelProcessor` to write a material operation that runs once per output texel. The literal `program` defines its resource inputs, parameter inputs, and image outputs. You can wire those sockets to other material nodes and save the program in an editable material. Ink compiles the same document for the graph's CPU evaluator and WebGPU.

## A minimal program

This program reads a height map at the current output texel and scales it. The height input and output both declare binary32 storage in art pixels.

```json
{
  "format": "ink-studio/pixel-processor",
  "version": 1,
  "precision": "f32",
  "resources": {
    "relief": { "intent": "height", "layout": "r", "precision": "float32", "units": "art-px" }
  },
  "parameters": {
    "gain": { "type": "f32", "default": 0.75 }
  },
  "outputs": {
    "value": {
      "descriptor": { "intent": "height", "layout": "r", "precision": "float32", "units": "art-px" }
    }
  },
  "body": [
    { "let": "base", "type": "f32", "value": ["load", "relief", ["x"], ["y"]] }
  ],
  "result": { "value": ["mul", ["get", "base"], ["param", "gain"]] }
}
```

Supply `width`, `height`, and the named resources and parameters on the graph node. The document can also run directly with `KIT.procedural.pixelProcessor.compile(program).run(request)`. In that API, `request` contains `width`, `height`, a `resources` record of typed images, a `parameters` record, and optional `time` and `seed`.

## Values and images

| Item | Contract |
| --- | --- |
| Compute precision | `f32` for floats, signed 32-bit integers for coordinates and counts, and Boolean for conditions. Numeric JSON literals are floats. Write `["i32", 2]` for an integer. |
| Vectors | `vec2`, `vec3`, and `vec4` of `f32`. Construct from float lanes and read a lane with `["component", vector, 0]`. |
| Parameters | Declare a type and optional default for each parameter. Read it with `["param", "gain"]`. Types are `f32`, `i32`, `bool`, and the three vector sizes. |
| System values | `["x"]`, `["y"]`, `["width"]`, and `["height"]` are integers. `["u"]` and `["v"]` are normalized output texel centers from the top-left edge. `["time"]` reads graph seconds. `["seed"]` reads the low signed 32 bits of the effective project seed. |
| Image contract | Declare intent, layout, and precision. Color also declares color space. Source format, units, channel layout, and alpha convention must match. Use Ink's image conversion nodes where you need a different encoding. |
| Image storage | `unorm8`, `unorm16`, and `float32`. Integer storage is decoded to normalized float lanes. Float storage retains its numeric values. Color space and alpha association remain as authored when sampling. |
| Load | `["load", "relief", x, y]` accepts integer source coordinates. Address modes are clamp, wrap, mirror, and transparent, independently per axis. Transparent reads return zero lanes. |
| Sample | `["sample", "relief", uv]` accepts top-left normalized coordinates on the source grid and uses the resource descriptor's nearest or linear filter. Linear sampling blends stored color and alpha lanes independently. Use premultiplied input for coverage-weighted filtering. |
| Result | Every output has exactly one result expression. A single channel takes a float, and two through four channels take the corresponding vector. Choose `outOfRange: "error"` (default) or `"clamp"` per output for finite values outside its storage contract. |

The resource declaration controls addressing and filtering. You can bind inputs of different dimensions and sample them in their own coordinate systems. The image types and encodings follow Ink's [typed image contracts](graph-image-types.md).

## Expressions and control flow

Use `["get", "variable"]` to read a local. A `let` declaration creates a typed local from its initializer. Provide `type` to check the initializer against an explicit type. A `set` statement updates the nearest local with the same type. An `if` statement takes a Boolean and evaluates the chosen statement list. Branch locals are scoped to that list.

```json
{
  "for": "tap",
  "count": ["param", "reach"],
  "limit": 8,
  "body": [
    {
      "set": "peak",
      "value": ["max", ["get", "peak"], ["load", "relief", ["add", ["x"], ["get", "tap"]], ["y"]]]
    }
  ]
}
```

A loop evaluates its integer count once per texel and caps it between zero and its literal limit of 1 through 64. The index starts at zero and is read-only. Nested loops are included in the static work estimate. Each texel owns its locals, can read the bound inputs, and writes its own result pixel.

- `add`, `sub`, `mul`, `min`, and `max` accept two values of the same numeric type. They work lane by lane on vectors.
- `div` divides scalar floats or integers. Integer division truncates toward zero. `mod` returns a signed integer remainder. Both operations return zero for a zero divisor. Integer arithmetic wraps at 32 bits.
- `abs`, `floor`, `ceil`, `fract`, `sin`, and `cos` accept floats or vectors. `neg` and `sqrt` accept scalar floats. Square root clamps its input at zero.
- `clamp` takes one float and two float bounds. `mix` accepts floats or equal-size vectors and a float factor. `dot` returns the dot product of two equal-size vectors.
- `toF32` and `toI32` convert between numeric scalar types. Conversion to an integer clamps to the representable range and truncates toward zero.
- `eq`, `ne`, `lt`, `le`, `gt`, and `ge` compare matching numeric scalars. `eq` and `ne` also accept Booleans. `and`, `or`, and `not` work on Booleans.
- `["select", condition, a, b]` accepts a Boolean and matching value types. Both value expressions are evaluated. Use a statement `if` to evaluate a single branch.

Keep floating-point values and intermediates finite. A program can have up to eight resources, 32 parameters, four outputs, 1,024 syntax nodes, and 8,192 work units per texel. A dispatch allows up to 16,777,216 input and output samples each, with an additional 100-million-unit work limit. The compiler exposes its estimated cost as `plan.report.workPerTexel`.

## Compare CPU and WebGPU

```js
import { createWebGPUPixelProcessor } from './webgpu.mjs';

const plan = KIT.procedural.pixelProcessor.compile(program);
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const processor = createWebGPUPixelProcessor(device, plan);
try {
  const { cpu, gpu, report } = await processor.compare({
    width: 112,
    height: 96,
    resources: { relief },
    parameters: { gain: .8 }
  }, { absolute: 1e-6, relative: 1e-5 });
  console.log(report.outputs.value, cpu.value, gpu.value);
} finally {
  processor.dispose();
  device.destroy();
}
```

Comparison measures the raw `f32` samples before encoding. It reports maximum and RMS error, the first sample outside tolerance, the worst texel and lane, and how many encoded samples changed. Float results within tolerance can still land on either side of a storage rounding threshold. Use the stored sample count when exact quantized agreement matters. [WGSL floating-point evaluation](https://www.w3.org/TR/WGSL/#floating-point-evaluation)

The WebGPU executor reuses its pipeline as you change values on the same layout. It publishes the same typed image format as the CPU evaluator. The caller owns the WebGPU device.

## Copperwake demo

```sh
node examples/pixel-processor/demo.cjs /tmp/ink-copperwake
open /tmp/ink-copperwake/index.html
```

Change Search radius to grow the area the oxidation program reads around each texel. Select Relief input, Oxide output, or Stored difference and click the image to inspect a texel. Edit the program and apply it to try a new operation. Save Material downloads the current program, source graph, and parameters together. The CPU preview also runs in browsers without a WebGPU device.

```sh
ink-studio graph run /tmp/ink-copperwake/copperwake.material.json --out /tmp/ink-copperwake-replay
ink-studio graph describe image.pixelProcessor --example
```

Use [Value Processor](value-processor.md) for uniform formulas with named value outputs.
