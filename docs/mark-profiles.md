# Paint with custom mark profiles

Shape the individual dabs that make up a 3D stroke. A profile defines its outline, spacing, pigment coverage, grain, and raised depth. Reuse a named profile across a painting or mix two profiles along one stroke.

A `mark-profile` brush can take an inline definition or the name of a profile in the painting's `profiles` map. Place it on a free mark, bind it to a surface, or attach it to a rig part with the usual [3D painting settings](painting-3d.md).

```json
{
  "kind": "mark-profile",
  "profile": {
    "silhouette": [[[-0.16, -0.04], [0.12, -0.07], [0.17, 0.03], [-0.11, 0.065]]],
    "spacing": 0.20,
    "coverage": { "opacity": 0.92, "feather": 0.008 },
    "grain": { "amount": 0.24, "scale": 0.026, "seed": 31 },
    "depth": { "back": 0.02, "curve": [[0, 0.01], [0.045, 0.07]] }
  }
}
```

| Control | Behavior |
| --- | --- |
| `silhouette` | One or more filled polygons in the brush's local XY plane. The points are in scene units. Use multiple outlines for crossed nibs or islands. |
| `spacing` | Distance between dab centers along the stroke, in scene units before placement. Ink also places a dab at the final pose. A one-pose mark places one dab. |
| `coverage` | Pigment `opacity` from 0 to 1 and an optional inward `feather` distance. Both default to full coverage at the edge. |
| `grain` | Seeded variation in coverage. Set `amount` from 0 to 1 and `scale` as the size of the grain in scene units. It follows brush orientation and placement. |
| `depth` | The `back` distance extends behind the brush plane. The `curve` sets front height at successive inward distances from the outline. Start at distance 0. Ink interpolates between pairs and holds the last height toward the center. |

Existing pressure controls still apply. Width scales each dab and pressure opacity multiplies its profile coverage. A ruled stroke spaces its dabs along the ruled guide. Surface-bound strokes space their dabs on the projected path.

## Mix profiles over a stroke

Put the two definitions under `painting.profiles` and give the brush a `mix` range. Range values express the start and end of the mix as fractions of the stroke length. Both profiles contribute in the mix, each on its own spacing. Ink eases both pigment coverage and depth from one profile to the other.

```json
{
  "kind": "mark-profile",
  "profile": "crosshatch",
  "mix": { "profile": "bark", "range": [0.28, 0.72] }
}
```

Use `painting-3d update` with a `profiles` map to replace one or more definitions by name. All the marks referencing those names pick up the changes. The update can also set a mark's `brush` to change its mix range. Extraction includes the profile definitions and original poses, so the painting can be rebound in another scene. A profile can be removed by passing `null` at its name and removing or reassigning its references in the same edit.

```sh
node examples/mark-profiles-demo.cjs /tmp/ink-mark-profiles
```
