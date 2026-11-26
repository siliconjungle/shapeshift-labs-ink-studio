# Sparse combustion and clouds

Ink's sparse XYZ atmosphere stage simulates a hot fuel plume or a cloud
formed by condensation. Both modes share density, temperature, fuel,
vapor and velocity channels. The headless workflow records native
checkpoints and optional flow-anchored detail frames.

```sh
ink-studio atmosphere3d compile study.json --out atmosphere.world.json
ink-studio atmosphere3d bake study.json --out atmosphere-take
ink-studio atmosphere3d verify atmosphere-take/cache.json
ink-studio atmosphere3d playback atmosphere-take/cache.json --tick 44 --level detail --out volume.json --report playback.json
ink-studio volume inspect volume.json
ink-studio sim resume atmosphere-take/checkpoints/44.json --ticks 12
```

The bake writes `cache.json`, a native world, a recording reference, and
checkpoint references at the recorded ticks. The `blocks/` directory is
the native content-addressed checkpoint store. Refined sparse frames live
under `detail/` and are named by their content digests. Keep the directories
with the index when moving a take. Repeated frames and shared checkpoint
blocks can reuse their stored content.

## Author a sparse atmosphere

Version 1 `ink-studio/atmosphere-3d-plan` documents specify an `id`, an
optional integer `seed`, `config`, and optional `run` settings. Use the
same configuration under `kind: "sparse-atmosphere"` in a composed world
or solver network.

| Configuration | Fields |
| --- | --- |
| `mode` | `combustion` burns fuel above an ignition temperature. `cloud` condenses supersaturated vapor into visible density and evaporates density when the air is undersaturated. |
| `grid`, `brickSize` | Native sparse volume lattice with XYZ `origin`, uniform `spacing`, and logical `size`. Brick size is optional. The solver visits material and a pressure halo within the logical lattice. |
| `initial` | Optional inline native sparse frame with the same lattice and channel backgrounds. |
| `sources` | Named ellipsoids with `at`, XYZ `radii`, optional `start` and `end` times, and per-second `rates` for density, added heat, fuel, and vapor. A source can also supply `velocity`, `velocityGain` and a scalar `gain`. |
| `reaction` | Combustion takes `ignition` in K, `ignitionBand`, `burnRate`, `heatYield` and `smokeYield`. Cloud settings include `saturation`, `heightCooling`, `temperatureSensitivity`, `condensationRate`, `evaporationRate` and `latentHeat`. |
| `settings` | `ambient` in K, `wind` and `windGain`, `buoyancy`, `densityWeight`, `drag`, `temperatureDecay`, `densityDecay`, seeded `swirl` and `swirlScale`, and open or `closed` domain edges. |

The pressure solve projects face velocities over the active material and a
one-cell halo. The transport pass distributes material with conservative
trilinear weights, then trims concentrations below `prune`. Open boundaries
can lose material to outflow. Reports account for emitted mass, conversion
between channels, decay, outflow and pruning. They also record mean absolute
divergence before and after projection, peak temperature, density centroid,
material cells, pressure workspace and actual work counts.

The solver bounds `substeps`, `pressureIterations`, `maxActive`,
`maxSpeed`, and per-tick `maxWork`. A tick that exceeds its work or active
cell budget fails transactionally. The logical lattice can be much larger
than the active workspace. Pressure halos are transient. Only occupied
material and its velocity are carried into the next tick.

Set `run.dt`, `ticks`, `every`, optional extra `frames`, and total
`maxWork` for the bake. Source commands take
`{tick, action: "gain", args: {source, gain}}`. The start and end are
always cached. Probe `atmosphere/volume` or `atmosphere/report` for the
complete native outputs. Density, temperature, fuel, vapor and velocity
also have named spatial probes.

## Refine and play back

Set `run.upRes` to a detail recipe. Choose an integer `factor` from two
to four per axis, `strength`, spatial `frequency`, amount of `flow`
advection in the detail phase, and `maxCells`. The refinement builds
limited subcell gradients and adds seeded structure that follows sampled
velocity. It preserves per-parent density, fuel and vapor totals up to
Float32 rounding. The receipt records child count, relative channel mass
drift and the RMS density change from the reconstructed baseline.
Refinement is a visual pass on the solved frames. Resume the native
checkpoint to continue the physical solve.

Use `playback` with a saved `--tick` or a time in seconds. The default
`--blend hold` returns the preceding cached frame. `--blend linear`
interpolates all fields between enclosing frames. Select `--level base`
or `--level detail`. Playback checks the referenced blocks and emits a
native sparse volume suitable for the existing volume tools. The
`verify` command replays the native recording across the stored ticks and
recomputes the refined frames and their receipts.

Use `atmosphere3d refine <volume.json> <recipe.json>` to refine a native
atmosphere frame independently. The recipe takes the same detail fields
plus optional `seed` and `time`. Add `--report` to save the measurements.

## Kiln & Cloudbank

Run `node examples/sparse-atmosphere/demo.cjs atmosphere-study` to bake a
kiln plume and a separate condensing cloud bank. The demo renders their
cached fields with locked cameras, compares base and refined cloud frames,
and verifies both takes and a resumed checkpoint for each solver.
