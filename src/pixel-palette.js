/* Editable palette assets shared by pixel documents and the stamp workshop. */
const PixelPalette = (() => {
  const format = 'ink-studio/pixel-palette', maxSwatches = 255;
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const rgb = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
  const label = value => typeof value === 'string' && value.trim().length > 0;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value,keys) => record(value) && Object.keys(value).every(key=>keys.includes(key));
  const unlocked = swatch => {
    if (!swatch.locked) return;
    const error = new RangeError('Swatch '+swatch.id+' is locked');
    error.conflicts = [{ code:'locked-swatch',swatch:swatch.id,message:error.message }];
    throw error;
  };

  function validate(source,{ max = maxSwatches } = {}) {
    if (!fields(source,['format','version','swatches','ramps']) || source.format !== format || source.version !== 1 ||
        !Array.isArray(source.swatches) || !source.swatches.length || source.swatches.length > max ||
        !Array.from(source.swatches).every(row=>fields(row,['id','color','label','locked']) && id(row.id) &&
          rgb(row.color) && (row.label === undefined || label(row.label)) &&
          (row.locked === undefined || typeof row.locked === 'boolean')))
      throw new TypeError('A pixel palette needs 1–255 ordered RGB swatches with IDs, optional names and locks');
    const ids = new Set(source.swatches.map(row=>row.id));
    if (ids.size !== source.swatches.length) throw new RangeError('Pixel swatch IDs must be unique');
    const ramps = source.ramps === undefined ? [] : source.ramps;
    if (!Array.isArray(ramps) || ramps.length > 255 ||
        !Array.from(ramps).every(row=>fields(row,['id','label','swatches']) && id(row.id) &&
          (row.label === undefined || label(row.label)) && Array.isArray(row.swatches) && row.swatches.length >= 2 &&
          Array.from(row.swatches).every(key=>ids.has(key)) && new Set(row.swatches).size === row.swatches.length) ||
        new Set(ramps.map(row=>row.id)).size !== ramps.length)
      throw new TypeError('Palette ramps need unique IDs and at least two distinct, existing swatches in order');
    return source;
  }

  function asset(swatches,ramps = [],options) {
    return validate({ format,version:1,swatches,ramps },options);
  }

  function fromStamp({ palette,swatchIds,swatchLabels = {},lockedSwatches = [],ramps },options) {
    if (!Array.isArray(palette) || !Array.isArray(swatchIds) || swatchIds.length !== palette.length ||
        !record(swatchLabels) || Object.keys(swatchLabels).some(key=>!swatchIds.includes(key)) ||
        !Array.isArray(lockedSwatches) || new Set(lockedSwatches).size !== lockedSwatches.length ||
        !Array.from(lockedSwatches).every(key=>swatchIds.includes(key)))
      throw new TypeError('Stamp palette names and locks must refer to existing swatch IDs');
    const locked = new Set(lockedSwatches);
    return asset(palette.map((color,i)=>{
      const id = swatchIds[i];
      return { id,color,...(Object.hasOwn(swatchLabels,id) && { label:swatchLabels[id] }),
        ...(locked.has(id) && { locked:true }) };
    }),ramps,options);
  }

  function stampMetadata({ swatches,ramps }) {
    const swatchLabels = Object.fromEntries(swatches.filter(row=>row.label !== undefined).map(row=>[row.id,row.label]));
    const lockedSwatches = swatches.filter(row=>row.locked).map(row=>row.id);
    return { ...(Object.keys(swatchLabels).length && { swatchLabels }),
      ...(lockedSwatches.length && { lockedSwatches }),...(ramps?.length && { ramps:structuredClone(ramps) }) };
  }

  function fromExtraction(report) {
    const used = report.swatches.filter(row=>report.source !== 'indexed' || row.includedPixels > 0);
    if (!used.length) throw new RangeError('No pixels match the palette extraction alpha mode');
    const ids = new Set();
    return asset(used.map(({ color,index })=>{
      const stem = 'extracted-'+color.slice(1);
      let id = report.source === 'indexed' ? stem+'-slot-'+index : stem;
      if (ids.has(id)) id = stem+'-'+index;
      ids.add(id);
      return { id,color };
    }));
  }

  function edit(source,operation) {
    const { swatches,ramps = [] } = validate(source);
    const entries = new Map(swatches.map(row=>[row.id,row])), namedRamps = new Map(ramps.map(row=>[row.id,row]));
    let replacements, removed = [];
    if (fields(operation,['type','swatch']) && operation.type === 'swatch') {
      const change = operation.swatch;
      if (!fields(change,['id','color','label','locked']) || !id(change.id) ||
          (change.color !== undefined && !rgb(change.color)) ||
          (change.label !== undefined && change.label !== null && !label(change.label)) ||
          (change.locked !== undefined && typeof change.locked !== 'boolean'))
        throw new TypeError('A swatch edit needs an ID and optional RGB, name or lock');
      const before = entries.get(change.id);
      if (!before && !change.color) throw new TypeError('New swatches need an RGB color');
      if (before && change.color && before.color.toLowerCase() !== change.color.toLowerCase()) unlocked(before);
      const row = { ...before,...change };
      if (row.label === null) delete row.label;
      if (!row.locked) delete row.locked;
      entries.set(row.id,row);
    } else if (fields(operation,['type','ramp']) && operation.type === 'ramp' && id(operation.ramp?.id)) {
      namedRamps.set(operation.ramp.id,operation.ramp);
    } else if (fields(operation,['type','id']) && operation.type === 'remove-ramp') {
      if (!namedRamps.delete(operation.id)) throw new RangeError('Unknown palette ramp '+operation.id);
    } else if (fields(operation,['type','order']) && operation.type === 'reorder') {
      const order = operation.order;
      if (!Array.isArray(order) || order.length !== entries.size || new Set(order).size !== entries.size ||
          !Array.from(order).every(key=>entries.has(key)))
        throw new RangeError('Palette reorder needs every swatch ID exactly once');
      return { palette:asset(order.map(key=>entries.get(key)),ramps),removed };
    } else if (fields(operation,['type','palette']) && operation.type === 'import') {
      const incoming = validate(operation.palette);
      for (const row of incoming.swatches) {
        const before = entries.get(row.id);
        if (before && before.color.toLowerCase() !== row.color.toLowerCase()) {
          unlocked(before);
          throw new RangeError('Imported swatch '+row.id+' has a different RGB value');
        }
        entries.set(row.id,before ? { ...row,...before,...(row.locked && { locked:true }) } : row);
      }
      for (const ramp of incoming.ramps ?? []) {
        const before = namedRamps.get(ramp.id);
        if (before && (before.swatches.length !== ramp.swatches.length ||
            before.swatches.some((key,i)=>key !== ramp.swatches[i])))
          throw new RangeError('Imported ramp '+ramp.id+' has a different swatch order');
        if (!before) namedRamps.set(ramp.id,ramp);
      }
    } else if (fields(operation,['type','map','removeSources']) && operation.type === 'remap' &&
        record(operation.map) && (operation.removeSources === undefined || typeof operation.removeSources === 'boolean')) {
      replacements = new Map();
      for (const [from,to] of Object.entries(operation.map)) {
        if (!entries.has(from) || !entries.has(to)) throw new RangeError('Remapping requires existing source and target swatches');
        if (from === to) continue;
        unlocked(entries.get(from));
        replacements.set(from,to);
      }
      if (!replacements.size) throw new RangeError('Choose at least one different target swatch');
      if (operation.removeSources) {
        if ([...replacements.values()].some(key=>replacements.has(key)))
          throw new RangeError('A remap target must stay in the palette when removing sources');
        removed = [...replacements.keys()];
        for (const key of removed) entries.delete(key);
        for (const [id,row] of namedRamps) {
          const swatches = [...new Set(row.swatches.map(key=>replacements.get(key) ?? key))];
          if (swatches.length < 2) throw new RangeError('Remap would leave ramp '+id+' with fewer than two swatches');
          namedRamps.set(id,{ ...row,swatches });
        }
      }
    } else {
      throw new TypeError('Choose a palette swatch, ramp, reorder, import, or remap operation');
    }
    return { palette:asset([...entries.values()],[...namedRamps.values()]),replacements,removed };
  }

  return Object.freeze({ asset, validate, fromStamp, stampMetadata, fromExtraction, edit });
})();
if (typeof module !== 'undefined') module.exports = PixelPalette;
else globalThis[Symbol.for('ink-studio.pixel-palette')] = PixelPalette;
