/* Portable sample metadata, exact capture ranges and a searchable index. */
(function (P) {
  const A = P.mediaGraph, H = P.musicHarmony;
  const record = P.graphTypes.validator('record');
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
  const id = P.musicInstruments.id;
  const int = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const kinds = ['file', 'mic', 'world', 'instrument', 'stem', 'bus', 'graph'];
  const attributes = ['id', 'label', 'material', 'articulation', 'pitch', 'tags', 'license'];
  const entryFields = [...attributes, 'sampleRate', 'channels', 'frames', 'duration', 'source', 'asset', 'print'];
  const folded = value => value.normalize('NFKC').trim().toLowerCase();
  const defined = value => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));

  function pitchOf(value) {
    if (typeof value === 'string') return H.midi(value);
    if (Number.isFinite(value) && value >= 0 && value <= 127) return value;
    throw new RangeError('Sample pitch needs a MIDI note name or number');
  }
  function entry(raw) {
    if (!fields(raw, entryFields) || !id(raw.id) || !text(raw.label) ||
        [raw.material, raw.articulation].some(value => value !== undefined && !text(value)) ||
        !int(raw.sampleRate, 1, 768000) || !int(raw.channels, 1, 64) || !int(raw.frames, 1, 32e6 / raw.channels) ||
        raw.duration !== raw.frames / raw.sampleRate ||
        raw.asset !== undefined && (typeof raw.asset !== 'string' || !/^[a-f0-9]{64}$/.test(raw.asset)))
      throw new TypeError('Invalid audio sample catalog entry');
    const {source, tags = [], license = {id:'unknown'}} = raw;
    if (!Array.isArray(tags) || tags.length > 32 || !Array.from(tags).every(text) ||
        !fields(license, ['id', 'credit', 'url']) || !text(license.id) ||
        [license.credit, license.url].some(value => value !== undefined && !text(value)))
      throw new TypeError('Invalid audio sample tags or license');
    if (!fields(source, ['kind', 'name', 'reference', 'firstSample', 'endSample', 'sampleRate', 'gain', 'recipe']) ||
        !kinds.includes(source.kind) || !text(source.name) ||
        source.reference !== undefined && !text(source.reference) || source.sampleRate !== raw.sampleRate ||
        !int(source.firstSample, 0, Number.MAX_SAFE_INTEGER - raw.frames) ||
        source.endSample !== source.firstSample + raw.frames ||
        source.gain !== undefined && !(Number.isFinite(source.gain) && source.gain > 0 && source.gain <= 1))
      throw new TypeError('A sample needs a named source and a matching absolute sample range');
    const {pitch: note, print, ...rest} = raw;
    return P.data.freeze({...defined(rest), ...(note !== undefined && {pitch:pitchOf(note)}),
      ...(print!==undefined && {print:A.audioPrint.metadata(print,raw)}),
      tags:[...new Set(tags)], license:defined(license), source:defined({ ...source,
        ...(source.recipe !== undefined && { recipe:A.soundRecipe.normalize(source.recipe) }) })});
  }
  function describe(audio, metadata, source) {
    const {sampleRate, channels, samples} = A.audio(audio);
    if (!fields(metadata, attributes)) throw new TypeError('Invalid audio sample metadata');
    const frames = samples.length / channels;
    return entry({...metadata, sampleRate, channels, frames, duration:frames/sampleRate, source});
  }
  function capture(audio, options) {
    if (!fields(options, ['sample', 'source', 'firstSample', 'endSample']))
      throw new TypeError('Sample capture needs metadata, a source and an optional frame range');
    const {sampleRate,channels,samples} = A.audio(audio), frames = samples.length / channels;
    const {firstSample = 0, endSample = frames, source} = options;
    if (!int(firstSample, 0, frames-1) || !int(endSample, firstSample+1, frames) ||
        !fields(source, ['kind', 'name', 'reference', 'firstSample', 'endSample', 'sampleRate', 'gain', 'recipe']))
      throw new RangeError('Capture range is outside the audio or has an invalid source');
    const base = source.firstSample ?? 0;
    if (!int(base, 0, Number.MAX_SAFE_INTEGER-frames) ||
        source.endSample !== undefined && source.endSample !== base+frames ||
        source.sampleRate !== undefined && source.sampleRate !== sampleRate)
      throw new RangeError('Capture source does not match the input audio');
    const value = {sampleRate, channels, samples:samples.slice(firstSample*channels, endSample*channels)};
    const metadata = describe(value, options.sample, {...source, sampleRate,
      firstSample:base+firstSample, endSample:base+endSample});
    return {value, entry:metadata};
  }
  function create(rows) {
    if (!Array.isArray(rows) || rows.length > 16384) throw new RangeError('Invalid audio sample catalog size');
    const entries = Array.from(rows, entry), byId = new Map(entries.map(row => [row.id, row]));
    if (byId.size !== entries.length) throw new RangeError('Sample catalog IDs must be unique');
    return Object.freeze({
      get: name => byId.get(name) ?? null,
      search(options = {}) {
        if (!fields(options, ['query','material','articulation','pitch','cents','minDuration','maxDuration',
          'sourceKind','sourceName','license','offset','limit']))
          throw new TypeError('Invalid sample catalog filters');
        const {query = '',material,articulation,pitch,cents = 0,minDuration = 0,maxDuration = Infinity,
          sourceKind,sourceName,license,offset,limit} = options;
        if (typeof query !== 'string' || query.length > 512 ||
            ![material,articulation,sourceName,license].every(value => value===undefined || text(value)) ||
            sourceKind !== undefined && !kinds.includes(sourceKind) ||
            !Number.isFinite(cents) || cents < 0 || cents > 1200 ||
            !Number.isFinite(minDuration) || minDuration < 0 ||
            typeof maxDuration !== 'number' || !(maxDuration >= minDuration))
          throw new RangeError('Invalid sample catalog filter values');
        const midi = pitch === undefined ? undefined : pitchOf(pitch);
        const match = (value, filter) => filter === undefined || value !== undefined && folded(value) === folded(filter);
        const selected = entries.filter(row => match(row.material,material) && match(row.articulation,articulation) &&
          match(row.source.kind,sourceKind) && match(row.source.name,sourceName) && match(row.license.id,license) &&
          row.duration >= minDuration && row.duration <= maxDuration &&
          (midi === undefined || row.pitch !== undefined && Math.abs(row.pitch-midi)*100 <= cents+1e-8));
        const result = P.assetCatalog.create(selected.map(row => ({
          id:row.id,label:row.label,keywords:[row.material,row.articulation,row.source.name,row.source.kind,
            row.source.reference,row.license.id,row.license.credit,...row.tags].filter(Boolean)
        }))).search({query,offset,limit});
        return P.data.freeze({total:result.total,items:result.items.map(row => byId.get(row.id))});
      }
    });
  }
  A.sampleCatalog = Object.freeze({capture, describe, entry, create});
})(KIT.procedural);
