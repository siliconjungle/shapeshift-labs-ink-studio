# Randomness authoring

`K.random` and `K.procedural.random` expose the same dependency-free authoring API. Name each decorative system, then address individual object properties by stable keys. Streams own independent cursors; keyed samples have no cursor. Editing flowers therefore need not consume any lantern, terrain, or tree choices.

The interactive [seeded courtyard](../examples/randomness.html) demonstrates this on retained native SDF/splat geometry. Change flower variants, add flowers, switch height distributions, or adjust tree correlation. The comparison panel checks the original non-flower choices. Its pixel grass uses a separate coherent field; lantern decals have their own keys.

## Names and stable object keys

```js
const random = K.random.create('garden-v3');
const flowers = random.stream('vegetation', 'flowers');
const lanterns = random.stream('lighting', 'lanterns');

const height = K.random.distribution({
  type:'normal', mean:1, deviation:.2, min:.5, max:1.5
});
for (const id of stableFlowerIds) {
  const h = flowers.sample([id,'height'], height);
  const width = flowers.sample([id,'width'], {type:'uniform', min:.7, max:1.2});
  const species = flowers.sample([id,'species'], {
    type:'choice', values:['daisy','bell','clover'], weights:[5,2,1]
  });
  plantFlower({id,h,width,species});
}
const drop = lanterns.sample(['lamp-west','drop'], {type:'triangular',min:.3,max:.7,mode:.45});
```

Seeds and path/key components are nonempty strings (up to 256 UTF-16 code units) or safe integers. Zero is a real seed. Numeric `42` and string `'42'` are distinct. A path has at most 32 components; `stream('a/b')` differs from `stream('a','b')`. Names use their literal string identity, with no locale-dependent collation or implicit Unicode normalization.

- `random.stream(...names)` retrieves the same cached handle for that full path. Creation order does not affect its values.
- `stream.fork(...suffix)` retrieves a child path without consuming a parent draw. A named child is cached too.
- `stream.sample(key, distribution?)` is stateless. A key can be one component or an array of components. Reordering objects, adding another keyed property, or adding more objects leaves earlier addresses unchanged.
- `stream.next(distribution?)` advances this stream's cursor by **one authoring slot**. Each slot has its own internal subdraws, so changing one slot's distribution does not shift later slots.
- `stream.at(index, distribution?)` reproduces `next` at that ordinal without advancing. Ordinal addresses and object-key addresses are separate namespaces: `at(7)` is not `sample(7)`.
- `stream.seek(index=0)`, `skip(count)`, and `cursor` control/inspect an individual cursor. `random.reset()` rewinds every cached cursor.
- `stream.batch(count, distribution?)` prepares the distribution once and generates a bounded sequence. A failed batch restores its cursor and activation state.
- `stream.order(keys)` returns a stable random priority order without changing a cursor. Added keys can insert into that order, but existing keys retain their relative order. Use `.slice(0,count)` for nested selections. Keys must be unique.

For a deliberate local revision, include a revision in that system's keys: `flowers.sample([revision,id,'height'],height)`. Keep other system names/keys unchanged. The courtyard changes only its flower revision. Increasing its visible flower count activates more preallocated IDs; it does not reroll the existing prefix.

Names isolate systems, not arbitrary source-code edits. Reordering sequential `next()` calls within one stream changes which call owns which slot. Use stable keys for object properties that must survive such edits. Runtime frame numbers should not be used as permanent object IDs.

## Distribution controls

Prepare a distribution once for repeated use, or pass its JSON description directly. Definitions are copied/frozen; returned JSON choices are independent copies. `prepared.spec` is the normalized editable/serializable recipe, and `prepared.cost` is its conservative word requirement. Scalar distributions expose `quantile(u)` for `[0,1]`.

