# Stretch an assembly from a handle

Pick a handle and a fixed anchor on a connected sculpt assembly. Change their
separation or the two proportions across that axis. Check the proposed
positions of pivots, joints, sockets, and paint before saving the scene.

```sh
ink-studio assembly-stretch plan gantry.json stretch-request.json --preview preview.json
ink-studio assembly-stretch apply gantry.json stretch-request.json --out stretched.json > stretch-report.json
```

```json
{
  "members": [
    { "solid": "base", "mode": "fixed" },
    { "solid": "rail" },
    { "solid": "sensor", "mode": "rigid" }
  ],
  "anchor": { "solid": "base", "socket": "root" },
  "handle": { "solid": "sensor", "socket": "handle" },
  "length": 4,
  "connections": [
    {
      "id": "rail-to-sensor",
      "a": { "solid": "rail", "socket": "outlet" },
      "b": { "solid": "sensor", "socket": "handle" },
      "maxGap": 0.02,
      "maxAngle": 2
    }
  ],
  "jointLimits": [{ "part": "head", "maxLength": 4.3 }]
}
```

Use named top-level exterior sculpt solids, including meshes authored
as sculpt operands. Mates and the scene's existing rig parent links
connect the members. A pick addresses a socket, a local `point`,
or the solid's `pivot: true`. Procedural sockets on eligible solids
can also be picked. Length is measured in scene rest units.

The default member mode, `stretch`, applies the common affine map.
`fixed` holds a member in place. `rigid` translates a member without
changing its dimensions. It carries its `grip` to the expected location.
The default rigid grip is its anchor pick, handle pick, or pivot, in that
order. An explicit grip takes `socket`, `point`, or `pivot` on the member.
Optional `cross: [width, height]` gives across-axis scale factors.
`up` defaults to scene Y and determines the height direction.

## Review the plan

- Connections report gap before and after. The default gap tolerance is
  0.015 rest units. Optional `maxAngle` measures how far socket
  directions deviate from opposing, in degrees. A connection can include
  a socket on an unselected solid, which remains fixed.
- Joints report their new locations, parent gaps, rest span, and swing
  from their original parent-to-child direction. Set `minLength`,
  `maxLength`, `maxSwing` in degrees, or `maxGap` on a child part to
  check limits. The plan checks the proposed rest pose. It lists affected
  parts with motion tracks for animation review.
- SDF paint, surface charts, modifiers, and cut faces follow the retained
  affine geometry. Aligned projected decals move and resize with their
  receivers. A projector that would skew or relies on an external node
  is flagged for review.
- An unresolved joint, disconnected member, slipping pick or connection,
  unrepresentable decal, or limit violation blocks apply. Plan can still
  write the proposed scene for headless rendering.

The saved scene retains the original editable solid recipes. Its optional
`restAffine` frame applies after a solid's ordinary placement.
`editor.planAssemblyStretch(request)` returns the proposal and report.
`editor.stretchAssembly(request)` makes one undoable edit.

```sh
node examples/assembly-stretch-demo.cjs /tmp/ink-assembly-stretch
```

The demo shows a painted inspection rail and its rigid sensor before and
after a stretch, then previews a request that separates the mating
sockets and exceeds the head joint's length limit.
