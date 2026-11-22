# Live scene hierarchy

`KIT.sceneGraph` provides one runtime hierarchy for geometry, pixel surfaces, point lights, inspection anchors and camera framing. It runs in Node and the browser with no dependencies. Geometry still uses the native SDF/splat and rig systems; the hierarchy supplies their transforms and inherited visibility.

Try [Lantern exchange](../examples/live-scene-hierarchy.html). A lantern carries a crisp pixel sigil, a working lamp and an inspection target. Transfer it between crane sockets while keeping its pose, dock it explicitly, hide whole branches, inspect local/world frames, or export the hierarchy. Free orbit remains available.

Apply recorded cast visibility and prop socket changes to a scene hierarchy. [Actor performance adapters](actor-performance.md)

## Nodes and affine transforms

```js
const graph = K.sceneGraph.create({nodes:{
  crane:{
    transform:{position:[-2,0,0]},
    sockets:{grip:{position:[1,3,0]}}
  },
  lantern:{
    parent:{node:'crane',socket:'grip'},
    transform:{position:[0,-1,0]}, kind:'geometry'
  },
  sigil:{parent:'lantern',kind:'sprite'},
  bulb:{parent:'lantern',kind:'light'},
  target:{parent:'lantern',kind:'inspection'}
}});
```

Each node accepts `parent` (null, a node ID, or `{node,socket}`), `transform`, local `visible:true`, named `sockets`, optional `kind:'group'` and `label` (default ID). Kinds are descriptive and extensible; bindings determine what resources a node controls. IDs are case sensitive, 1–128 characters, using letters, numbers, underscore, dot, colon or hyphen. Reserved prototype names are rejected. One graph holds at most 4096 nodes, 128 sockets per node and 128 parent levels. Parent/socket references and cycles are validated.

A transform is either `{position, rotation, scale}` or `{position,matrix}`. Position defaults to zero, quaternion rotation to `[0,0,0,1]`, and scale to one. Scale can be a scalar or XYZ vector, including reflections; zero scales and ill-conditioned matrices are rejected. Matrices are row-major 3×3, compatible with `K.M`. Coordinates/matrix entries must be bounded finite numbers; scale magnitudes range from `1e-6` to `1e6`. Local socket transforms use the same format.

Local/world queries return immutable frames. Resolved frames contain `{position,matrix,visible,version}`. Full affine matrices retain shear produced by rotated nonuniform scales. Reparenting does not attempt a lossy TRS decomposition.

```js
const local = graph.local('lantern');
const world = graph.frame('lantern'); // graph.world is an alias
const grip = graph.frame({node:'crane',socket:'grip'});
const point = graph.toWorld('lantern',[0,.5,0]);
const original = graph.toLocal('lantern',point);
const tangent = graph.direction('lantern',[1,0,0]);
const normal = graph.normal('lantern',[0,1,0]);
```

Directions include scale/shear; normals use the inverse transpose and normalize. `K.sceneGraph.transform`, `compose`, `inverse`, `point` and `reference` expose the same affine/reference helpers. `compose(parent,local)` follows the existing `K.M.mul` convention.

## Live editing and visibility

```js
graph.setLocal('crane', {position:[-1,0,0]});
graph.setWorld('lantern', {position:[0,2,0]});
graph.setSocket('crane','grip',{position:[1.5,3,0]});
graph.reparent('lantern',{node:'other-crane',socket:'grip'});
```

`setLocal` and `setWorld` replace the supplied node transform, with omitted transform fields taking their defaults. `reparent(id,parent,{keepWorld:true})` preserves the complete world pose by default. Pass `keepWorld:false` to keep the local transform instead. Reparenting to null detaches to the world root. Children preserve their pose along with the parent being reparented; visibility follows the new ancestry.

`setVisible(id,boolean)` changes local intent. Effective visibility is the conjunction of the node and all ancestors. Hiding/revealing a parent retains individual child choices. Socket attachments inherit their owner’s visibility.

Other methods: `ids()`, `has(id)`, `node(id)`, `children(id)` (null for roots), `add(id,definition)`, `remove(id,{subtree:false})`, `removeSocket(id,name)`, `snapshot()` and `reset()`. Removing a node with children requires `subtree:true`; removing an occupied socket fails. Unknown parents, cycles and singular local transforms fail before those edits commit. World composition/inversion also checks numeric bounds. `reset()` restores the graph’s initial definition, not the stage clock or unrelated simulation state.

`update()` returns `{revision,changed}`. World matrices are cached and dirty propagation visits descendants through a child index. `frame()` resolves pending changes lazily. Repeating a query without an edit preserves the frame version. Structural edits and pose changes remain separate from geometry rebaking.

## Bind native resources

```js
const binding = K.sceneGraph.attach(world, graph, {
  geometry:[{node:'lantern',part:'lantern-body'}],
  sprites:[{node:'sigil',first:6,count:6}],
  lights:[{node:'bulb',light:lamp,touch:()=>lighting.touch()}],
  sockets:[{node:'bulb',name:'lantern.light'}]
});
```

`attach` installs the graph on `world.sceneGraph`, uses/creates a native stage, and adds its binding system. One active binding owns a world. Every row accepts a `node` ID and optional `socket`. Bindings capture the resource’s current world placement and the node’s initial frame. Subsequent node changes apply the relative affine transform, so attaching already placed geometry or decals does not double-translate them.

### Geometry

Choose exactly one of `part` (an existing bound rig part), `indices` (unowned splat IDs), or `selector` (a native `TargetSelectors` selector). Overlapping ownership, empty selections and invalid indices fail explicitly. Raw index/selector bindings must not claim existing rig-owned splats; use their part instead. Skinned geometry keeps its skeletal transform authority and uses a custom adapter. Existing rig parts retain their current pose at attachment. Additional unowned groups extend the existing rig without invalidating its existing matrices, ownership or free flags. A world without a rig receives a native rig through `K.rig.fromGroups`.

