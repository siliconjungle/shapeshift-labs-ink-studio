# Bidirectional field–particle coupling

`KIT.procedural.motion.coupledFluid(options)` advances loose particles
against a retained XZ fluid grid. Particles read flow, move through the
open domain, and return density, named dye amounts, and drag to the
grid. The next tick reads the field changed by those deposits.

```js
const bath = KIT.procedural.motion.coupledFluid({
  width: 96, height: 64, cell: .075, origin: [-3.6, -2.4], dt: .05,
  drag: 6, release: 2, feedback: 1,
  dyes: {
    indigo: { diffusion: .0003, dissipation: .03 },
    gold: { diffusion: .0002, dissipation: .02 }
  }
});
bath.spawn([
  { at: [-1,.3], velocity: [1.2,.5], density: .002, dyes: { indigo: .008 }, lifetime: 2 },
  { at: [1,-.3], velocity: [-1.1,.5], mass: .014, dyes: { gold: .006 } }
]);
const frame = bath.step(8, { wind: (x,z,t) => [-z*.7,x*.7] });
const dye = frame.source('indigo');
const flow = frame.source('velocity');
```

## Exchange and timing

- The grid uses the same spacing, origin, mask, and initial state as
  [stable fluid](procedural.md#fluid-grids). The simulation owns its
  solver and uses `dt` as its fixed step. The default is .04 seconds.
- `spawn(particles)` adds a batch at the current tick and returns stable
  numeric IDs. `at` is an open XZ position. `velocity` defaults to zero.
  `mass` defaults to .01 and scales momentum feedback. `density` and
  `dyes` are finite amounts remaining on the particle. Optional
  `lifetime` is in seconds. Any payload still on a particle at expiry
  is discarded.
- `step(count, inputs)` advances up to 300 fixed ticks atomically. All
  particles read the same start-of-tick velocity. `drag` sets their
  relaxation rate toward fluid velocity. Optional `inputs.wind(x,z,t)`
  returns a separate XZ velocity and uses the `windDrag` rate. Both
  rates are in inverse seconds.
- `release` in inverse seconds determines how quickly particles deposit
  their payload. Deposits follow the swept path and distribute by
  normalized cell weights. `feedback` scales the reaction to fluid
  drag. At zero the flow still carries particles and receives dye.
  The fluid's pressure projection, transport, and numeric clamps
  affect the final amounts and velocities.
- The path sweep stops particles at masked walls. Particle deposits
  and scalar interpolation respect closed cells and sealed corners.
  `step` also accepts the stable fluid's `force`, `source`,
  `dyeSource`, `viscosity`, `diffusion`, and `dissipation` inputs.
  Supplied forces and sources add to particle feedback.
- Use `checkpoint()`, `restore(token)`, and `reset()` to replay.
  Checkpoints belong to the simulation that created them and include the
  next particle ID. Replay the same spawn events and timed inputs.

## Material and geometry outputs

`frame()` and `step()` expose `tick`, `time`, particles with their
remaining payloads, and the native stable fluid snapshot. Read
`frame.sample(channel,x,z)` or adapt a channel for renderer and geometry
tools with `frame.source(channel)`. The channels are `density`,
`velocity`, and the names in `dyes`. Dye channels are scalar amounts
that can be mapped to any pigment colors. The velocity source returns
an XYZ vector on the XZ plane. To use a different chart, supply XYZ
`bounds` and `project([x,y,z])` returning chart coordinates. Optionally
supply `toWorld([u,v],point)` for a velocity source in a different basis.

A native `stableFluid` can also use up to eight independent `dyes`.
The `initial` callback accepts a named `dyes` map in its return value.
A step can add signed rates with `dyeSource(x,z,t,values)`. Dye channels
share the fluid backtrace and each have their own diffusion and
dissipation. `snapshot.dye(name)` copies the cell data, and
`snapshot.sampleDye(name,x,z)` samples it in scene units.

## Render the studies

[Marbling Bath and Capillary Proof](../examples/field-particle-studies.js)
use the same coupling for colored currents and stains on a cut sheet.
Both show young pigment particles over the dye they deposited.
Set `feedback: false` in scene controls to replay either study with
drag feedback disabled.

```sh
node cli/ink-studio.js clip examples/field-particle-studies.js --w 900 --h 560 --px 2 --to 6.4 --fps 10 --out marbling-bath.png
node cli/ink-studio.js clip examples/field-particle-studies.js --params '{"study":"stain"}' --w 900 --h 560 --px 2 --to 6.4 --fps 10 --out capillary-proof.png
```