| Type | Controls | Behavior |
| --- | --- | --- |
| `uniform` | `min:0,max:1` | Even variation; equal bounds give a constant. |
| `integer` | `min:0,max:1` | Inclusive signed 32-bit bounds. Direct draws use unbiased rejection, capped at 64 attempts. |
| `normal` | `mean:0,deviation:1,min?,max?,bounds:'truncate'` | Positive deviation. Bounds condition the distribution by default; `bounds:'clamp'` piles clipped tails onto the endpoints instead. |
| `logNormal` | `logMean:0,logDeviation:1,min:0,max:1e9` | A truncated normal in logarithmic coordinates, exponentiated into positive values. |
| `triangular` | `min:0,max:1,mode:(min+max)/2` | Concentrates around the mode; endpoints and a constant range are supported. |
| `exponential` | `mean:1,min:0,max:1e9` | Conditional exponential over the declared interval. Shifted evaluation handles intervals far into the tail without subtractive cancellation. |
| `power` | `min:0,max:1,exponent:2` | `min+(max-min)*u^exponent`; exponent above one favors the low end. |
| `bernoulli` | `probability:.5` | Boolean outcome. Zero/one probabilities are exact. |
| `choice` | `values`, optional `weights` | Up to 1,024 finite JSON choices; nonnegative weights, positive total. Zero weights are never selected. |
| `correlated` | `channels`, optional `correlation` | Named multivariate variation, described below. |

Normal means/deviations are bounded to practical authoring ranges (mean ±1e6, deviation `[1e-8,1e6]`); logarithmic mean is in `[-30,30]` and deviation `[1e-8,8]`. Numeric bounds are finite, normally within ±1e9. Power exponents are `.01`–`100`. Invalid/empty normal intervals or truncated intervals with probability mass below `1e-12` fail before consuming a slot. The normal CDF uses a fixed approximation with about `8e-8` maximum absolute error; these are authoring distributions, with finite random-word tail resolution.

Scalar quantile endpoints return declared bounded endpoints where applicable. Unbounded normal tails use the generator's finite probability resolution. Integer/choice quantiles discretize the input probability; direct integer draws use the rejection sampler instead.

## Correlated variation

```js
const variation = K.random.correlated({
  channels:[
    {name:'height', distribution:{type:'normal',mean:1,deviation:.2}},
    {name:'crown',  distribution:{type:'normal',mean:1,deviation:.15}},
    {name:'hue',    distribution:{type:'uniform',min:.45,max:.55}}
  ],
  correlation:[ [1,.8,0], [.8,1,0], [0,0,1] ]
});
const tree = random.stream('trees').sample('birch-west', variation);
// {height, crown, hue}; the same key always retains its latent choices.
```

This is a Gaussian copula: the matrix describes correlations of latent standard-normal channels. It is also the output Pearson correlation for unbounded normal marginals, within numerical approximation. With bounded, skewed, or discrete marginals it expresses latent dependence rather than promising the same output Pearson coefficient.

Matrices must match the ordered channels, be symmetric, have unit diagonal, and be positive semidefinite (numerical tolerance `1e-10`). Perfect positive/negative correlations are supported without adding hidden diagonal noise. There are at most 32 distinct channel names. Omitted matrices are identity matrices; nested correlated channels are rejected. `distribution({type:'correlated',...})` accepts the same recipe.

Each independent latent draw is keyed by its channel name. Appending channels preserves earlier channels when their earlier matrix block stays unchanged. Changing a marginal preserves its latent draw. Channel order is explicitly part of the recipe: reordering a Cholesky factorization can change a particular sample while preserving the intended statistics. A full correlated record advances a sequential stream by one slot, not one slot per property.

## Coherent spatial variation

```js
const patches = K.random.spatial(random.stream('grass','patches'), {
  dimension:2, scale:[1.4,1.4], octaves:3,
  persistence:.5, lacunarity:2, min:.7, max:1.3
});
const tuftHeight = patches(x,z);
const {value,gradient} = patches.sample(x,z);
```

