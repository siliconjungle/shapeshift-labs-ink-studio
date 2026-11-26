# Ambient occlusion, bent normals and direction bakes

Open the [bake workstation](bake-jobs.md) and enable the AO or vector maps you need. Open each map's overrides to set its sampling cone and occluder scope. Maps on the same tile share their ray pass when their dimensions, padding and resolved ray settings agree.

```json
{
  "format": "ink-studio/bake-preset",
  "version": 1,
  "label": "Courtyard lighting",
  "defaults": {"size": 256, "padding": 3},
  "maps": [
    {"id": "ao", "overrides": {"rays": 48, "range": 2.5, "falloff": "linear", "encoding": "png16"}},
    {"id": "ao-contact", "overrides": {"range": 0.4, "selfOcclusion": "only"}},
    {"id": "ao-directional", "overrides": {"direction": [0.6, -0.2, 1], "spread": 28}},
    {"id": "bent-normal", "overrides": {"rays": 48, "range": 2.5, "falloff": "linear", "encoding": "exr"}},
    {"id": "occlusion-direction", "overrides": {"rays": 48, "range": 2.5, "falloff": "linear"}}
  ]
}
```

## Choose a map

- **Ambient AO** (`ao`) measures visibility around the receiver's interpolated surface normal. The default is 32 rays in a 90° half-cone, with binary occlusion up to the receiver's bounding-box diagonal.
- **Contact AO** (`ao-contact`) defaults to 24 rays in a 75° half-cone, with smooth distance falloff over 12% of the receiver's diagonal.
- **Directional AO** (`ao-directional`) defaults to 32 rays in a 45° half-cone aimed along scene +Y. Specify `direction` to set the scene axis. Ink traces the portion of the cone above the receiving face.
- **Bent normal** (`bent-normal`) points toward the weighted mean of visible directions. It is a unit world-space normal. Fully blocked or empty lobes use the receiver normal.
- **Occlusion direction** (`occlusion-direction`) points toward the weighted mean of blocked directions. It stores world-space XYZ data with a zero vector where there is no net blocker direction.

All three AO maps represent visibility, with 1 for open and 0 for fully blocked. Gutter texels extend the nearest owned sample. Outside the chart and its gutter, AO is 1, bent normals are +Z, and blocker directions are zero. Use `coverage` to identify actual receiver texels.

## Set the ray pass

| Override | Meaning |
| --- | --- |
| `rays` | 4–128 deterministic cosine-distributed samples per texel. |
| `spread` | Half-cone angle in degrees from 0 to 90. Zero repeats the cone's axis. Rays below the receiving geometric face are omitted. |
| `range` | Maximum reach from the biased ray origin in scene units. |
| `falloff` | `none` counts an in-range hit at full strength. `linear` and `smooth` fade from full strength at the origin to zero at the range. |
| `bias` | Nonnegative origin offset along the geometric normal, smaller than range. Omit it to derive a small offset from the receiver's scene dimensions and coordinate precision. |
| `selfOcclusion` | `all` includes both the receiver mesh and neighbors. `only` uses the receiver mesh, including its unselected submeshes. `exclude` uses neighboring meshes only. |
| `direction` | Optional nonzero scene XYZ axis. For maps other than directional AO, omitting it uses the receiver's interpolated normal. |
| `encoding` | `png8`, `png16` or `exr`. AO defaults to PNG8, bent normals to PNG16 and blocker direction to float EXR. |

The occlusion pass traces solid triangles in the receiver's static GLB or glTF scene, including active neighboring placements and both windings. The triangle receiving the sample is excluded from its own ray. Positions and directions use scene transforms. Other projection maps in the same job still use their chosen projection settings. Each map report records the resolved settings, traced and blocked rays, rejected back-hemisphere rays, empty lobes and triangle tests. A cone that lies completely below the receiving face returns open visibility.

PNG vector files map signed XYZ to RGB using `(xyz + 1) / 2`. OpenEXR stores float32 XYZ channels for vectors and a float32 Y channel for AO. When a bake refreshes a bitmap resource, AO becomes a mask, a bent normal becomes a typed world normal, and blocker direction becomes signed XYZ data. The workstation shows a PNG preview for EXR and downloads the original map.

## Moonwater Cloister demo

```sh
node examples/bake-occlusion/demo.cjs moonwater-cloister
ink-studio bake-job serve moonwater-cloister/cloister.bake.json --out moonwater-cloister/review
```

Open `moonwater-cloister/index.html` to compare the same pavers with ambient, contact and directional AO, the two vector maps, and the receiver-only and neighbors-only scope presets. The shaded preview uses the exported ambient and contact masks and the baked bent normals.
