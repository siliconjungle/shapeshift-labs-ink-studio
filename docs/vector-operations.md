# Vector operations and casts

Use `fn.vector` inside a function or directly in a material graph. Declare `type` as `vec2`, `vec3`, or `vec4` and set a literal `inputs.operation`. The declared dimension specializes the ports. Each component is a finite number.

| Task | Operation and ports |
| --- | --- |
| Build a vector from components | `compose` uses `x`, `y`, and the remaining components appropriate to the dimension. |
| Repeat a scalar | `splat` fills every component with `a`. |
| Join scalars and vectors | `append` joins `a` followed by `b`. The inputs must add up to the declared dimension. |
| Read a component by index | `component` reads `a` at zero-based integer `index` and returns a number. |
| Reorder and repeat components | `swizzle` reads the components in the literal `pattern` from `a`. |
| Work component by component | `add`, `subtract`, `multiply`, `divide`, `min`, `max`, `modulo`, and `power` support vector/vector, vector/scalar, and scalar/vector operands. |
| Measure and orient vectors | `dot`, `length`, and `distance` return numbers. `normalize`, `project`, and `reflect` return vectors. Cross product is available for `vec3`. |
| Modify or interpolate | `scale` uses a scalar `factor`. `abs`, `negate`, and `clamp` apply component by component. `lerp` uses a scalar `t` from zero to one. |

`project` projects `a` onto the direction of `b`. `reflect` uses `b` as the normal of the reflecting plane. These operations and `normalize` require a nonzero direction. Division rejects a zero in any divisor component.

## Swizzles and overloads

A swizzle uses one alphabet from `xyzw`, `rgba`, or `stpq`. Components can repeat. Reading a component past the input dimension is a compile-time error. One character returns a number. Two through four characters return the corresponding vector dimension. For example, swizzling a `vec4` with `"yxww"` returns `[y, x, w, w]`.

Use the literal pair `inputs.operands` to select the types of `a` and `b`. When omitted, component math uses two vectors of the declared type. `append` defaults to the dimension immediately below the declared result followed by a scalar. For `vec2`, that means two scalars. For `vec4`, you can also choose `["vec2", "vec2"]` to join two pairs.

```json
{
  "op": "fn.vector",
  "type": "vec2",
  "inputs": {
    "operation": "subtract",
    "operands": ["number", "vec2"],
    "a": 4,
    "b": [1, 3]
  }
}
```

This returns `[3, 1]`. Scalar position matters for subtraction, division, remainder, and power. Swizzles and overloads specialize when the graph compiles, so those settings are literal values.

## Explicit casts

Use `fn.cast` with the destination in `type`, the literal source type in `inputs.from`, and a value in `inputs.a`. Supported types are `number` (floating point), `integer`, `boolean`, and `unitScalar`.

- Numeric zero converts to false. Every other finite numeric value converts to true.
- Boolean false and true convert to zero and one.
- `number` and `unitScalar` can narrow to a safe signed integer with `exact`, `floor`, `ceil`, `round`, or `trunc`. The default is `exact`. Round sends ties toward positive infinity.
- Casting to `unitScalar` requires a result in the range zero through one.

Existing `fn.toInteger` graphs use the same integer rounding rules.

## Signal Press demo

```sh
node examples/vector-operations/demo.cjs /tmp/ink-signal-press
ink-studio graph run /tmp/ink-signal-press/signal-press.material.json --out /tmp/ink-signal-replay
```

Open the generated `index.html`. Switch from `XY` to `YX` to redirect the stamp's stretch and rotation. Change the rounding rule near a fractional cell count to see the actual repeat grid resize. Set the rim signal to zero to remove the inlay. Save an editable graph with those changes.