This adapter reuses the library's seeded simplex fields. Nearby points vary smoothly and share patches; their values stay within `min/max`. It never consumes stream draws. Dimensions 2–4 are supported; the fourth coordinate can be time. Each scale is a positive correlation length. Octaves are bounded to 1–8; persistence is `[0,1]`, lacunarity `[1,8]`. `field.spec` reports stream provenance, seed, and controls; `field.cost` reports the octave count. Gradients carry the correct scale and octave factors and become zero at clipped bounds.

Noise values are coherent variation, not exact independent uniform/normal marginals. Use a copula for controlled property correlation and a noise field for spatial coherence. This adapter's numeric seed bridges to the existing noise implementation.

The scalar expression compiler also accepts:

```js
const field = K.procedural.fields.compile({
  type:'namedNoise', stream:['terrain','moss'], seed:731,
  scale:[2,1,2]
});
```

It compiles ordinary simplex noise with a seed derived from the named stream. Spatial/time derivatives and existing scalar field consumers remain supported. It is independent of other expression nodes' evaluation order.

## Existing generators and tools

`stream.seed32` is a stable nonzero numeric seed for existing APIs:

```js
const seed = random.stream('rocks','surface-detail').seed32;
const builder = makeBuilder(seed,palette);
const dice = K.grow.dice(seed);
// Existing placement/growth/noise APIs accepting a numeric seed can use it too.
```

This bridge compresses a path into 32 bits, so it has the collision limits of existing numeric-seed APIs. The new stream's own addressed draws retain its full derived key. `K.seed`, `K.rnd`, `K.hash`, existing `K.grow.dice`, and their old sequences are unchanged. Scenes opt into the new names/keys; this does not silently repartition legacy global random calls. If a builder or third-party procedural step owns its own RNG, give independently editable systems separate derived builder seeds as well.

## Checkpoints and budgets

```js
const saved = JSON.parse(JSON.stringify(random.snapshot()));
random.restore(saved);                 // existing handles remain valid
const resumed = K.random.from(saved);  // a new context with the saved limits
```

Checkpoints contain algorithm version, typed master seed, budgets, full stream paths and cursors. Recipes remain application state: pass the same distributions when replaying a checkpoint. Restore validates the entire checkpoint before mutation. An algorithm/seed mismatch, duplicate path, invalid cursor or incompatible budget is rejected. Handles created after a checkpoint rewind to zero and become inactive in snapshots until reactivated; they continue to count against the allocated-handle budget. Restoring does not invalidate a held reference.

`create(seed,{maxStreams,maxDraws,maxWords,maxBatch})` defaults to 1,024 allocated named streams, 10,000,000 sequential slots per stream, 256 internal words per sampled value/record, and 65,536 batch/ranking items. Limits are explicit; invalid inputs or budget failures do not advance a cursor. Each scalar sample, matrix factorization, integer rejection loop and coherent field has bounded work. Correlated records consume two words per latent channel; their small fixed factorization is prepared once. A fixed word budget is a work guard, not a wall-clock prediction.

The algorithm tag is `ink/counter-random/1`; numeric replay fixtures protect its bit-generator sequence. Floating transforms use JavaScript math and may differ in the last bits across engines. For persistent scene choices, store the versioned checkpoint plus recipes and stable IDs, or bake the final authoring records. `Randomness` is exported from the Node and browser modules for renderer-independent use.

## CLI inspection

```json
{
  "seed":"garden-v3",
  "streams":[
    {"path":["lanterns"],"keys":["west","east"],
     "distribution":{"type":"integer","min":2,"max":7}},
    {"path":["flowers"],"count":16,
     "distribution":{"type":"normal","mean":1,"deviation":0.2,"min":0.5,"max":1.5}}
  ]
}
```

```sh
ink-studio randomness recipe.json --out report.json
ink-studio randomness recipe.json --samples 32
```

Reports include normalized distributions, named numeric seeds, values, cursors and a replay checkpoint. `keys` request addressed samples without advancing; `count` requests sequential samples. They are mutually exclusive. `--samples` overrides sequential counts. Correlated distributions use the same `distribution` field. Recipe reports are capped at 256 streams and 4,096 samples per entry, in addition to context budgets.
