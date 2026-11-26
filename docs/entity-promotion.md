# Promote objects from a running scene

Keep a deliberately selected set of objects from a committed simulation frame
as native editable scene geometry. The operation samples the source once,
then writes independently editable solids with stable IDs, world transforms and
material assignments.

```sh
ink-studio scene inspect-entities run-checkpoint.json
ink-studio scene promote-entities run-checkpoint.json selection.json --dry-run
ink-studio scene promote-entities run-checkpoint.json selection.json --out retained.json
ink-studio scene promote-entities run-checkpoint.json selection.json --into shot.json --out shot-with-pieces.json
```

```json
{
  "format": "ink-studio/entity-promotion",
  "version": 1,
  "id": "kiln-pieces",
  "select": [
    { "field": "rig/bodies", "body": "tile.0" },
    { "field": "rig/bodies", "body": "tile.2" }
  ]
}
```

| Selector | Captures |
| --- | --- |
| `{ "field": "rig/bodies", "body": "tile.0" }` | One body from a qualified runtime field, including generated fracture pieces. |
| `{ "entity": "arrangement", "descendants": true }` | One named visual entity and, optionally, its attached descendants. |
| `{ "spawn": { "id": "lantern", "generation": 3 } }` | A loaded lifecycle group with the exact generation. |
| `{ "within": { "point": [0, 1, 0], "radius": 2 } }` | Visual objects whose sampled origins fall within the sphere. |

The CLI accepts native world manifests, checkpoints, recordings at their
saved endpoint, and native place saves. For a saved place session,
`--place ID` selects the saved place. By default it uses the saved active
place. Use `inspect-entities` for the exact body IDs and lifetime handles
in that frame. Entity descendants use their resolved world transforms,
including socket offsets and rotation. Promotion flattens those transforms
into a named diorama group with independently editable solids.

Promotion retains native visual boxes and playable mechanics bodies such as
box fragments, supported colliders and permanently bent bodies. It copies
fracture face windows and their retained stamps, including the material
assigned to fresh faces. Visual-only particles and simulation systems
remain part of the source run. The output can be reopened in the scene
editor and rendered without running the original simulation.

When adding to a diorama, swatches are matched by exact RGB and appended
when needed. A palette conflict or occupied object ID aborts the
operation. Retrying the same selection from the same frame retains
matching IDs. Write the output beside the destination when it contains
relative assets.

Use `ink.promoteSceneEntities(source, selection, { base, place })` for a
plan and receipt in Node. A live runtime or active native portal session
can be supplied directly. On a scene editor, `planEntityPromotion` uses
the editor's scene as the destination. `applyEntityPromotion` commits
the change in one undoable transaction.

```sh
node examples/entity-promotion-demo.cjs /tmp/ink-entity-promotion
```

The kiln demo fractures a painted ceramic tile, promotes four selected
pieces from tick 29, and moves one of the saved pieces independently.
