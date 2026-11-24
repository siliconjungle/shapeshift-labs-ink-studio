# Local projection for selected props

A named textured mesh can use a local projection within a master camera view. Give a slanted dial a flatter view while retaining the corridor's perspective. Pin mounting points, a fingertip, or another contact to their master-camera screen positions.

```sh
node cli/ink-studio.js render examples/multiprojection/signal-dial.js \
  --w 176 --h 132 --px 1 --raw --t 0.75 --yaw 0.16 --out dial.png

node cli/ink-studio.js clip examples/multiprojection/signal-dial.js \
  --w 176 --h 132 --px 1 --raw --from 0 --to 1.5 --fps 12 \
  --yaw 0.06 --camera-orbit 8.6 --out dial-clip.png
```

Set `world.look.multiprojection` as a scene default, pass `multiprojection` to the Node renderer, or use `--multiprojection plan.json` on a render or clip. Use `--multiprojection off` for the master-only view.

```json
{
  "rules": [
    {
      "id": "face the dial",
      "select": {"object":"relay-dial"},
      "pivot": [1.24, 1.18, 0.06],
      "facing": [-0.866, 0, 0.5],
      "flatten": 0.88,
      "strength": 0.86,
      "pins": [
        {"id":"upper mount","point":[1.24,1.82,0.06]},
        {"id":"lower mount","point":[1.24,0.54,0.06]},
        {"id":"contact","point":[1.24,1.067,0.06]}
      ]
    }
  ]
}
```

- `select` addresses a mesh chart by its named `object`, `part`, or `material`. Rules match in order.
- `pivot` is a fixed world point. It stays at the master projection. `facing` points toward the desired local viewpoint, and `up` defaults to `[0,1,0]`.
- `strength` blends the requested view from zero to one. In perspective views, `flatten` reduces the change in apparent scale with local depth. An orthographic master already uses uniform scale.
- A pin can use a fixed `point` or a `track` of increasing `{time,point}` samples. The renderer interpolates the track on the scene clock. Share those positions with the animation that moves a contact.
- Every pin is a linear constraint on the local projection's homogeneous screen coordinates. Several noncollinear pins can substantially limit the change the renderer can apply. Pins near the camera or a local projection crossing the camera cause the rule to fall back to the master view.

The renderer computes a separate interpolation divisor for the chosen projection. It interpolates the original geometry and compares master-camera axial depth against the scene's other surfaces and splats. Lighting, shadow casting and world-space coordinates come from the original geometry. Local projection takes precedence over authored screen vertex snapping on selected charts. Surface-motion passes can reproject into the previous local view. Legacy master-only color history leaves these pixels to their current render.

This is a headless primary-camera feature for named opaque textured mesh charts, including alpha cutouts. Reflections and probes render from their own physical cameras. `frame.multiprojection.rules` reports each rule's status, matched triangles, and master and local pin coordinates in top-down art pixels.

```sh
node examples/multiprojection/review.js dial-review
```

The side-by-side review checks dial width, pin drift, the hand's visible pixels and depth, and changes outside the dial. The technique draws on Agrawala, Zorin and Munzner's work on retaining master visibility while introducing object-local viewpoints. [Artistic Multiprojection Rendering](https://graphics.stanford.edu/papers/mpr/)
