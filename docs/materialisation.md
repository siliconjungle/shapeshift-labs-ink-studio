# Surface materialisation

`K.materialisation` lets existing splats detach, follow a shared current, gather
into another live surface, dissolve completely, and rejoin an animated part.
The [matter relay](../examples/materialisation.html) demonstrates a GPU-skinned
sculpture becoming a manta and an iris, plus independently repeating erosion
along the stage edges. Every flying fragment is an original carrier splat.
There is no second cloud hiding an unchanged sculpture.

This builds on `K.flow`, shared wind, `K.splatFrames`, stage rigs and GPU bones,
material-coordinate charts, and `K.procedural.motion.transportSplats`.
`K.particles`, `K.dissolve.at`, `K.morph`, and surface advection retain their APIs.
The newer [reconstruction tracks](world-reconstruction.md) already provide
seekable rigid-cell fragmentation with attached paint. Use them for that visual
case; this binding adds wind-driven carriers, foreign live targets, explicit
handoffs and simulation state. Reconstruction skips actively owned rows; use
distinct selections, or bake a reconstructed pose before transferring it to
materialisation.
Use those smaller tools independently when a full detach/gather/return lifecycle
is unnecessary.

## Bind a surface

Set up the rig and other animation first, then add materialisation after the
pose and appearance writers. Select splats by IDs or an existing named selector.

```js
const stage = K.stage(world);
const puppet = K.puppet(world, characterDefinition);
const material = stage.add(K.materialisation.bind(stage, {
  id: 'signal-body',
  ids: characterIds,
  targets: {
    flower: K.materialisation.anchors.points(flowerSamples, { size: .018 }),
    cloth: K.materialisation.anchors.chart(movingChart, materialCoordinates)
  },
  flow: K.flow.sum(K.flow.wind([.8, .2, 0]), K.flow.curl(.6, .1)),
  width: .012,
  length: .04,
  paths: [K.materialisation.paths.arc({ height: .6 })]
}));

material.release({ velocity: [.4, .15, 0], stagger: .5 });
// Later, including while fragments are already in flight:
material.gather('flower', { duration: 1.8, stagger: .25 });
material.rejoin({ duration: 2 });
```

The carrier count stays fixed. Position, anisotropic covariance, color, opacity
and normals move with each sample. Release starts at the current posed surface;
source motion can contribute launch velocity. Gather starts from the currently
displayed position, shape and opacity, so interrupting a gather does not reset
the fragment to its launch point. Quintic endpoint weights and windowed path
offsets preserve continuous endpoints.

On rejoin, the destination is the **current** animated home, including a scaled
CPU rig or GPU-skinned part. Original skin tags, local coordinates and rest-space
brushes return when it arrives. A foreign target stays live after settling; its
anchors can continue to deform or move.

## Surface anchors and correspondence

An anchor has `position[3]`, `normal[3]`, `covariance[6]`, `color`, `alpha`, and
optional `velocity[3]`. Covariance order is `xx, xy, xz, yy, yz, zz`.

| Constructor | Behavior |
| --- | --- |
| `anchors.splats(stageOrWorld, ids, {pose, live})` | Captures rest samples and follows current CPU rig/GPU bone matrices and supported native shader motion. `pose(worldTime)` can supply historical poses for replay. |
| `anchors.points(samples, {size, color, alpha, pose})` | Takes XYZ arrays or anchor records. `pose(out, worldTime, index)` updates a copied rest sample. |
| `anchors.chart(carrier, uvSeeds, {size, thin, color, alpha})` | Follows material coordinates on procedural charts or `TexturedSurface` grids/heightfields, using their actual sample/query geometry. The carrier can be `time => chart`. |
| `anchors.custom({count, begin, sample, restore})` | Adapts another simulation. `sample(index, worldTime, out)` fills an anchor; `begin(worldTime)` prepares a frame. |

`begin` refreshes even at the same timestamp when called explicitly. `sample`
automatically prepares a changed timestamp. `live: true` reads an upstream
surface's current rows; use it for separate, externally updated geometry, not the
carrier rows being rewritten by this effect. For other CPU deformation systems,
provide a time-based custom sampler or pose callback to avoid feedback.
A custom `source` without `restore(index, packedRow)` remains a world-space
kinematic writer at home, so its animated anchors keep moving after rejoin. It
retains active ownership and explicit fragment appearance. Native splat anchors
provide `restore` and return control, skinning and rest-space paint to the rig.

Charts supply destinations or positions for splat carriers. This does not remove
texels or tear triangles from a rendered atlas mesh. Use SDF/splat source geometry
for actual erosion; mesh heightfields and charts can still guide it or receive it.

