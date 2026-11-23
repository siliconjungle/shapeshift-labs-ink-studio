# Drive a procedural body

Use `KIT.proceduralBody` when a creature's outline needs to follow a
moving, branching structure. Named joints share Ink's XPBD solver.
Links hold rest distances, bends help preserve each branch's shape, and
soft drive targets let contacts push back on the head or a tendril.

```js
const body = K.proceduralBody.create({
  joints: {
    head: { at: [0, 1, 0], radius: .22, drive: t => [Math.sin(t), 1, 0] },
    neck: { at: [-.45, 1, 0], radius: .18 },
    tail: { at: [-.9, 1, 0], radius: .10 },
    feeler: { at: [-.6, 1.4, 0], radius: .04 }
  },
  links: [
    { from: 'head', to: 'neck' },
    { from: 'neck', to: 'tail' },
    { from: 'neck', to: 'feeler' }
  ],
  bends: [{ through: ['head', 'neck', 'tail'], compliance: .0001 }],
  sdf: (x, y, z) => y
});

const spine = ['head', 'neck', 'tail'];
const binding = K.curveSplats.bind(builder, {
  kind: 'path', id: 'spine', points: spine.map(body.point)
}, body.curve(spine), { width: .2, edge: 'hard', color: '#73c9ad' });

const face = body.attachment('neck', 'head', { at: 1, up: [0, 0, 1] });
// Advance once per update. Supply face.matrix() to the head's existing bone.
body.step(dt);
```

`body.curve(path)` is a retained [curve splat driver](curve-splats.md).
Use it for each flexible branch. A rigid attachment can have a fractional
position `at` along a link and a local XYZ `offset`. Its frame has a
`point` and `rotation`, with +X running along the link and +Y closest to
the given `up`. Choose an up axis away from the expected link tangents.
The attachment's `matrix()` transforms its authored rest art into the
current pose in Ink's 12-value bone format.

- Optional joint `mass`, `radius`, and drive `compliance` control how
  the joints respond. Link compliance defaults to zero. Each bend adds a
  softer distance constraint across two neighboring links.
- The SDF receives `(x, y, z, time)`, with negative distance inside a
  collider. Contact is evaluated at joint radii. Add joints at closer
  intervals where the body needs to follow narrow obstacles.
  `body.contacts()` returns the IDs within the configured
  `contactTolerance` of a surface.
- `body.step(dt)` advances on a fixed clock, 120 Hz by default. Call
  `body.target(id, point)` to steer an already driven joint with input.
  Passing `undefined` restores its authored driver. `body.reset()`
  restores rest joints, clears input targets, and restarts the clock.

## Sluice Diver

Build the development bundle and serve the repository to try the live
[steering demo](../examples/procedural-body/index.html). Turn on **Show rig**
to see the branch points and amber contact markers.

```sh
npm run build -- development
python3 -m http.server 8080
```

The same [scene](../examples/procedural-body/scene.js) runs in Ink's
headless renderer.

```sh
node cli/ink-studio.js render examples/procedural-body/scene.js --t 3.2 \
  --w 260 --h 148 --px 1 --ortho --raw --out sluice-diver.png
```
