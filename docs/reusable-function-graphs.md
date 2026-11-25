# Reusable function graphs

A function graph is a typed value subgraph with one declared result. Call it from a material or another function, wire its result to a compatible input, and inspect the values evaluated inside each call. Function definitions can live inside an editable material or in a versioned, optionally pinned graph-group file.

## Define a function

Set the graph scope's `result` to its result type and wire `outputs.result` to the returned value. Use normal graph inputs and links. The caller connects to the port named `result`.

```json
{
  "result": "number",
  "inputs": {
    "temperature": "number",
    "knee": { "type": "number", "default": 0.24 }
  },
  "nodes": {
    "firing": {
      "op": "fn.math",
      "type": "number",
      "inputs": {
        "operation": "smoothstep",
        "a": { "input": "temperature" },
        "min": { "input": "knee" },
        "max": 0.91
      }
    }
  },
  "outputs": { "result": { "node": "firing" } }
}
```

Add that body under `groups.firingCurve` in a graph project. Call the function with `{"op":"firingCurve","inputs":{"temperature":0.7}}` and link its `result` output. A root graph can also declare a result directly. In an editable material file, the declaration lives on the graph scope beside its normal output table and stable links.

Function inputs and results support finite `number`, signed safe `integer`, normalized `unitScalar`, `vec2`, `vec3`, `vec4`, display `srgb`, linear `srgb-linear`, `boolean`, and `string`. Vectors are fixed-length JSON tuples. Colors are three-channel RGB or straight RGBA. RGB components of a linear color can exceed the display range. A linked integer can feed a numeric input. Use `fn.toInteger` or an [explicit cast](vector-operations.md#explicit-casts) to convert a number into an integer.

A function body uses typed values, the value operations below, and calls to other functions with declared results. It takes all its state through its arguments. The compiler validates the result link, disallows animated bindings and effect operations inside the body, and rejects cycles. Use caller-side animation inputs to supply values that change over time.

## Value nodes

Set a literal `inputs.operation` where an operation is needed. Declare `type` on the node when it selects an overload. The standard graph catalog shows an example and its typed sockets.

| Node | Operations |
| --- | --- |
| `data.typed` | Put a typed constant on the graph. Its value can also be wired from a compatible input. |
| `fn.math` | Add, subtract, multiply, divide, remainder, min, max, power, negate, abs, and clamp. Numbers also support floor, ceil, round, sqrt, sin, cos, tan, exp, log, atan2, lerp, and smoothstep. |
| `fn.toInteger` | Convert a number using exact, floor, ceil, round, or trunc. |
| `fn.vector` | [Vector construction, component routing, overloads, and math](vector-operations.md). |
| `fn.cast` | Explicit conversion between numeric and Boolean types. |
| `fn.color` | Compose RGBA, convert between display and linear sRGB, mix, read a component, or compute linear Rec. 709 luminance. |
| `fn.compare` | Exact equality and inequality for every value type. Order comparisons support numbers, integers, and strings. |
| `fn.logic` | Boolean and, or, xor, and not. |
| `fn.select` | Return either of two typed values according to a Boolean. The graph evaluates both value branches before selection. |
| `fn.text` | Concatenate, count UTF-16 code units, or look for a case-sensitive substring. |

Integer division truncates toward zero. Remainders keep the dividend's sign. Arithmetic rejects zero divisors, nonfinite results, and unsafe integer results. Trigonometry takes radians. Component indices start at zero. Color mixing interpolates associated color in linear light, then returns the result in the declared space with straight alpha. Display conversion clamps to the display gamut.

## Publish, inspect, and try it

Use the existing [subgraph workflow](editable-material-graph.md#publish-and-edit-reusable-subgraphs) to publish a function and reference its file from other materials. The function's declared result type persists through publication, snapshots, and the subgraph inspector.

```sh
node examples/reusable-function-graphs/demo.cjs /tmp/ink-kiln-formula
ink-studio graph run /tmp/ink-kiln-formula/kiln-formula.material.json --out /tmp/ink-kiln-run
ink-studio graph inspect /tmp/ink-kiln-formula/kiln-formula.material.json --node jadeCall/mixWeight
```

Open the generated `index.html` to compare two calls to the same glaze function. Change the heat, oxygen, firing passes, or finish for one tile. Move the shared firing knee to change how both calls respond. The demo links to the editable material and the published function group.
