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

## Pick up and transfer material

Add `pickup` to a source material such as mud and `transfer` to a different
receiving material such as tile. A step increases the load on that shoe in
mud. Each later step on qualifying tile deposits a fraction of what the
same shoe still carries.

```json
{
  "mud": { "pickup": { "amount": 1 } },
  "tile": {
    "chart": { "bounds": [-4, -1, 6, 1], "reach": 0.1 },
    "resolution": [256, 64],
    "transfer": {
      "from": "mud",
      "fraction": 0.5,
      "size": [0.4, 0.62],
      "bands": [
        { "at": 0.02, "color": "#819088" },
        { "at": 0.1, "color": "#705749" },
        { "at": 0.35, "color": "#49372e" }
      ]
    }
  }
}
```

Put these entries inside the recipe's `materials` map. Give each sole a
stable contact `carrier` ID such as `walker/left` or `walker/right`. For
existing producers without a carrier, Ink uses the contact's source and
entity as a single carrier. Step contacts with neither a carrier nor an
entity have no transfer state.

Each shoe can hold up to 1 unit of each source material. Ink scales pickup
and deposits by contact load divided by `loadReference`, capped at 1. Speed
doesn't affect transfer, so a stationary step with load can pick up mud.
The receiver consumes mud only when the contact is inside its chart and
within reach, and draws onto its selected material. Unrelated surfaces,
wheels, and impacts leave the tracked load alone. When a receiving material
also has pickup, the step deposits the old material before loading the new one.

The tread follows the heading projected onto the chart. `size` specifies
sole width and length in chart units. Ink includes a default sole. To draw
your own, set `tread` to equal-width strings up to 32 by 32 cells, with
`.` for a hole and digits `1`–`9` for coverage. The palette band uses
deposited amount times local tread coverage. A low deposit may fall below
the lightest band. `duration` defaults to 30 seconds and `decay` defaults
to zero. Increase decay to fade a print after it lands.

`track.transfers(time)` reports pickups and deposits through the requested
time, including before and after amounts and the latest pickup that
contributed to each deposit. If a contact arrives late, Ink replays the
track in time order, breaking ties by contact ID. The same replay drives
preview, scrubbing, and export. The [effect pixel inspector](#inspect-a-pixel)
reports each mark's deposit and source pickup.

### After the Rain

The [editable diorama](../examples/material-transfer/scene.cjs) walks two
boots from wet clay onto glazed tile. Export a still and read the transfer
ledger from the same JSON:

```sh
node -e 'console.log(JSON.stringify(require("./examples/material-transfer/scene.cjs")()))' > after-the-rain.json
node cli/ink-studio.js effect transfers after-the-rain.json --t 5.6
node cli/ink-studio.js render after-the-rain.json --w 356 --h 128 --px 1 --t 5.6 --raw --out after-the-rain.png
```

Build the offline WebGL demo with a renderer bundle:

```sh
npm exec --yes --package=esbuild@0.25.12 -- esbuild examples/effect-recipes/preview.mjs --bundle --format=esm --minify --outfile=ink-renderer.mjs
node examples/material-transfer/build-demo.cjs ink-renderer.mjs after-the-rain.html
```

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

## Inspect a pixel

```sh
ink-studio effect inspect /tmp/silt-lock/silt-lock.ink.json \
  --w 336 --h 192 --px 1 --t 3.18 --at 150,98
```

Pixel coordinates are zero-based from the top left of the render graph
output. The versioned JSON reports the visible receiver, the swatch before
and after the graph, and the top contributing material response. For a
projected field it also reports the sampled texel, each channel's value and
threshold, and the source contact. Overlapping max-blended stamps attribute
the sample to the strongest stamp. Equal stored contributions keep the first
written source. A rejected pass still reports its sampled values when the
receiver lies inside its chart. The rejection codes distinguish a selector
mismatch, missing depth, chart reach and bounds, inactive or subthreshold
fields, and masks. Particle passes report the recorded contact and whether
scene depth blocked the particle.

```js
const report = ink.inspectEffectPixel(world, { at: [150, 98], w: 336, h: 192, px: 1, t: 3.18 });
const liveReport = renderer.inspectEffectPixel(world, [150, 98], { time: 3.18 });
```

Advance the scene animation to the requested time before using a renderer
API. The CLI advances the scene automatically. WebGL reads the actual
receiver and projected texel for the selected pixel, which can differ at
an edge from the headless result. Ordinary playback uses no inspector
readbacks. The report covers material-response passes at the graph output
and resolves before external UI overlays. A particle can blend its source
swatch with a different final RGB, which the report records separately.

## Silt Lock demo

```sh
node examples/material-response/demo.cjs /tmp/silt-lock
npm run build -- development
python3 -m http.server 8080
```

Open [the live preview](../examples/material-response/play.html) from the
local server and load `silt-lock.ink.json`. Click a pixel or choose one of
the three sample pixels for its effect report. Play or scrub the same project
the demo script exports with aligned picture and WAV. The first station
records footsteps in silt, the cart leaves ripples in the middle station,
and a test press strikes the slate on the right.
