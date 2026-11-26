# Headless garments, grooms, and feathers

Sew garment panels, bake their fixed-step motion, and sample dressed
frames from a version 1 `ink-studio/wardrobe-plan`. Frames include
indexed panels, groom paths, and individual feather meshes with roots,
tips, and shaft curves. The preview command renders those same outputs.

```sh
ink-studio wardrobe bake wardrobe.json --out take.json --cache cache
ink-studio wardrobe sample wardrobe.json take.json --frame 23 --out frame.json
ink-studio wardrobe preview wardrobe.json take.json --frame 23 --view view.json --out frame.png
```

## Sew panels and set layer order

A plan has an `id` and at least one entry in `panels`, `grooms`, or
`feathers`. Each panel has an `id` and a `size` pair for its grid.
Give four world-space `corners` in top-left, top-right, bottom-left,
bottom-right order, or supply one explicit XYZ point per grid vertex
in row-major order. Pins name an `edge` or a list of local `vertices`.
Add a `joint` to move the selected vertices with its skin transform.

Each seam has an `id` and sides `a` and `b`. A side names a `panel`
and either an edge or ordered vertex indices. Both sides have the same
number of vertices. Use `reverse: true` on one side to reverse the
pairing. Stitches pull toward their `gap`, which defaults to zero.
`compliance` controls stitch softness. The bake receipt reports the
largest absolute stitch error per seam on every frame.

```json
{
  "format": "ink-studio/wardrobe-plan",
  "version": 1,
  "id": "two-piece-mantle",
  "panels": [
    {"id": "left", "size": [5, 8], "side": -1, "layer": 1,
     "corners": [[-0.6, 1.5, 0], [-0.04, 1.5, 0], [-0.67, 0.2, 0], [-0.04, 0.2, 0]],
     "pins": [{"vertices": [0, 1]}], "color": "#9e634d"},
    {"id": "right", "size": [5, 8], "side": -1, "layer": 1,
     "corners": [[0.04, 1.5, 0], [0.6, 1.5, 0], [0.04, 0.2, 0], [0.67, 0.2, 0]],
     "pins": [{"vertices": [3, 4]}], "color": "#ae735d"}
  ],
  "seams": [
    {"id": "middle", "a": {"panel": "left", "edge": "right"},
     "b": {"panel": "right", "edge": "left"}, "compliance": 0.000001}
  ],
  "simulation": {"fps": 24, "frames": 48, "substeps": 5, "wind": [1, 0, 0.5]}
}
```

Panel settings include `density`, `stretch`, `shear`, `bend`,
`air`, and `thickness`. Set `color` and optional `trim` to see
the drape and edge in the preview. Add `colliders` with a `center`,
`radius`, and optional `joint` for rigged sphere supports. Default
gravity is `[0,-9.8,0]`. Set `gravity`, `damp`, `wind`, or
`gust` in `simulation` to change the forces.

Lower-numbered layers support higher-numbered layers. Choose the
contact-facing side using `side` (`1` for the panel's triangle
winding, `-1` for its opposite). For example, a flat panel extending
right along X and down along Y uses `-1` to face positive Z. The
solver projects movable upper-layer vertices against lower-layer
triangles in ascending layer order. Clearance includes both panels'
thickness. Pins retain their authored positions. Use
`simulation.collision: false` for a comparison. Both variants
report overlap measured within the contact `reach` as well as the
number and maximum size of applied corrections. `clearance`,
`reach`, and optional broad-phase `cell` are in world units.

## Attach grooms and articulate feathers

An optional `rig` record has a relative `file`. Add relative
`motion` and `clip` to drive it with a
[motion catalog](character-motion.md). Set `contacts: true` to use
its contact-solved pose. Rigged pins, groom points, and feather
placement coordinates are authored in the rig's rest space.

A groom has an `id`, `anchor`, and a local XYZ `guide`. Set
`count`, `clumps`, `tightness`, `frizz`, `separation`,
`radius`, and `lengthVariation` to control the seeded
[strand bundle](curve-splats.md#author-a-source). Specify `colors`
for the clumps. An anchor is a fixed `point`, a `point` with a
`joint`, or a `panel` with a `uv` coordinate. Panel-mounted
guides have local X along U and local Z along the panel's selected
outward side. Their local Y completes the frame. The anchor follows
the same simulated triangle and barycentric weights at every frame.

A feather row places `count` roots between `from` and `to`.
Attach it to a `joint` or leave the row fixed in world space.
`direction` defines the shaft, and `normal` sets the vane plane.
The two endpoints of `length`, `width`, and `fan` interpolate
across the row. `fan` is in degrees. Set `curl`, `asymmetry`,
and three `colors` for the two vanes and the tip.

```json
{
  "id": "outer-flight",
  "joint": "wing.tip",
  "from": [0.7, 1.4, 0],
  "to": [1.3, 1.6, 0],
  "direction": [0, -1, 0],
  "normal": [0, 0, 1],
  "count": 8,
  "length": [0.4, 0.75],
  "width": [0.13, 0.15],
  "fan": [0, 40],
  "action": {
    "axis": [0, 0, 1],
    "stagger": 0.14,
    "keys": [{"time": 0, "value": 0}, {"time": 0.8, "value": 25}]
  }
}
```

The `action` hinges each feather about its root, then applies the
joint transform. Keys are seconds and degrees. `stagger` delays the
last feather relative to the first. Sample output preserves feather
IDs and the position of each root even when preview rendering
combines their vane meshes.

## Bake and replay

The fixed-step bake records poses from frame zero. A take is checked
against the plan and rig or motion file hashes before replay. The
cache key includes those same inputs and the engine revision. An
identical run can reopen the checked take bytes from cache, and a
changed input or damaged entry triggers a rebuild. Cache hits and
misses appear in the CLI receipt. The saved take bytes stay identical.

View files accept `w`, `h`, `camera`, `background`, and `raw`.
A camera can use settings such as `target`, `dist`, `yaw`,
`pitch`, and `ortho`.

```sh
node examples/wardrobe/demo.cjs out/storm-petrel
```

Storm Petrel sews two outer panels over a lining, follows a posed
wing rig, and grows seeded fringe from the moving hem. The demo
includes folded and spread poses, a contact-on and contact-off
comparison, an animated sequence, and a verified warm-cache bake.
