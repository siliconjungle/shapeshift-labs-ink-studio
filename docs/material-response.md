# Portable material response recipes

`KIT.materialResponse.create` records one contact log for footsteps, wheel
contacts and scripted impacts. The receiving material chooses the visible
mark, expanding ripple, particles and sound. Live preview and export sample
the same log in presentation seconds, so the visual responses can be sought
in either direction and sound starts at the authored contact time.

## Author a recipe

Place the recipe and its recorded contacts in a JSON diorama under
`finish.materialResponse`. A portable project bundle keeps these inline.

```json
{
  "recipe": {
    "format": "ink-studio/material-response",
    "version": 1,
    "materials": {
      "silt": {
        "chart": { "bounds": [-4, -2, 4, 2], "reach": 0.16 },
        "mark": { "radius": 0.18, "duration": 5, "color": "#684837" },
        "particles": { "count": 6, "color": "#d8a981" },
        "sound": { "cue": "step-silt", "gain": 0.8 }
      }
    }
  },
  "contacts": [
    { "id": "step-1", "interaction": "step", "material": "silt", "time": 0.4,
      "point": [0, 0, 0], "heading": [1, 0, 0], "speed": 2 }
  ]
}
```

- Material rules accept `mark`, `ripple`, `particles`, and `sound`
  separately. A mark or ripple needs a chart. Both use `radius`, `duration`,
  `decay`, and a field `threshold`. A ripple also uses `speed` and `width`.
  Particles use deterministic headings and gravity, and are depth tested.
- `interaction` is `step`, `roll`, or `impact`. World XYZ `point`,
  `speed`, and a stable `id` are required. Supply `normal`, `heading`, or
  `load` when known. The recipe's `speedReference` and `loadReference`
  default to 2 and 10 and scale field strength, particle count, and gain.
- `sound.cue` names an asset in the scene soundtrack. `rollInterval`
  limits sound retriggers per source, entity, wheel and material.
  `export-scene --audio soundtrack.json` mixes these cues alongside existing
  timeline audio. A bundle can supply its [own soundtrack](agent-projects.md#pack-a-project).
- A recipe supports eight materials and keeps up to 2,048 contacts. A
  contact with no matching rule stays in the log for future recipe edits.

## Read live contacts

Create and bind a track to an existing world, or use the track installed
by the diorama. After each simulation tick, pass the contact-effect system's
records into it with the committed time. Duplicate IDs are ignored. Authored
steps and scripted impacts can use the same `add` call.

```js
const track = world.materialResponse;
const result = run.query().probe('feedback/contacts');
if (result.status === 'ok') track.add(result.value, { time: run.view().time });

const player = track.createPlayback(audioContext, name => decodedBuffers.get(name));
player.seek(playheadSeconds);
// Call sync on each preview tick. Call seek again on a jump.
player.sync();
// Keep the recipe and captured log together in a diorama or bundle.
const materialResponse = track.snapshot();
```

`seek` schedules any remaining cue tails at the new playhead. `stop`
pauses audio and cancels queued starts. Use `sounds()` to inspect the cue
list without playing it.

## Projected fields

Chart `origin` is world XYZ. `u` and `v` are perpendicular axis vectors,
defaulting to world X and Z. `bounds` is `[minU, minV, maxU, maxV]` in scene
units. `reach` limits how far a surface can lie on either side of the chart
plane. The chart texture uses nearest texels. Its optional `resolution`
belongs to the material rule and defaults to 128 × 128. A rule's `select`
defaults to its named material.

The recipe appends projected composite passes after the authored render
graph. They sample the visible, depth-writing splat receiver in world
space. An intervening owner hides the mark. In WebGL the shader samples
the small chart texture directly from the native depth buffer. Headless
uses the same chart in its compositor. Charts stay in world space and
are intended for terrain and other fixed splat receivers.

For custom projectors, `type: 'composite'` accepts this chart as
`projection` beside a receiver `select` and a nearest-filtered raster
`layer`. The raster may also come from a named graph slot. Its top row
begins at minimum V.

## Silt Lock demo

```sh
node examples/material-response/demo.cjs /tmp/silt-lock
npm run build -- development
python3 -m http.server 8080
```

Open [the live preview](../examples/material-response/play.html) from the
local server and load `silt-lock.ink.json`. Play or scrub the same project
the demo script exports with aligned picture and WAV. The first station
records footsteps in silt, the cart leaves ripples in the middle station,
and a test press strikes the slate on the right.
