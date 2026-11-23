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
| `exposureEV` | Set a linear-light exposure adjustment for shaded opaque surfaces, from −4 to +4 stops. |
| `bounceEV` | Scale the [baked surface-bounce signal](bounce-probes.md#use-bounce-in-a-palette-or-shot) from −4 to +4 stops in the headless renderer. |
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

## Fit a rig from painted targets

Start with an authored key and fill. Capture the approved view at its native
art size and open the resulting HTML file in a browser. Paint over the parts
of the frame you want to match and choose a desired color for each region.
Download the targets and fit them against the same scene, view and starting rig.

```sh
ink-studio shot light-paint examples/courier-shot-lighting.js \
  --shot-lighting examples/painted-shot-lighting/starting-rig.json \
  --w 128 --h 96 --out courier-paint.html

ink-studio shot light-fit examples/courier-shot-lighting.js \
  --shot-lighting examples/painted-shot-lighting/starting-rig.json \
  --targets lighting-targets.json --out courier-fit

ink-studio render examples/courier-shot-lighting.js \
  --shot-lighting courier-fit/rig.json --w 128 --h 96 --px 1 --raw --out courier.png
```

An authored `finish.shotLighting` rig can also supply the starting lights.
Pass the same camera overrides or seed to both commands. Targets downloaded
from the painter carry the original frame hash, art size and scene time. The
fitter checks the hash before searching, so it catches a change of pose,
framing or starting light that would move the painted regions.

The fit orbits the key and its aim around the camera target, scales the key
emitter's two dimensions together, adjusts fill intensity, and sets `exposureEV`.
Set an explicit world-space pivot with `aim: [x, y, z]` in the target JSON.
`exposureEV` is a gain in stops for shaded opaque surfaces. It applies to the
linear surface light before it reaches the palette. Emissive splats, sky and
screen graphics keep their own controls. The output is an ordinary editable
shot lighting rig. Its masks, light colors, rim and negative fill carry through.

Each paint target specifies the **mean** rendered color of the selected pixels.
Place marks over different normals and materials to give the solver evidence
for direction, fill and exposure. A shadow edge or penumbra helps constrain
emitter size. The fit evaluates raw lighting at a single pose, independent of
palette remapping, compositing overlays and motion history. Check the resulting
rig again with the production look enabled. Several rigs can satisfy the same
marks. When a target is out of reach or the search reaches its work budget,
`fit.json` reports the remaining color error and any active bounds.

Open `courier-fit/index.html` to compare frames and view the measured colors.
Add `--interactive` to embed the rendered candidates. That page can fit new
paint and download the best rig from the embedded set without a server. Run
the CLI again for a fresh search against new targets.

Use `--evaluations N` to trade time for search depth (1–256, default 64).
One candidate is a native render. For a quick draft, begin at the intended
art resolution with a short budget. Use a full budget when approving the rig.

The Node entry point is `ink.fitShotLighting(world, { plan, rig, view, evaluations })`.
Supply a world already posed at `plan.time`. Version 1 plans use
`{ format: "ink-studio/shot-light-targets", version: 1, grid: [w, h], time, regions }`.
Each region has an `id`, a desired `#rrggbb` `color`, and top-down
`spans: [[y, x, length], ...]` at native art size. Regions can carry an
optional `weight` and their pixels must be disjoint.

Use [native lighting approval](native-lighting-approval.md) to fit one rig to contour and palette checks at several art sizes.

## Shape lighting channels

Set `channels` in the same rig to remap each lighting contribution before
it joins the surface color and reaches the palette. Each energy curve pairs
an input luminance with an output luminance in linear light. Inputs increase
from zero, and the first output must be zero. Values can exceed one for
bright emitters. `interpolation` defaults to `linear`. Use `step` for deliberately
banded lighting or `smooth` for a softer transition. Optional `gain` multiplies
the output and `tint` filters the result with an RGB hex color. A channel set
to `false` mutes its contribution.

| Channel | Signal |
| --- | --- |
| `key` | The live directional key or the shaped light assigned to the shot's key role. Shaped fill and rim retain their own intensities. |
| `sky` | Sky contribution from the live hemisphere and open directions in the probe bake. It leaves the visible sky image alone. |
| `bounce` | Ground fill and reflected probe light. `bounceEV` still adjusts the surface-bounce input from probes. |
| `emission` | Emissive core color and the shaped surface spill produced by emissive finishes. |
| `shadow` | Measured key visibility, from fully blocked at 0 to clear at 1. A shadow ramp needs both endpoints and outputs from 0 to 1. Set this channel to `false` to bypass the key's shadow attenuation. |

```json
{
  "channels": {
    "key": { "stops": [[0, 0], [0.25, 0.3], [0.55, 0.66], [1, 1]], "interpolation": "step" },
    "sky": { "gain": 0.75, "tint": "#a6cfff" },
    "bounce": { "gain": 1.5 },
    "emission": { "stops": [[0, 0], [0.25, 0.4], [1, 1]] },
    "shadow": { "stops": [[0, 0.05], [0.5, 0.24], [1, 1]], "interpolation": "step" }
  },
  "shadeNormals": [{ "select": { "object": "east-insulator" }, "normal": [-0.31, 0.72, 0.61], "strength": 0.42 }],
  "shadowBands": [{ "select": { "material": "ceramic" }, "bias": 0.1, "steps": 4 }],
  "spill": [{ "id": "work-lamp", "receive": { "include": [{ "object": "west-floor" }] },
              "bounds": { "min": [-2.6, -0.25, -0.8], "max": [0, 1.62, 1.25], "feather": 0.17 }, "gain": 1.25 }]
}
```

- `shadeNormals` blends toward a world-space lighting normal using `strength`
  from 0 to 1. Later rules blend over earlier rules. Picking, depth and
  shadow-caster geometry retain their original normals.
- `shadowBands` shifts key incidence by a signed `bias`. Positive values hold
  an area dark longer. Optional `steps` quantizes incidence before shadow
  visibility is applied. The last matching rule wins. Authored diffuse
  materials can still use their [rest-space paint](shadow-band-paint.md).
- `spill` selects an emissive finish by its ID. Its receive mask and optional
  world-space box both have to admit the surface. The box feathers inward
  from its boundaries. The lamp core remains independently controlled by
  the emission channel.

The headless renderer applies the full rig at shading time. The WebGL
shot relight table applies the shaped key controls to its splats. Probe
channels and scoped emissive spill use the headless lighting path.

Render the Relay Room example with the authored rig:

```sh
ink-studio render examples/lighting-channels.js \
  --shot-lighting examples/lighting-channels-shot.json \
  --raw --w 352 --h 232 --px 1 --out relay-room.png
```

Set `--shot-lighting off` to render the same scene with its ungraded lighting.
