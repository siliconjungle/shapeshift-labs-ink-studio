# Variables and execution control

Use local bindings for intermediate values and declared functions for stages that run in order, conditionally, or repeatedly. The graph runner, browser toolkit, and saved material graphs use the same operators.

## Local variables

`fn.scope` declares a literal map of variable names to value types. Each name creates an initialization socket of the declared type. To inherit bindings, supply a `parent` scope. A child binding with the same name shadows its parent.

`fn.get` reads a variable given a scope, literal name, and declared `type`. `fn.set` takes the same fields plus the new `value`. It updates the nearest binding and returns a new scope. Wire that output wherever the new value should be visible. Earlier scope outputs retain their original values and can be inspected.

```json
{
  "start": {
    "op": "fn.scope",
    "inputs": { "variables": { "charge": "number" }, "charge": 12 }
  },
  "write": {
    "op": "fn.set", "type": "number",
    "inputs": { "scope": { "node": "start" }, "name": "charge", "value": 24 }
  },
  "read": {
    "op": "fn.get", "type": "number",
    "inputs": { "scope": { "node": "write" }, "name": "charge" }
  }
}
```

A scope has type `functionLocals` and can be a function parameter or result. The bindings can use the numeric, vector, color, unit scalar, Boolean, and string types supported by [function graphs](reusable-function-graphs.md). Each frame can have up to 32 bindings, with up to 16 nested frames.

## Branches, sequences, and loops

| Operator | Authoring | Outputs |
| --- | --- | --- |
| `fn.branch` | Set `whenTrue` and `whenFalse` to literal names of declared functions with matching contracts. Connect their shared arguments and the Boolean `condition`. Only the selected function runs. | `value`, `taken` |
| `fn.sequence` | List one to 64 literal function names in `steps`. Each stage takes `state` and returns that same type. Connect the initial state to `initial`. Additional arguments are shared by the stages. | `value` |
| `fn.loop` | Set the body as the node's `group`. Connect `initial` and integer `count`. The body takes `state` and returns that type. If the body declares an integer `index`, the loop supplies it starting at zero. | `value`, `iterations` |

A sequence's stage order is the order of the names in `steps`. A loop returns the initial value when `count` is zero. The authored `limit` defaults to 64 and accepts 1 through 1024. A negative count or a count above the limit raises an error. The optional `while` input names a Boolean function with the body's input contract. It sees the current state and index before each iteration, and a false result exits the loop. Nested control calls share an evaluation work budget.

In the graph inspector, a branch shows the selected function's nodes. A sequence shows the final stage and a loop shows its last completed body invocation. The graph plan lists the referenced function paths.

## System values

Read the evaluation environment with `fn.system`. The literal `name` picks the variable.

| Name | Type | Meaning |
| --- | --- | --- |
| `position` | `vec2` | Caller-supplied XY sample position. Defaults to `[0, 0]`. |
| `size` | `vec2` | Width and height in pixels. Uses the effective shared material extent when present and defaults to `[1, 1]`. |
| `time` | `number` | Current graph evaluation time in seconds. |
| `seed` | `integer` | Effective seed of the graph evaluation. |
| `context` | Declared node `type` | Named value looked up using the `key` socket. The value must satisfy the declared type. |

`fn.withSystem` calls a declared function using its node `group`. Supply a `position`, positive whole-pixel `size`, and an optional context record with up to 64 named values. The context extends the caller's context for that call and its descendants. The graph time and seed propagate through nested calls. System values outside the call keep their previous values.

## Last Light demo

Build the browser demo and editable material from the repository root.

```sh
node examples/function-control/demo.cjs /tmp/ink-last-light
open /tmp/ink-last-light/index.html
```

The beacon starts with 12 units of charge. The sequence primes it to 22.5. Choose Storm warning to switch branch, add 12 units, and light the amber beam. With the default gain and target, the harbor circuit takes six turns and the storm circuit takes four. You can change the requested turns, move the meter on the canvas, and adjust the time and seed that drive the light pulse. Save the material to preserve the current settings. Inspect individual stages with the CLI.

```sh
ink-studio graph inspect /tmp/ink-last-light/last-light.material.json --node turns/previous
ink-studio graph run /tmp/ink-last-light/last-light.material.json --out /tmp/ink-last-light-render
```
