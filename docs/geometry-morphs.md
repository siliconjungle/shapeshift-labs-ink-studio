# Geometry-preserving splat morphs

Use `correspondence: 'geometry'` on `KIT.morph` when you know which splats
match across two poses. A point track gives a specific splat a route through
authored positions. A rigid feature gives a group of splats a common pivot and
orientation, keeping their spacing through the move.

```js
const track = KIT.morph(B, stage, [4, 7, 9], [24, 28, 30], {
  correspondence: 'geometry',
  dur: 2.4,
  loop: [.6, 1],
  geometry: {
    points: [{
      id: 'pilot-lamp',
      from: 4,
      to: 30,
      keys: [{ at: .4, position: [1.2, 2.9, .8] }]
    }],
    features: [{
      id: 'bracket',
      from: { position: [0, 1, 0] },
      to: { position: [2, 1, 0], rotation: KIT.Q.fromAxisAngle([0, 0, 1], Math.PI / 2) },
      pairs: [[7, 28], [9, 24]],
      keys: [{
        at: .55,
        position: [1, 1.6, .3],
        rotation: KIT.Q.fromAxisAngle([0, 0, 1], Math.PI / 3)
      }]
    }]
  }
});
stage.add(track);
```

## Endpoints and constraints

- Give each point or feature track a distinct `id`. Use actual dab IDs for
  `from`, `to`, and feature `pairs`. Each endpoint dab participates in
  exactly one pair. Endpoint lists can be dab ID arrays or
  `{ first, count }` ranges.
- A point track takes its endpoints from the baked source and target
  positions. The optional `keys` array specifies world-space
  `{ at, position }` constraints between them.
- A feature track takes two poses, each with a world-space pivot `position`
  and optional quaternion `rotation` in `[x, y, z, w]` order. Its keys
  give additional poses. Omit a rotation to use the identity rotation.
  Keep a pivot fixed through several keys to turn around a hinge.
- Every key has a unique `at` strictly between 0 and 1. It measures the
  fraction of one leg of the morph. Geometry uses the existing keyframe
  eases, with `geometry.ease: 'smooth'` by default. A key's optional
  `ease` controls its outgoing segment. Use `'linear'` for continuous
  movement through a sequence of keys.
- Feature pairs must agree with the authored endpoint poses within
  `geometry.tolerance` world units, which defaults to `.0001`.
  Positions are exact at both baked endpoints. Between them the solver
  applies one rigid transform to the source-local positions.

The stage keeps the source row, color, opacity, and material identity live
throughout and uses the target rows as hidden geometry references. The splat
covariance follows each feature rotation and blends any difference in endpoint
footprint in the feature's local frame. Point tracks blend footprints in world
space. Existing source-side normal and tangent channels turn with a feature.

With `loop: [holdSource, holdTarget]`, the reverse leg retraces the
same poses and point constraints. Omit `loop` for manual play. The
geometry track starts at the source and `track.go(true)` and
`track.go(false)` move toward the target and source respectively.
`track.go()` toggles the destination. The nearest and balanced transport
modes are also available for selections where the matches are inferred.

## Sampling without a stage

`KIT.procedural.motion.geometryMorph(source, target, geometry)` accepts
endpoint arrays of `{ id, position }` with string or nonnegative integer
IDs. It takes the same geometry description, including point keys and
feature pairs. Read `plan.matches` for the correspondence table and
`plan.sample(progress)` for immutable `{ track, from, to, position }`
records. For `KIT.morph` the same plan is available as `track.geometry`.

## Studies

[Signal to Surveyor and Armillary Seal](../examples/geometry-morph-studies.js)
show a brass glyph unfolding into a machine and three engraved rings
opening into an armillary. Moving lights in both studies use point constraints.

```sh
node cli/ink-studio.js clip examples/geometry-morph-studies.js --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out signal-to-surveyor.png
node cli/ink-studio.js clip examples/geometry-morph-studies.js --params '{"study":"armillary"}' --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out armillary-seal.png
```