Foreign gathers support:

- `mapping: 'spatial'` (default): deterministic spatial ordering and balanced
  resampling, without a quadratic distance matrix.
- `mapping: 'index'`: material coordinates or explicitly corresponding samples.
- `mapping: [targetIndex, ...]`: one valid target index per carrier.
- `mapping: 'transport'`: the existing balanced transport solver, with its
  `transport` options and budgets. Up to `links` (default 4, maximum 16) weighted
  anchors are retained per source, so a moving target does not need a new solve
  every frame. The existing transport size limits still apply.

Mappings are cached. Set `remap: true` on a gather to rebuild one after a target
changes its material layout. `home` always preserves each carrier's original
association. A target need not have the same count; the existing carriers sample
its surface. Targets are anchor descriptions and are not drawn automatically.

Colors can be `'#RRGGBB'`, normalized RGB triples, or native packed splat RGB
(red in the low byte). `K.materialisation.color(value)` converts the first two.
Named material/object provenance remains the carrier's, allowing existing scoped
looks and final grading to keep working.

## Controls and masks

| Control | Options |
| --- | --- |
| `release(options)` | `velocity` XYZ, `normalImpulse` (default .35), `inheritVelocity` (1), `stagger` seconds, optional `fadeAt` and `fadeDuration`. |
| `gather(name, options)` | `duration` (1.4 seconds), `stagger`, correspondence controls above. Can interrupt drift or another gather. |
| `rejoin(options)` | Gather to the moving home anchors. |
| `dissolve(options)` | Release and fade fully to zero over `duration`; no permanent partial grain. |
| `reveal(options)` | Gather hidden fragments back home, restoring full original surface coverage. |
| `reset()` | Return the binding to local time zero and its initial visibility. |
| `dispose()` | Rejoin at the current home pose, release reservations and remove the system/painter. |

All transition controls accept `ids`, `fraction` in `[0,1]`, and
`mask(x,y,z,localTime,context) => weight` in `[0,1]`. Fractions and mask weights
select deterministic subsets; they do not make every surface semi-transparent.
Masks use the current surface/fragment location. This can wrap an existing
spatial field, SDF distance, a weathering channel or a region of interest.
`visible: false` on the binding starts its carriers fully hidden.

Staggered release keeps each sample attached until departure. Delayed gather
keeps a surface attached, or lets already airborne particles continue drifting,
until that sample's actual transition starts.

```js
material.timeline([
  { at: 1, action: 'release', options: { fraction: .35, stagger: .6 } },
  { at: 2.5, action: 'gather', target: 'flower', options: { duration: 2 } },
  { at: 6, action: 'rejoin', options: { duration: 2 } }
], { loop: 10 });
```

Timeline actions are `release`, `gather`, `rejoin`, and `dissolve`. Cues round to
the nearest integration tick; stagger delays round upward. Events at the same tick
retain authored order. Installing a timeline mid-cycle retains its upcoming
events. `timeline([])` stops future cues without cancelling current motion.

## Wind, forces, paths and appearance

`flow` accepts the existing `(x,y,z,time,out)` flow callback, an XYZ-returning
function, or a shared wind-field object (`xyz`/`sample`). An XZ return value is
adapted to XYZ. For example:

```js
const wind = K.procedural.airflow.field(world.windField, {
  ambient: time => weatherAt(time)
});
// Pass this same field to the materialisation binding and other simulations.
const settings = { flow: wind, drag: 2.5 };
```

Drag relaxes fragment velocity toward that current; `gravity` adds XYZ
acceleration. The binding's `time` option defaults to the stage's current time,
so a binding created mid-scene samples shader motion and wind on the same clock.
Its timeline and `stats.time` use local elapsed seconds; `stats.worldTime` exposes
the scene time.

Additional callback arrays compose in declared order:

- `forces`: `(context, outAcceleration)` adds XYZ acceleration. A callback may
  return an XYZ vector instead of filling `outAcceleration`.
- `paths`: `(context, outOffset)` adds a gather-path offset, with an automatic
  endpoint window. `paths.arc({axis,height})` and `paths.vortex({axis,radius,turns})`
  are optional building blocks; custom routes or chaos fields can use the same
  interface. Use `K.flow.vortex`/`curl` for physical drift.
- `appearance`: `(context, outAnchor)` changes fragment color, opacity, normals
  or shape. Keep endpoint contributions zero when an exact home/target finish is
  required. Original carrier material remains available through `context.source`.

Context exposes carrier `id`, `index`, deterministic `seed`, scene `time`,
`localTime`, transition `age`, `progress`, `airborne`, `mode`, target name, current
position/velocity, source anchor and gather goal. Treat context anchor data as
read-only; write into the provided output. Callbacks must return finite geometry
and positive semidefinite covariance.

