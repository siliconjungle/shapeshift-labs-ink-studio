# Hybrid edit ownership

A part can take its shape from an SDF, its pigment from a texture atlas,
and its fine detail from splats. Declare those sources once in the scene's
`hybridOwnership` field. Pixel edits can resolve the authoring destination
before they write, and bake tools can see which outputs depend on each
source channel.

## Declare the authored sources

Use an `ink-studio/hybrid-ownership` document with `version: 1`. The same
document works as a CLI sidecar or as a scene field.

```json
{
  "format": "ink-studio/hybrid-ownership",
  "version": 1,
  "sources": {
    "solid": { "kind": "sdf", "target": { "object": "relay-solid" } },
    "enamel": { "kind": "atlas", "target": { "object": "relay-atlas" } },
    "fringe": { "kind": "splats", "target": { "object": "relay", "part": "fringe" } }
  },
  "parts": [
    {
      "object": "relay",
      "part": "housing",
      "owners": {
        "shape": { "source": "solid", "destination": "carve" },
        "pigment": { "source": "enamel" },
        "coverage": { "source": "solid" },
        "detail": { "source": "fringe", "destination": "trim" }
      },
      "derived": [
        { "id": "render-mesh", "kind": "mesh" },
        { "id": "distant-card", "kind": "card" },
        { "id": "occlusion-proxy", "kind": "proxy" }
      ]
    }
  ]
}
```

Each logical object and part pair declares one owner for each of four
channels. Source kinds are `sdf`, `mesh`, `atlas`, `splats`, and `curves`.
An atlas can own pigment, coverage, or detail. Shape requires a geometry
source. A source target identifies the authored object and optionally a part.
Use the same source ID when sharing an authored channel across several parts.

A derived output can declare its own `target` when it appears in source
picking under a separate object or part ID. The pixel editor then guards
bindings to that output alongside bindings to the logical part and its
authored sources.

## Resolve and commit an edit

```sh
ink-studio hybrid-ownership inspect relay.json
ink-studio hybrid-ownership route relay.json relay housing shape
```

The SDK equivalents are `KIT.authoring.hybridOwnership.prepare(manifest)`,
`KIT.authoring.hybridOwnership.route(manifest, address)`, and
`sceneEditor.hybridRoute(address)`. A route includes the source ID, source
kind, physical target, destination if declared, and the derived outputs
that consume that source channel.

A `destination` names an existing pixel document edit destination. Its
binding must point at the declared source target with the matching object
and part scope. Write the route's destination into the usual pixel patch
along with the requested ownership address.

```json
{
  "destination": "carve",
  "ownership": { "object": "relay", "part": "housing", "channel": "shape" }
}
```

Include the normal edit ID, revision, frame, and operation. Source-bound
patches that touch managed targets require an ownership address. A
multi-channel operation must resolve all touched channels to the same
source and destination. A splat scope used exclusively for detail can
change the constituent splats through its detail route. Raster and shot
corrections remain available as presentation edits.

The preview and committed receipt include the verified route, touched
channels, and dependent output IDs. Source revision checks, undo, and
replay work through the existing pixel transaction API. An omitted
destination leaves that channel to its host authoring tool. The host
supplies the next pinned snapshot after making its edit.

## Rebuild from pinned inputs

| Output | Default dependencies | Required dependencies |
| --- | --- | --- |
| `mesh` | shape, pigment, coverage | shape |
| `card` | shape, pigment, coverage, detail | shape, pigment, coverage |
| `proxy` | shape, coverage | shape, coverage |

Set `uses` on an output to specify the channels its builder consumes.
All dependencies are declared against the authored sources. A report lists
the pinned input for each channel, the channels that changed, and whether
the output needs to be rebuilt.

```sh
ink-studio hybrid-ownership plan relay.json revisions.json \
  --previous prior-rebuild.json --out next-rebuild.json
```

Map source IDs to a stable string or nonnegative integer in
`revisions.json`. For independent changes inside a shared source, pin the
channels separately, for example
`{"solid":{"shape":3,"coverage":3},"enamel":{"pigment":8},"fringe":2}`.
A scalar applies to every channel the source owns. Advance each affected
pin when its authored input changes. A prior report is optional for the
first rebuild.

Use `KIT.authoring.hybridOwnership.create(manifest, builders)` to execute
the dependency plan in an SDK host. Register synchronous `mesh`, `card`,
and `proxy` callbacks for the output kinds used in the manifest. Each
callback receives `{ output, owned }`. The `owned` map contains only the
output's declared channels, with source IDs, targets, revisions, and the
host's snapshot values.

```js
const ownership = KIT.authoring.hybridOwnership.create(manifest, {
  mesh: ({ output, owned }) => buildMesh(output.id, owned),
  card: ({ output, owned }) => bakeCard(output.id, owned),
  proxy: ({ output, owned }) => buildProxy(output.id, owned)
});
const { assets, report } = ownership.rebuild({
  solid: { revision: { shape: 3, coverage: 3 }, value: solidScene },
  enamel: { revision: 8, value: pigmentAtlas },
  fringe: { revision: 2, value: splatSnapshot }
});
```

Treat snapshot values and built handles as immutable. The controller keeps
the exact handles for reused outputs and publishes the next set after
every required builder succeeds. It leaves the published set available
through `current()` if a builder throws. Builders own their file and GPU
resources. CLI planning only writes the report.

## Run the relay demo

```sh
node examples/hybrid-edit-ownership.cjs output/relay-ownership
```

The demo previews and applies a cut to an SDF through the pixel editor,
derives an indexed textured mesh and a depth proxy, and bakes a sprite
card with depth and normals. It then supplies revised atlas and fringe
snapshots independently. The comparison has the live asset in its top
row and the baked card below. The rebuild report shows which outputs each
step replaced, and the cut receipt records the authored destination.

To replay the exported cut preview with the CLI, run this from the output
directory.

```sh
ink-studio pixel-art preview pixel-document.json cut-patch.json --scene scene.json --exact
```
