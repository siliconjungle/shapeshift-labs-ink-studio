# Displacement preview for graph height

Preview the same graph output as flat shading, view-dependent parallax, and actual tessellated relief on a planar material tile. Compare the results at the native pixel grid for each authored camera. The portable preview uses WebGL 2 and stays interactive offline.

```sh
ink-studio graph displacement-preview material.material.json displacement.plan.json --out review
```

Open `review/index.html`. The command accepts the same graph instance, input overrides, time and seed selection as [linked material preview](linked-material-preview.md).

## Set the graph source and cameras

```json
{
  "format": "ink-studio/displacement-preview",
  "version": 1,
  "label": "Engraved tile",
  "source": { "output": "material" },
  "settings": {
    "scale": 0.34,
    "bias": -0.17,
    "tessellation": [96, 72],
    "reference": [150, 120],
    "seam": "fade",
    "seamWidth": 0.07,
    "repeats": [2, 1],
    "tileSize": [2.4, 1.67]
  },
  "cameras": [
    { "id": "close", "label": "Close grazing", "distance": 4, "yaw": -45, "pitch": 22, "fov": 42 },
    { "id": "wide", "label": "Wide front", "distance": 18, "yaw": -3, "pitch": 4, "projection": "orthographic" }
  ],
  "view": { "width": 340, "height": 236, "profilePixels": 150, "profileFraction": 0.008, "colorRmse": 10 }
}
```

Point `source` at a typed one-lane height output or material packet. A packet can also supply `baseColor` and a tangent-space `normal`. Alternatively use a `maps` record with `height`, optional `baseColor`, and optional `normal`. Each map selects an `output` or a published output usage with `map`. Heights are preserved as float32, with signed values and the graph’s declared units. Normalized integer scalar inputs use their normalized values. Without pigment Ink uses a neutral material. Without an encoded normal map, it differentiates the same height field for lighting.

- **Scale and bias** set the signed chart displacement to `(sample - bias) × scale` in scene units. Bias uses the height map’s units. `tileSize` defines the physical width and height of the planar chart.
- **Tessellation** sets the active U and V segment counts per tile. The finer reference uses at least the authored `reference` count on each axis. `steps` sets the coarse ray-march count for the parallax comparison.
- **Tangent normal** controls how the supplied tangent-space normal map’s Y lane is decoded. The preview starts with the image’s declared OpenGL or DirectX convention unless the plan overrides it.
- **Seam behavior** controls height at repeating chart edges. Clamp keeps each tile’s own edge sample. Repeat samples periodically across edges so adjacent geometric edge heights agree. Fade tapers displacement to the reference plane over `seamWidth`; color retains its tile.

## Read the comparison

Flat uses fixed UVs and plane depth. Parallax traces from the camera ray to the first height crossing to recover a view-dependent UV. Its silhouette and depth still come from the receiving plane. Real relief moves actual indexed triangles and can change depth, silhouette, and occlusion. The three modes share the same shading inputs. Camera presets use degrees for yaw, pitch and FOV.

The review counts silhouette pixels that differ from the finer relief reference and reports RGB RMS error where both surfaces cover a pixel. It checks flat, parallax, then relief and recommends the first mode that meets the authored pixel count, silhouette fraction, and RGB error limits. When the current tessellation also misses a limit, the review calls for finer tessellation. It reports maximum shared-pixel depth error separately in world units. A mode can match the picture tolerance while retaining a different depth.

The depth view shows the actual submitted surface depth with a shared range across the panels. Difference view marks lost coverage in amber and added coverage in cyan. Download the review to save exact camera settings, map digests, tessellation, tolerance and per-camera measurements. Recommendations describe the sampled presets and current settings. Use [distance-dependent relief](distance-relief.md) to author tier changes in a scene.

## Ember Gate demo

```sh
node examples/displacement-preview/demo.cjs /tmp/ink-ember
ink-studio graph displacement-preview /tmp/ink-ember/ember-gate.material.json /tmp/ink-ember/preview.plan.json --out /tmp/ink-ember/replay
```

The demo includes an editable graph, signed millimeter height in OpenEXR, and an encoded DirectX tangent normal output. Switch to two tiles to compare the intentionally mismatched clamp seam with periodic sampling and the plane taper.