`width`/`length` are fragment covariance radii in world units, default .015/.045.
The flight covariance aligns with velocity. Source-to-fragment and fragment-to-
target shape changes blend continuously; no large replacement blobs are added.
`peel` controls the initial shape transition (.22 seconds), and optional
`emissive` changes the active carrier's emission flag.

## Ownership and rendering

`K.geometryOwnership(stage)` supplies `reserve(owner, ids)`, `activate`,
`deactivate`, `release(owner)`, and `owner(id)`. Reservations prevent destruction
and materialisation from binding the same samples. Active geometry uses the
shared `stage.geometryOwned` mask; `physicsOwned` remains its compatibility alias.
Rig, pool, frame-splat, bone fallback and morph writers respect this mask.
Bindings retain reservations while attached and release them on disposal. For an
explicit handoff, dispose one binding before constructing the other.
`activate(owner, id)` and `deactivate(owner, id)` also accept one integer ID,
with the same reservation checks, avoiding temporary singleton lists in carrier
loops.

While controlled, a carrier writes world geometry and temporarily clears native
motion tags. `K.bones.posed` skips these detached rows. `K.materialisation.FLAG`
(32768 in the packed kind word) bypasses rest-space pixel brushes, fine stamps and
edge sprites in both renderers, so source paint cannot recolor a new form. The
original material detail and skin tags return on rejoin. World-space looks and
final palette grading still apply. Add the materialisation painter after other
painters to preserve its active opacity/color.

`K.splatFrames.create(...)(index)` additionally exposes `covariance(out)` and
`opacity()` for other effects that need the current native sample. Geometry,
normal and shader-motion sampling are shared rather than copied into this tool.

## Checkpoints, inspection and budgets

`inspect(id)` reports mode, target, position, velocity, opacity and target-anchor
links. `stats` counts attached, waiting, airborne, settled and hidden samples.
`drainEvents()` consumes a bounded FIFO of release, gather, arrival and reset
notifications, including carrier IDs and local/scene time.

`snapshot()` returns JSON-compatible state; `restore(snapshot)` validates the
configuration, timeline, mappings and sample payloads before changing geometry.
Checkpoints include pending transitions, displayed geometry, velocities, event
cursor and cached correspondence. Functions are not serialized: restore against
the same binding configuration and timeline, and restore external simulations or
rig state as well. Time-based pose callbacks make headless replay possible.

`advance(seconds)` runs fixed substeps and samples time-based providers on each
step. The stage's `update(dt)` samples the live upstream pose once per visual
frame. Both use the same integration and tick schedule. `advance` can reject
large offline jumps; split them or explicitly raise the work budget.

Defaults: 50,000 carriers (maximum 250,000), 1/120-second step, 2,400 substeps and
20 million carrier steps per advance, 256 queued events, up to 64 foreign targets
and 500,000 total anchors. Only active/pending target forms are sampled at runtime.
Up to `maxMappings` cached correspondences are retained (default 8, maximum 64).
Correspondence solves are outside the per-frame loop. No per-frame splat capacity
is allocated. Use stage dirty rows when uploading the result, as the example does.

## Live performance

Prepare large bindings while constructing the scene and retain them between
release/rejoin cycles. They return geometry ownership to the rig at home without
needing disposal. Disposing and recreating thousands of carrier records on each
button press creates avoidable stalls; dispose when removing or handing off the
effect. The typography specimen follows this persistent lifecycle.

Built-in curl fields share exact lattice corners and finite-difference
interpolation in a bounded 256-cell cache per field. Cache collisions evict a
cell and recompute it; they never substitute another cell's values. Custom
`K.noise3` implementations retain the original sampling path. Native source
anchors reuse each part's affine and normal transforms; ordinary splats avoid
allocating shader-frame objects. Animated native kinds retain shared frame
sampling. Gather goals reuse read-only normalized views of the current target
frame, including changing position, covariance, color and opacity.

Known coordinate-only flows and paths omit unused operator contexts; custom
callbacks still receive the full context. Output validation runs before packed
geometry is published, with custom appearance constraints checked at each tick.
The fixed 120 Hz integration, fragment count and authored splat resolution stay
the same.

Run `node scripts/benchmark-materialisation.js` (or `--quick`) for reproducible
CPU timings of the complete typography specimen while its camera rotates.
The report separates scatter, gather and attached updates and records carrier
counts. It measures CPU simulation cost, not displayed/GPU frame rate; use a
browser frame trace for end-to-end performance.
