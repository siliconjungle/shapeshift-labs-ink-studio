# Headless layered character motion

Keep a catalog of reusable clips for an [assembled rig](character-rigs.md).
Stack, trim, and retime clips, mix named controls, and plant contacts
through the same whole-body solver used for individual poses. A
sampled pose works with the existing rig inspection, binding, and
preview commands.

Use [headless channel routing](channel-routing.md) to compare these
controls with WAV and simulation samples on one clock.

```sh
ink-studio character-motion catalog rig.json motion.json
ink-studio character-motion sample rig.json motion.json signal --at 0.82 --out pose.json --require-solved
ink-studio character-rig preview rig.json binding.json pose.json --view view.json --out preview
ink-studio character-motion edit rig.json motion.json edits.json --out revised.json
ink-studio character-motion retarget rig.json motion.json signal other-rig.json retarget.json --out baked.json --report transfer.json --require-solved
```

## Register clips and mix controls

A catalog has format `ink-studio/character-motion`, version `1`,
an `id`, the `rigHash` from `character-rig inspect`, and a
`clips` object keyed by clip name. Here is the shape of that object.

```json
{
  "settle": {
    "type": "curves",
    "duration": 1,
    "root": [{"time": 0, "value": [0, 0, 0]}, {"time": 1, "value": [0, -0.08, 0]}],
    "joints": {
      "body.spine": [{"time": 0, "value": [0, 0, 0], "ease": "smooth"}, {"time": 1, "value": [9, 0, 3]}]
    }
  },
  "look": {
    "type": "curves",
    "duration": 0.5,
    "joints": {"body.head": [{"time": 0, "value": [0, 24, 0]}]}
  },
  "signal": {
    "type": "mix",
    "duration": 1,
    "layers": [
      {"id": "weight", "clip": "settle", "at": 0},
      {"id": "watch", "clip": "look", "at": 0.35, "mode": "add", "mask": ["body.head"],
       "weight": [{"time": 0, "value": 0}, {"time": 0.25, "value": 1}, {"time": 0.5, "value": 0}]}
    ]
  }
}
```

Times are in seconds. Root keys are rig-space translation vectors.
Joint keys are degree arrays in the rig's control order. An outgoing
`ease` can be `linear` (the default), `smooth`, `step`,
`step-start`, `in-sine`, `out-sine`, `in-out-sine`, or a
four-number cubic easing curve. A curve holds its first and last
values beyond the keyed range while its clip is active.

A layer plays its child's `in` to `out` interval at positive
`speed`, beginning at `at` on the parent clock. Layers can
reference curves or other mixes. A constant weight or a weight
curve blends over the layer's elapsed time. `override` interpolates
the controls authored by that layer. `add` adds its weighted
changes to the existing controls. A mask may select joint names
and `root`. Omitted controls pass through from earlier layers.
The first authored value blends from neutral. At either endpoint
the layer participates, and later layers are evaluated last.
Mixed controls are clamped to the assembled rig's limits before
a pose is evaluated. The pose receipt lists active layers, their
local times, and any clamped controls.

## Plant a contact through nested clips

Either type of clip can carry a `contacts` list. A window names an
`id`, `joint`, inclusive `start` and `end` times in the clip,
and a fixed rig-space `at` point. Supply an `offset` from the
joint's rest point to plant a sole or palm. Use the position
`weight` and `tolerance`, and the optional `direction` target,
as in [rig IK requests](character-rigs.md#solve-and-inspect-pose-constraints).
Use the catalog's optional `rootAllowance` vector to limit how far
the solver can move the root in either direction from its mixed
position on each axis. The default allows zero root correction.

Trims and speed changes crop and remap contact windows to the selected
clip's clock. A layer's `contacts` switch defaults to on for
`override` and off for `add`. Enabled windows run on that clock
independently of the curve weight and mask. The catalog index shows
each resolved contact and the layer path it came from. Use
`sample --free` for the underlying controls, or `--require-solved`
to return status 2 after saving a pose with unmet contacts.

## Edit keys and record changes from a pose

A version 1 `ink-studio/character-motion-edit` document contains
`operations`. Add `revision` from the catalog index to guard the edit
against a changed source file. Edits write a separate catalog.

- `{"op":"upsert","clip":"look","control":"body.head","time":0.2,"value":[0,40,0],"ease":"smooth"}`
- `{"op":"move","clip":"look","control":"body.head","time":0.2,"to":0.25}`
- `{"op":"remove","clip":"look","control":"body.head","time":0.25}`
- `{"op":"key-pose","clip":"look","time":0.25,"pose":"adjusted-pose.json","controls":["body.head"]}`

Use a curves clip as the destination and `root` to edit the root
curve. `key-pose` reads a native pose relative to the edit file
and keys only the listed controls. Sample a pose, adjust or solve it
with `character-rig solve`, then use `key-pose` to send those
specific changes back to the clip.

## Retarget motion between rigs

A version 1 `ink-studio/character-motion-retarget` plan gives the
new catalog an `id` and optionally names the resulting `clip`.
Supply `joints` as a list of one-to-one `{source,target}` joint
names for rigs with different names. The default pairs identical
names. Compatible control axes transfer in order, and hinge axes
with opposite signs reverse the control. The receipt identifies
source controls skipped for missing or incompatible mappings.
A contact needs a mapped joint even if that joint has no controls.

The plan's `scale` vector defaults to `[1,1,1]`. It scales
root travel, contact offsets and each contact's displacement from
its corresponding rest marker. The target plant is anchored to its
own rig's proportions. Both rigs use the same world axes for
contact directions. Set `rootAllowance` to override the scaled
source allowance. Use a bake rate in `fps` (24 by default).
The bake also samples clip, key, and contact boundaries. It writes
a regular curves clip with linearly interpolated solved controls
and the transferred contact windows. Sampling can re-solve those
windows between baked keys. The report records joint mapping,
timings, limit clamps, goal errors and pass status. With
`--require-solved`, unmet contact samples produce exit status 2
after saving the catalog and report.

Catalogs support up to 128 clips, 16 levels of nesting, and 512
expanded clip occurrences. Clips can play up to 16 concurrent
contacts. A retarget bake has up to 512 distinct sample times.

## Demo

```sh
node examples/cinder-surveyor-motion.cjs out/surveyor-signal
```

The demo layers a weight shift, salute and trimmed additive wrist
flash, retargets the motion to a longer-limbed rig, and compares
three matching times under one camera. It measures boot-anchor
error with contacts enabled and disabled, then keys an adjusted
head and elbow pose back into the baked curve. The output includes
the labeled sheet, a synchronized animated loop, both bound rigs,
editable catalogs, and sample
and retarget receipts.
