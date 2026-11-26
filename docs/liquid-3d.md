# Volume liquid and spectral seas

Ink's headless volume solver advances liquid markers through a staggered XYZ
velocity grid. It extracts the free surface as an indexed mesh and emits
separate spray and foam tracers. A directional sea can surround the simulated
volume and show the local wake within a camera-driven blend region.

```sh
ink-studio liquid3d compile study.json --out liquid.world.json
ink-studio liquid3d run study.json --out water-study
ink-studio sim verify water-study/liquid.run.json
ink-studio liquid3d surface water-study/checkpoints/28.json --out wake.obj
ink-studio liquid3d ocean water-study/checkpoints/28.json --out sea.json
```

The run directory contains the preparation, native world and recording,
a trace report, requested checkpoints, and selected frame artifacts. The
standalone extraction commands accept a native world, checkpoint, or
recording. The recording supplies its final saved tick. Surface and ocean
outputs can be saved as indexed JSON or OBJ. The other output commands
are `density`, `particles`, and `secondary`. In composed worlds set
`--stage` to the liquid system ID.

## Author a liquid volume

A version 1 `ink-studio/liquid-3d-plan` contains an `id`, an optional
integer `seed`, a `config` object, and optional `run` settings.

| Configuration | Fields |
| --- | --- |
| `grid` | Uniform XYZ `shape`, world-space `cell` width and optional `origin`. The box is the simulated volume and its outer walls are closed. |
| `fill` | World boxes with `min`, `max`, optional initial `velocity` and `followOcean`. The latter clips markers at the initial wave height and adds orbital motion. Overlapping boxes use the first matching entry. |
| `colliders` | Named spheres with `radius` or boxes with XYZ `half` extents. Both take `position`, optional yaw `turn` in radians, and tangential `friction`. |
| `settings` | `particlesPerAxis`, `substeps`, `pressureIterations`, PIC/FLIP `flip` mix, `gravity`, `maxSpeed`, `maxParticles`, and per-tick `maxWork`. |
| `surface` | Density kernel `radius` in cell units, normalized `iso` threshold, world-space `resolution`, and extraction `maxCells`. |
| `secondary` | `maxCount`, `perTick`, generating `impact` and upward `rise` speeds, plus `sprayLife` and `foamLife` in seconds. |

The solver uses three face velocity components and solves pressure on active
liquid cells. Air has zero pressure. Closed faces use the wall's normal
velocity. PIC samples the projected velocity and FLIP carries its increment
into the existing marker motion. The trace measures mean absolute velocity
divergence before and after projection in inverse seconds. It records
collider contacts, final marker clearance, secondary counts, and speed
limits. Marker count and nominal liquid volume are conserved. Spray and
foam are visual tracers that do not transfer liquid mass.

Colliders are kinematic. A `move` command takes `{collider, position, turn}`
and interpolates the pose across the tick. The solver sweeps marker motion
in the collider's moving frame. Translating spheres and boxes use segment
contacts. Yaw motion uses sufficiently short substeps and a relative-frame
sweep. Markers and colliders have a substep travel limit. A supplied motion
that exceeds it fails the tick. Keep collider shapes inside the tank and
leave room for liquid to pass between them. The solver reports a trapped
marker if it cannot resolve intersecting boundaries.

The surface extractor reconstructs a compact particle-density field, carves
solid colliders, and uses Ink's Surface Nets to form triangles and normals.
Probe `liquid/density-at` for an XYZ field sample. Native `density`,
`particles`, `secondary`, `surface`, `ocean`, `colliders`, and `report`
queries can be inspected independently. In a solver network, use
`kind: "liquid-3d"` with the same configuration and a stage ID of your
choice.

## Combine local flow and ocean waves

The optional `ocean` section supplies XZ `bounds`, a mean `level`, effective
wave `depth`, `bands`, and optional `gravity`. Each band takes
`wavelength: [short, long]`, `amplitude`, and optional angular `direction`,
`spread`, and number of `modes`. The seed fixes the wavelength stratification,
direction and phase. Gravity and depth set the dispersion of the directional
waves. The sea chart encloses the volume's XZ footprint.

Set `focus`, `near`, and `far` to control the camera blend radii. A `focus`
command takes `{at: [x, z]}`. At the outer radius the height mesh equals
the spectrum exactly. Inside the interaction area, the mesh samples the
upper connected liquid column and fades to open sea near the tank edges.
`edge` sets the fade width and `sponge` sets the amount of relaxation
toward an orbital velocity near the side walls. `samples: [width, height]`
controls the combined sea mesh. Its `weights`, `spectral`, and `local`
arrays record the blend at every vertex. Use the separate volume mesh for
overhangs, submerged boundaries, or detached liquid geometry.

## Bake a study

The `run` section takes `dt`, `ticks`, trace sampling interval `every`, total
work limit `maxWork`, and a list of native `checkpoints` at exact ticks.
`commands` are `{tick, action, args}` records. `captures` are
`{tick, outputs}` records selecting geometry, particles, or densities
for individual frames. The work receipt is an operation estimate for the
declared grid, pressure passes, colliders, and marker budget. Extraction
and aggregate capture limits bound the size of saved artifacts separately.

Run `node examples/liquid-3d/demo.cjs water-study` to generate **Lantern
Sound**. A survey sled cuts through the local volume in a directional
sea. The matched stationary-sled run keeps the same seed, camera, and
spectrum. The demo compares the resulting local heights and checks the
full recording and four checkpoint continuations.
