# Shot lighting

A shot can carry one shaped key, fill, and rim light, and one negative-fill
control. Author them in `finish.shotLighting` in a JSON diorama, pass the
same record to `B.finish({ shotLighting })`, or load a version 1 settings file
for an individual render.

```sh
ink-studio render examples/courier-shot-lighting.js \
  --shot-lighting examples/courier-shot-lighting.json \
  --w 192 --h 144 --px 1 --raw --out courier.png
```

The courier example puts a warm key at the lantern and aims it at
`{ "surface": "courier-face" }`. Its cool fill and rim serve the courier.
The wall has its own negative fill. Set any role to `false` to mute it, or
use `--shot-lighting off` for the baked scene. `--recipe` records the
settings file as a shot dependency for replay.

| Role | Controls |
| --- | --- |
| `key`, `fill`, `rim` | Use the [shaped emitter settings](area-lights.md) for world-space position, aim, size, shape, colour, intensity, radius, cookies, sampling, and shadow steps. The key defaults to casting shadows. Set `shadows` on each role to choose. |
| `negativeFill` | Set world-space `at`, `radius`, and `strength` from 0 to 1. It reduces the existing surface light on normals facing the control and fades to zero at its radius. Positive shot roles can light the same surface independently. |

Use `receive: { "include": [...], "exclude": [...] }` on any role to select
which opaque surfaces it affects. Use the same mask under `cast` on a
positive role to scope the geometry that blocks that light. The selectors
accept existing object, surface, material, and tag IDs. Included selectors
are alternatives. Fields within a selector must all match. Exclusions take
precedence, and an empty include list selects nothing.

```json
{
  "format": "ink-studio/shot-lighting",
  "version": 1,
  "key": {
    "at": [0.6, 1.3, 0.85],
    "normal": [-0.8, 0.47, -0.34],
    "shape": "disk",
    "size": [0.26, 0.3],
    "color": "#ffd1a2",
    "intensity": 16,
    "radius": 2.8,
    "sampleGrid": 3,
    "shadowSteps": 4,
    "receive": { "include": [{ "surface": "courier-face" }] },
    "cast": { "exclude": [{ "object": "lantern" }] }
  }
}
```

Shadow rays use retained static SDFs. JSON dioramas retain them when a
shot role casts shadows, including when a rig is supplied through the CLI.
For JavaScript scenes, set `S.keepRenderSdf = true` before baking. A caster
mask applies to whole retained SDF groups. Bake differently scoped casters
in separate groups to give each its own mask.

Shot roles contribute surface light. Use the existing area or volume lights
for visible emitter geometry or fog illumination. Headless renders sample
the surface per pixel. WebGL samples posed splat centres through its
existing relight table, so fine shadow edges can differ at larger splat
sizes.

For Node use `ink.render(world, { shotLighting: rig })`. For WebGL pass
`{ shotLighting: rig }` in the render frame. Pass `false` to mute an
authored rig. JavaScript rigs can sample the shaped emitter's animated
settings and the negative-fill position or strength on the scene clock.
