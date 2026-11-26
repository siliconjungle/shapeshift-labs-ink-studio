# Split a sculpt

Extract a piece from a named exterior solid using a plane or a bounded
native shape. The remainder keeps the source ID. The extracted solid
gets its own ID and retains a copy of the editable source and modifier
stack. Move, paint, or edit either piece after the split.

```sh
ink-studio sculpt-split plan original.json split-request.json
ink-studio sculpt-split apply original.json split-request.json --out split.json > split-report.json
```

Plan reports the result without writing the scene. Apply saves a new
scene beside the source so relative assets keep resolving.

```json
{
  "solid": "cartridge",
  "extract": "cartridge-outlet",
  "id": "service-cut",
  "cutter": { "kind": "plane", "at": [0.16, 0, 0], "normal": [1, 0.13, 0.09] },
  "capMaterial": { "role": "core", "materialId": "machined-core" }
}
```

A plane uses the solid's rest coordinates before its scene transform.
Its normal points into the extract. Ink fits a native box with one face
on the plane and the other faces outside the source bounds. You can also
supply a bounded native shape such as a ball, box, or sweep. The extract
holds the intersection and the remainder holds the difference. Both
masks retain the same cutter with no bevel or offset. The report gives
an interior witness for each piece and a cut witness when sampled inside
the original solid. This placement check uses conservative bounds and
samples, so an unusually thin curved extract may require a tighter cutter.

## Paint, sockets, and material IDs

- **Sculpt paint and charts.** Both pieces retain the rest-space paint
  records and charts. Native sculpt paint is applied to surviving
  source faces and excluded from newly exposed cut faces. Anchor counts
  show which side contains the recorded SDF paint contacts. Scene-level
  projected decals stay attached to the original ID and are listed for
  review if you want to rebind them.
- **Sockets.** A solid can declare `sockets: { name: { p: [x,y,z],
  dir: [x,y,z] } }`. Positions use the solid's rest frame and direction
  defaults to up. The stage resolves them as `solidId/name`.
  The split assigns each authored socket to one piece by its position.
  Exact-boundary sockets stay with the remainder and are flagged.
  A procedural solid's generated sockets are used when it has no
  explicit socket map. Each piece keeps the source rig part if it has one.
- **Materials.** The report lists IDs from the retained recipes and the
  ID used on new faces. `capMaterial` can be a role or a diorama
  material object. Omitting it uses the source's base material for the cut.

Use `editor.planSculptSplit(request)` to inspect a proposal and
`editor.splitSculpt(request)` to commit one undoable edit.

```sh
node examples/sculpt-split-demo.cjs /tmp/ink-sculpt-split
```

The demo opens a painted turbine cartridge. It saves the paired pieces,
the report, and a headless render with both cut faces turned toward
the camera.
