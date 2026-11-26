# Headless assembly review

Save an assembly review preset beside the shot or keep it in an agent
session. The preset scopes the rendered image and can guard edits.
Review renders leave the source scene, history, camera setup and shot
lighting intact.

```sh
ink-studio assembly-review inspect shot.json review.json
ink-studio assembly-review render shot.json review.json --out review.png
ink-studio assembly-review check shot.json review.json proposed-shot.json
```

```json
{
  "format": "ink-studio/assembly-review",
  "version": 1,
  "isolate": ["part:relay"],
  "hide": ["paint:sculpt/housing", "light:lamp/0"],
  "freeze": ["part:sensor"],
  "revealThrough": ["mesh:serviceTag"],
  "lighting": "neutral",
  "time": 1.5
}
```

| Setting | Behavior |
| --- | --- |
| `isolate` | Keep the selected geometry and its paint. Selecting paint also includes its receiving geometry. Light-only isolation keeps the rest of the scene visible. |
| `hide` | Takes precedence over isolate and reveal. Hide a carrier, suppress a paint layer, or mute an authored light for this review. The authored rig stays available for posing. |
| `freeze` | Protect records from edits, including additions to the frozen assembly and removal or reparenting of its members. Freezing a rig part includes descendants, their geometry and paint, and lamps attached to them. Use `time` to pin the sampled pose. |
| `revealThrough` | Tint the covered portions of the selected geometry with a translucent cyan overlay. Revealing paint shows its carrier. Positional lights get a locator. `revealOpacity` controls the geometry overlay strength from 0 to 1. |
| `lighting` | `"shot"` uses authored lighting. `"neutral"` uses a neutral directional key and ambient fill, with the shot lights muted. Neutral and scoped views omit reflections and water from the review. |
| `time` | Optional fixed review times from 0 to 120 seconds. When omitted, use `--t` for a still at another pose. |

Use `inspect` to discover exact addresses. `sculpt:`, `mesh:`, `part:`,
`group:`, and `prefab:` refer to scene IDs. Linked placements use
their expanded names. Paint uses `paint:sculpt/ID` for retained sculpt
paint, `paint:mesh/ID` for editable mesh pigment maps, and
`paint:decal/ID`, `paint:region/ID`, or `paint:finish/ID` for the
corresponding retained layers. Mesh pigment suppression preserves
coverage and the material's non-pigment maps. Light addresses include
`light:sun`, `light:lamp/INDEX`, `light:area/ID`,
`light:shot/ROLE` and indexed volume lights. An empty preset lists the
available targets. Geometry isolation and hiding filter contributions
in the inspection view. Under authored lighting, the full shot can
still contribute to baked shadows.

Apply a preset to a Node editor with `editor.setAssemblyReview(preset)`.
`editor.setAssemblyReview(null)` clears it. The guard rejects ordinary
transaction edits and history changes that affect frozen records.
`editor.pick(ray)` respects the visible scope, and
`editor.pick(ray, { through: true })` tests only reveal targets.
Use `ink.renderAssemblyReview(editor, preset, view)` for a PNG-ready
frame and report. `check` reports frozen conflicts with exit status 1
and keeps both files intact.

The relay demo compares the authored shot, foreground reveal, neutral
isolation and paint suppression. It also emits the rejected edit receipt.

```sh
node examples/assembly-review-demo.cjs /tmp/ink-assembly-review
```
