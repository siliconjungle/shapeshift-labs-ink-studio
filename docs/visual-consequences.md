# Persistent visual consequences

Ink can turn the current state of a named site into evidence on its modeled surfaces. A kiln leaves scorch on its floor. A construction refit changes the bridge geometry and leaves a pale repair seam. Visits deepen wear along a trail. The marks follow committed state in each branch and survive checkpoint reload, even with general event history disabled.

Attach rules to `visual.consequences` in a simulation world. They project into the active renderer whenever the world is built. The projection is read-only. Commands, story outcomes, physical construction and terrain wear still run through their existing systems.

## From a saved state to a render

```sh
node examples/visual-consequences/demo.cjs /tmp/clay-crossing-review

ink-studio sim render /tmp/clay-crossing-review/repaired.checkpoint.json --out crossing.png
ink-studio sim render /tmp/clay-crossing-review/repaired.checkpoint.json --consequences off --out crossing-bare.png
ink-studio beat 'ink:beat:clay-crossing/repaired/12.0' crossing-consequences.json /tmp/clay-crossing-review/recorded-evidence.json
```

The `-consequences.json` sidecar identifies every active rule, matched value, opacity, resulting sample count and recorded state change. It includes the original cause and visit links when the ledger has them. A zero-sample rule reports `no-surface` if the projection missed a receiving surface, or `missing-location` if an entity anchor could not be resolved. `--consequences off` gives a matched geometry render with consequence paint hidden. Shot recipes include the sidecar in their reproducibility checks.

The demo forks one checkpoint into three outcomes. One leaves the deck damaged. One refits the deck and keeps the burned floor. One also resurfaces the floor. The old scorch rule stops matching on that branch. The archived cause lookup files join the displayed paint back to its source envelopes.

## Author rules from durable records

Use a site and either a typed site state field or `visits: true`. A state rule activates after the named field has a committed receipt. An initial value alone leaves the authored base scene visible. `when` tests that field’s current value, or the visit count for a visit rule. An optional numeric `range: [low, high]` maps a measured value to a clamped opacity multiplier.

```json
{
  "version": 1,
  "rules": {
    "kiln-char": {
      "site": "crossing/kiln",
      "field": "finish",
      "when": { "value": "scorched" },
      "paint": {
        "kind": "imprint",
        "pattern": "soot",
        "select": { "entity": "floor" },
        "normal": [0, 1, 0],
        "length": 1.38,
        "width": 0.97,
        "color": [1, 2, 19]
      }
    },
    "worn-trail": {
      "site": "crossing/trail",
      "visits": true,
      "range": [0, 5],
      "paint": {
        "kind": "trail",
        "path": [[-4, 0, 2], [-2, 0, 1.8], [-1, 0, 0.4]],
        "select": { "surface": "terrain" },
        "width": 0.47,
        "color": [19, 20, 21]
      }
    }
  }
}
```

Use the ordinary site actions in the run. An event action can bind the triggering event ID to `world/change-site` or `world/visit-site` as its `source`. Physical systems or a story transition can supply the trigger. A change receipt persists with the field’s current state when older site history is evicted. For visit rules the total and last visit ID persist through eviction. Inspect the recording for visit details that have aged out of the checkpoint. [Site history and receipts](headless-worlds.md#carry-site-history-between-visits)

- **Imprint.** Use `soot`, `repair`, `tide-line` or `scuff`. Resolve the center from the site’s XYZ or current entity/socket. An explicit world-space `point` overrides the site location. Control the length, width, heading and outward normal.
- **Trail.** Supply two or more world-space XYZ points along the route. The projector follows that polyline onto receiving geometry. The visit count controls the paint opacity, and the authored path supplies its spatial footprint.
- **Both.** Use `color` as a palette slot or a list of slots, `opacity` as a base multiplier, `select` to scope a receiver, `reach` to limit projection distance, and `spacing` to adjust sample density. Consequence paint projects onto retained solid SDF surfaces. Narrow rules to the surface of interest on stacked geometry.

There are up to 32 rules. The renderer projects marks against the current geometry, so each rule can still resolve when a site reloads or a compatible surface returns. Counts, causal IDs and state stay in the simulation checkpoint. The renderer derives decal positions from that state as needed.

## Library and graphs

`KIT.world.visual(kit, view, query)` includes the report as `scene.visualConsequences` when rules are authored. Pass `{ visualConsequences: false }` as the fourth argument for a matched clean render. Transient mark sheets supplied through `eventEffects` can appear in the same frame.

A graph can use the same recorded state through `sim.world` with a named `world/site-history` query and feed its state or visit count into other presentation systems. [World graph ports](simulation-output-adapters.md) · [Surface mark projection](caused-marks.md) · [Event-driven visual effects](event-visual-effects.md)
