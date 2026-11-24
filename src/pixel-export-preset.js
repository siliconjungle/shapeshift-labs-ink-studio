/* Portable settings shared by the pixel Workshop and export runner. */
const PixelExportPreset = (() => {
  const format = 'ink-studio/pixel-export-preset';
  const outputs = Object.freeze(['png','document','layer-deck','frames','atlas']);
  const channels = Object.freeze(['depth','normal','emission','silhouette']);
  const id = value=>typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const integer = (n,lo,hi)=>Number.isSafeInteger(n) && n >= lo && n <= hi;
  const path = value=>typeof value === 'string' && !!value.trim() && !value.includes('\0');
  const record = value=>!!value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key));
  const list = (value,test,limit)=>Array.isArray(value) && value.length > 0 && value.length <= limit &&
    Array.from(value).every(test) && new Set(value).size === value.length;
  const pair = value=>Array.isArray(value) && value.length === 2 && Array.from(value).every(Number.isFinite);

  function aux(source) {
    if (source === undefined) return;
    if (fields(source,['atlas','bindings','channels']) && path(source.atlas)) {
      if (source.bindings !== undefined && (!record(source.bindings) || Object.entries(source.bindings)
          .some(([key,value])=>!id(key) || !integer(value,0,32767))) ||
          source.channels !== undefined && !list(source.channels,name=>channels.includes(name),channels.length))
        throw new TypeError('Registered atlas bindings need frame IDs, view indices, and known map names');
      return source;
    }
    if (!fields(source,['frames','depthRange','depthOrigin','normalSpace','emissionMode']) || !record(source.frames) ||
        !Object.keys(source.frames).length || Object.entries(source.frames)
          .some(([key,row])=>!id(key) || !fields(row,channels) || !Object.keys(row).length || !Object.values(row).every(path)) ||
        source.depthRange !== undefined && (!pair(source.depthRange) || source.depthRange[1] < source.depthRange[0]) ||
        source.depthOrigin !== undefined && !Number.isFinite(source.depthOrigin) ||
        source.normalSpace !== undefined && !['view','asset'].includes(source.normalSpace) ||
        source.emissionMode !== undefined && !['add','baked'].includes(source.emissionMode))
      throw new TypeError('Auxiliary maps need an atlas or named frame PNGs with valid channel encodings');
    if (Object.values(source.frames).some(maps=>maps.depth) && !source.depthRange)
      throw new RangeError('Registered RGB24 depth PNGs need a depthRange');
    return source;
  }

  function prepare(source) {
    const allowed = ['format','version','id','outputs','colorMode','frames','tag','slice','pivot','unitsPerPixel','atlas','auxiliary'];
    if (!fields(source,allowed) || source.format !== format || source.version !== 1 || !id(source.id) ||
        !list(source.outputs,output=>outputs.includes(output),outputs.length) ||
        source.frames !== undefined && (!list(source.frames,id,1024) || source.tag !== undefined) ||
        source.tag !== undefined && !id(source.tag) || source.slice !== undefined && !id(source.slice) ||
        source.pivot !== undefined && (!id(source.pivot) && !pair(source.pivot)) ||
        source.unitsPerPixel !== undefined && (!Number.isFinite(source.unitsPerPixel) || source.unitsPerPixel <= 0))
      throw new TypeError('Use a version 1 pixel export preset with a stable ID, output targets and valid frame settings');
    const { colorMode = 'indexed', atlas = {}, auxiliary } = source;
    if (!['auto','indexed','rgba'].includes(colorMode) ||
        !fields(atlas,['maxWidth','maxHeight','padding','extrude','trim']))
      throw new TypeError('Choose an exact PNG color mode and valid atlas packing settings');
    const { maxWidth = 1024,maxHeight = 1024,padding = 1,extrude = 0,trim = false } = atlas;
    if (![maxWidth,maxHeight].every(n=>integer(n,1,8192)) || !integer(padding,0,128) ||
        !integer(extrude,0,padding) || typeof trim !== 'boolean' || trim && source.slice)
      throw new RangeError('Use bounded atlas dimensions, extrusion within padding, and either a slice or alpha trimming');
    return { ...structuredClone(source),colorMode,atlas:{ maxWidth,maxHeight,padding,extrude,trim },
      ...(auxiliary !== undefined && { auxiliary:structuredClone(aux(auxiliary)) }) };
  }

  return Object.freeze({ format,outputs,channels,prepare });
})();
if (typeof module !== 'undefined') module.exports = PixelExportPreset;
else globalThis[Symbol.for('ink-studio.pixel-export-preset')] = PixelExportPreset;
