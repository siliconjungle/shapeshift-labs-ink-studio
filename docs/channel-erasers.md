# Erase a local paint or animation contribution

Give an eraser its own ID and keep it with the mark or motion layer it affects. Set its strength to 0 for no effect, 1 to reveal the contribution beneath it, or any value in between. Overlapping erasers multiply the remaining contribution. Use `enabled: false` to set an eraser aside, or pass `patch: null` to remove it. The original marks, material settings, and motion keys stay editable.

## Surface channels

Use a [3D painting](painting-3d.md) with a surface attachment in surface snap mode. Supply one XYZ point for a round dab or a polyline for a stroke. Points are in the mark's local rest space before the mark and placement transforms, and should lie on the snapped receiver surface. Radius uses the same units. `feather` sets the softened fraction of the radius from 0 to 1 and defaults to 0.35. The eraser travels with the mark on the receiver.

| Channel | Contribution it reduces |
| --- | --- |
| `paint` | Pigment on a flat or shading-relief stroke, including zero-allowance pigment. |
| `tint`, `hueShift`, `roughness`, `coating` | One finish channel over the earlier material and finish layers. |
| `emission` | Local glow and the mark's emission contribution to spill. |
| `spill` | The mark's contribution to nearby lighting while its surface still glows. |
| `direction`, `grid`, `looseness` | Comb and ruffle, grid placement and heading, or looseness. |
| `relief` | Signed shading relief. |
| `style` | Direction, grid, looseness, and shading relief together. |

Use the mark's regular brush settings to revise its profile or physical raised or carved volume. The style eraser affects the authored style applied to that volume.

This edit softens one coat in a short band while keeping its other channels active.

```json
{
  "id": "detail",
  "edits": [{
    "op": "set-eraser",
    "id": "glaze",
    "eraser": "worn-edge",
    "patch": {
      "points": [[-0.2, 0.12, 0.26], [0.2, 0.12, 0.26]],
      "radius": 0.16,
      "feather": 0.4,
      "channels": ["coating"],
      "strength": 0.65
    }
  }]
}
```

```sh
ink-studio painting-3d update painted.json erase.json --out revised.json
ink-studio painting-3d inspect revised.json
ink-studio render revised.json --ortho --out revised.png
```

`painting-3d extract` includes the erasers with the marks. Update an existing eraser with just the fields you want to change.

## Animation controls

Add an eraser to a mix layer in a [character motion catalog](character-motion.md). Select joint controls or `root` and give the eraser a `start` and `end` in seconds of layer elapsed time. Use a constant strength or normal motion easing keys within that window. For a soft change over time, key strength from 0 at the edges. The eraser reduces that layer's override or additive weight on the selected controls. The contact solver still applies after the layers are mixed.

```json
{
  "format": "ink-studio/character-motion-edit",
  "version": 1,
  "operations": [{
    "op": "set-eraser",
    "clip": "signal",
    "layer": "reach",
    "eraser": "elbow-soften",
    "patch": {
      "start": 0.2,
      "end": 0.8,
      "controls": ["stand.elbow"],
      "strength": [
        {"time": 0.2, "value": 0, "ease": "smooth"},
        {"time": 0.5, "value": 1, "ease": "smooth"},
        {"time": 0.8, "value": 0}
      ]
    }
  }]
}
```

```sh
ink-studio character-motion edit rig.json motion.json erase-motion.json --out revised-motion.json
ink-studio character-motion catalog rig.json revised-motion.json
ink-studio character-motion sample rig.json revised-motion.json signal --at 0.5 --out pose.json
```

The catalog lists the authored windows. The sampled pose records the erasers contributing at that frame.

## Run the demo

```sh
node examples/channel-eraser-demo.cjs /tmp/ink-channel-erasers
```

The comparison shows the original, full erase, and partial erase for three surface channels and one rig control. The output includes both edit requests, their revised documents, and the pose receipts used to render the motion comparison.
