/* Weighted and ordered exact texel picks for authored tile variants. */
(function (K) {
  const A = K.authoring, {freeze,hash01} = K.procedural.data;
  const format = 'ink-studio/tileset-collection';
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;

  function create(scene, request) {
    if (!record(request) || !id(request.id) || !Array.isArray(request.entries) || !request.entries.length ||
        Object.keys(request).some(key => !['format','version','id','entries','sequence'].includes(key)))
      throw new TypeError('A tile collection needs an ID and a nonempty list of entries');
    if (('format' in request || 'version' in request) && (request.format !== format || request.version !== 1))
      throw new TypeError('Expected a version 1 tile collection');
    const tilesets = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults);
    const seen = new Set();
    const entries = Array.from(request.entries,entry => {
      if (!record(entry) || !id(entry.id) || Object.keys(entry).some(key => !['id','weight','selection'].includes(key)))
        throw new TypeError('Each tile collection entry needs an ID, weight, and selection');
      if (seen.has(entry.id)) throw new RangeError('Duplicate tile collection entry '+entry.id);
      seen.add(entry.id);
      if (!Number.isFinite(entry.weight) || entry.weight < 0)
        throw new RangeError('Tile collection weight must be finite and nonnegative for '+entry.id);
      const {selection} = entry;
      if (selection?.format !== 'ink-studio/tileset-selection' || selection.version !== 1)
        throw new TypeError('Expected a version 1 exact texel pick for '+entry.id);
      const asset = tilesets.source(selection.tileset);
      return {id:entry.id,weight:entry.weight || 0,selection:TilesetSelection.pick(selection.tileset,asset,selection)};
    });
    if (!entries.some(entry => entry.weight > 0)) throw new RangeError('A tile collection needs a positive weight');
    const {sequence} = request;
    if (sequence !== undefined && (!Array.isArray(sequence) || !sequence.length ||
        !Array.from(sequence).every(entry => seen.has(entry))))
      throw new RangeError('A tile collection sequence needs a nonempty array of existing entry IDs');
    entries.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return freeze({format,version:1,id:request.id,entries,...(sequence && {sequence:[...sequence]})});
  }

  function read(scene, document) {
    if (document?.format !== format || document.version !== 1) throw new TypeError('Expected a version 1 tile collection');
    return create(scene,document);
  }

  function inspect(scene, document) {
    const collection = read(scene,document);
    const max = collection.entries.reduce((weight,entry) => Math.max(weight,entry.weight),0);
    const total = collection.entries.reduce((sum,entry) => sum+entry.weight/max,0);
    return freeze({collection,entries:collection.entries.map(entry => ({...entry,probability:(entry.weight/max)/total}))});
  }

  function sample(scene, document, {seed,key} = {}) {
    if (!Number.isSafeInteger(seed) || typeof key !== 'string' || !key.trim())
      throw new TypeError('Sampling a tile collection needs a safe integer seed and a nonempty key');
    const {collection,entries} = inspect(scene,document);
    let remaining = hash01(JSON.stringify([collection.id,seed,key]));
    let selected;
    for (const entry of entries) {
      if (!entry.probability) continue;
      selected = entry;
      remaining -= entry.probability;
      if (remaining < 0) break;
    }
    return freeze({collection:collection.id,version:collection.version,seed,key,...selected});
  }

  function prepareSequence(scene, document) {
    const collection = read(scene,document);
    if (!collection.sequence) throw new RangeError('The tile collection has no authored sequence');
    const byId = new Map(collection.entries.map(entry => [entry.id,entry]));
    const entries = collection.sequence.map(id => byId.get(id));
    function at(step) {
      if (!Number.isSafeInteger(step) || step < 0)
        throw new RangeError('A tile sequence step must be a nonnegative safe integer');
      const sequenceIndex = step%entries.length;
      return freeze({collection:collection.id,version:collection.version,step,sequenceIndex,...entries[sequenceIndex]});
    }
    return Object.freeze({id:collection.id,length:entries.length,at});
  }

  function play(scene, document, {step=0} = {}) {
    return prepareSequence(scene,document).at(step);
  }

  A.tilesetCollections = Object.freeze({create,inspect,sample,prepareSequence,play});
})(KIT);