The existing rig path transforms positions, covariance and surface normals consistently. Bindings are authoritative for claimed parts: drive the graph from animation systems placed before the binding, rather than also writing the same rig matrices. Native free/debris and physics-owned splats are excluded from graph motion and visibility masking.

Inherited visibility is applied after stage painters. Hidden alpha is restored before the next update so authors’ changing opacity and paint remain intact; a parent reveal does not revive content whose authored opacity is zero. Native stages now support a general `system.post(dt,time,stage)` phase after paint and before atmosphere history capture.

### Pixel sprites and decals

`sprites` rows take optional `atlas` (default `world.spriteSurfaces`), `first` and `count` in **vertices**, with triangle-aligned ranges (multiples of three). Defaults bind the whole atlas. A quad has six vertices. Atlas containers must be mutable, as returned by `SpriteSurface.make().finish()`. UVs and pixels remain intact. Hidden triangles collapse to zero area and restore on reveal. Multiple nonoverlapping ranges can share an atlas.

`SpriteSurface.markGeometryDirty(atlas,{first,count})` and `geometryUpdatesSince(atlas,revision)` provide a general geometry revision channel, independent of texture revisions. GPU consumers stream changed vertex spans with `bufferSubData`; pixel edits continue to use the existing dirty texture rectangles. Histories support independent renderers; a consumer that misses the bounded history falls back to the complete geometry span.

### Lamps, targets and sockets

Light bindings accept mutable legacy lamps `{p,r,s,off}` or scene point lights `{p,radius,intensity,...}`. `offset:[0,0,0]` and `direction:[0,0,1]` are node-local. Positions and directions follow the full matrix; range scales by the largest column length unless `scaleRange:false`. Hidden legacy lamps turn off; hidden scene lights emit zero intensity. `touch` notifies existing captured-light systems when values change.

A default source copies authored strength/range/off settings. To animate those settings independently, pass a separate `source` object; the output `light` is owned by the binding. Color and other renderer settings remain on the light object. Area emitters have surface-specific orientation/shape rules; use a custom adapter for them.

Inspection definitions can use `{node,socket?,point?,halfSize?}` as their `at` anchor:

```js
const inspection={targets:[{
  id:'relay',at:{node:'target'},label:'RELAY 07',ripple:{chars:'01:+*'}
}]};
```

Hidden or removed nodes do not resolve, so labels, glyph ripples and magnifiers follow visibility. `point` and anchor `halfSize` are local; the latter resolves to a world-axis-aligned extent. Target-level halfSize retains its existing world-space meaning. Camera-rig named targets also accept `{node,socket?,offset?,fallback?}`.

Exported `sockets` rows use `name` and optional local `direction` (default up). They are available through `stage.where(name)` and existing stage socket consumers. Hidden socket exports are withdrawn, then restored when visible.

### Adapters and lifecycle

Custom `adapters:[{node,socket?,apply(frame,{world,graph,stage}),restore?}]` extend the same frame contract to application-specific components. Apply callbacks run when the resolved frame/visibility changes. Use them for renderer-specific emitters, audio sources, constraints or collision representations. Transform authority, collision updates, skeletal articulation and simulation state remain with their existing systems; binding a rigid visual group does not rebuild its authored SDF/collider or take over skinning.

`binding.apply()` synchronizes immediately outside a stage tick. `dispose()` restores captured poses, alpha, sprite vertices, light settings and socket registrations, removes its stage callback, and permits another binding. Keep the world’s baked splat/atlas layout stable while bound; dispose/rebind when replacing those resources. Attach hierarchy bindings before downstream light systems, or notify those systems when changing ownership.

## Import existing rigs and prefabs

```js
const imported = K.sceneGraph.fromRig(rig,{parts:{
  arm:{joint:[0,2,0]},hand:{parent:'arm',joint:[1,2,0]}
}});
const binding=K.sceneGraph.attach(world,imported.graph,{geometry:imported.geometry});
```

`fromRig` snapshots current bound part poses, uses optional rest-space joints/parents, and returns `{graph,geometry}`. Without a joint, the part origin is zero. `fromDiorama(world,env)` imports current rig parts plus unowned named/static geometry and expanded prefab instance roots. The optional `env` is the same external prefab environment used to build the scene. Placed prefabs retain their placement transform and qualified IDs. Both imports create pose snapshots with correct reset baselines; they do not automatically copy external animation writers into the graph. Drive imported nodes explicitly when making the hierarchy their transform authority.

`K.rig.assign(nameOrPartIndex,indices)` also exposes setup-time ownership reassignment on native rigs, and `K.rig.fromGroups(stage,groups)` constructs a native rig from baked indices. Runtime reassignment updates affected lists and expands matrix storage while keeping existing part transforms. It changes ownership; use graph reparenting when world-pose preservation is required.

## CLI

```sh
node cli/ink-studio.js hierarchy hierarchy.json --node lantern
node cli/ink-studio.js hierarchy hierarchy.json --node lantern --parent crane --socket grip --out transferred.json
node cli/ink-studio.js hierarchy hierarchy.json --node lantern --point 0,1,0
```

`--parent world` detaches; `--keep-local` opts out of preserving world pose. Point conversion defaults to local-to-world; `--to-local` reverses it. Reports contain the reusable `definition`, resolved `frames`, and optional selected node/point. A report can be passed back to the CLI, or restore its definition with `K.sceneGraph.create(report.definition)`.
