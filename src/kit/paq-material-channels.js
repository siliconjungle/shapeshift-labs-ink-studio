/* Keep named material maps together while editing individual channels. */
(function (K) {
  const P = K.procedural;
  const format = 'ink-studio/material-channels';
  const version = 1;
  const { validator } = P.graphTypes;
  const record = validator('record');
  const raster = validator('raster');
  const color = Object.freeze([3, 4]), scalar = Object.freeze([1]);
  const layouts = Object.freeze({
    baseColor: color, normal: color, height: scalar, roughness: scalar, metalness: scalar,
    ao: scalar, emission: color, opacity: scalar, flow: Object.freeze([2])
  });
  const maskName = /^mask\.[a-zA-Z][\w.-]{0,94}$/;
  const maxChannels = 64;
  const empty = Object.freeze({});

  function layout(name) {
    if (Object.hasOwn(layouts, name)) return layouts[name];
    if (maskName.test(name)) return scalar;
  }

  function validMap(name, map) {
    const components = layout(name), images = P.graphImages;
    if (components === undefined) return false;
    if (map?.format === images.format) {
      if (!images.valid(map)) return false;
      const { intent } = map.descriptor;
      const accepts = name === 'baseColor' || name === 'emission' ? ['color'] :
        name === 'normal' ? ['normal'] : name === 'height' ? ['height'] : name === 'flow' ? ['data'] : ['data', 'mask'];
      return accepts.includes(intent) && components.includes(map.raster.channels ?? map.descriptor.layout.length);
    }
    return raster(map) && components.includes(map.channels ?? map.data.length / (map.width * map.height));
  }

  function validMetadata(value) {
    if (!record(value)) return false;
    try { P.data.clone(value); }
    catch { return false; }
    return true;
  }

  function valid(value) {
    if (!record(value) || value.format !== format || value.version !== version || !record(value.channels) ||
        Object.keys(value).some(key => !['format', 'version', 'channels'].includes(key))) return false;
    const rows = Object.entries(value.channels);
    return rows.length > 0 && rows.length <= maxChannels && rows.every(([name, entry]) =>
      record(entry) && Object.keys(entry).every(key => key === 'raster' || key === 'metadata') &&
      validMap(name, entry.raster) && validMetadata(entry.metadata));
  }

  function withMaps(channels, maps, metadata) {
    if (!record(maps) || !record(metadata) || Object.keys(metadata).some(name => !Object.hasOwn(maps, name)))
      throw new TypeError('Material channel metadata must identify a supplied map');
    const rows = Object.entries(maps);
    const count = Object.keys(channels).length + rows.filter(([name]) => !Object.hasOwn(channels, name)).length;
    if (count < 1 || count > maxChannels) throw new RangeError('A material needs 1–64 named channels');
    const result = { ...channels };
    for (const [name, map] of rows) {
      if (!validMap(name, map)) throw new TypeError('Invalid material channel or raster component count for ' + name);
      const details = Object.hasOwn(metadata, name) ? metadata[name] : undefined;
      if (Object.hasOwn(metadata, name) && !record(details)) throw new TypeError('Expected metadata for material channel ' + name);
      const previous = Object.hasOwn(channels, name) ? channels[name].metadata : empty;
      result[name] = Object.freeze({ raster: map,
        metadata: details === undefined ? previous : P.data.freeze(P.data.clone(details)) });
    }
    return Object.freeze({ format, version, channels: Object.freeze(result) });
  }

  function pack(maps, metadata = empty) {
    return withMaps(empty, maps, metadata);
  }

  function channel(source, name) {
    if (typeof name !== 'string' || !Object.hasOwn(source?.channels ?? empty, name))
      throw new RangeError('Missing material channel ' + name);
    return source.channels[name];
  }

  function replace(source, maps, metadata = empty) {
    if (!valid(source)) throw new TypeError('Expected a version 1 material channel packet');
    return withMaps(source.channels, maps, metadata);
  }

  function layer(base, source, options = empty, mask = null) {
    if (!valid(base) || !valid(source)) throw new TypeError('Material layering needs two version 1 material channel packets');
    const { maps, metadata } = P.graphImages.layerMaterials(base.channels, source.channels, options, mask);
    return Object.keys(maps).length ? withMaps(base.channels, maps, metadata) : base;
  }

  const packetPort = { value: 'materialChannels' };
  const mapsPort = { maps: { type: 'record', description: 'Channel names mapped to raster values.' },
    metadata: { type: 'record', default: empty, description: 'Optional JSON metadata keyed by supplied channel.' } };
  const operations = Object.freeze({
    'material.pack': {
      description: 'Bundle named material rasters into one typed port, with independent map sizes and metadata.',
      inputs: mapsPort, outputs: packetPort,
      run({ maps, metadata }) { return { value: pack(maps, metadata) }; }
    },
    'material.channel': {
      description: 'Read a named raster and its metadata from a material port.',
      inputs: { source: 'materialChannels', name: 'string' }, outputs: { value: 'raster', metadata: 'record' },
      run({ source, name }) {
        const { raster, metadata } = channel(source, name);
        if (raster?.format === P.graphImages.format) throw new TypeError('Use material.image to read the contract for ' + name);
        return { value: raster, metadata };
      }
    },
    'material.image': {
      description: 'Read a contracted image and its material metadata without dropping the image contract.',
      inputs: { source: 'materialChannels', name: 'string' }, outputs: { value: 'typedImage', metadata: 'record' },
      run({ source, name }) {
        const { raster, metadata } = channel(source, name);
        if (raster?.format !== P.graphImages.format) throw new TypeError('Material channel ' + name + ' needs image.declare first');
        return { value: raster, metadata };
      }
    },
    'material.replace': {
      description: 'Replace or add only the supplied material maps. Pass all other channels through.',
      inputs: { source: 'materialChannels', ...mapsPort }, outputs: packetPort,
      run({ source, maps, metadata }) { return { value: withMaps(source.channels, maps, metadata) }; }
    },
    'material.layer': {
      description: 'Layer typed material maps with shared UV placement, coverage and height dominance, and per-channel blend rules.',
      inputs: {
        base: 'materialChannels', layer: 'materialChannels',
        options: { type: 'record', default: empty, description: 'Opacity, channel rules, UV transform, mask space and height dominance.' },
        mask: { type: 'any', default: null, description: 'Normalized grayscale coverage in layer or base UV space.' }
      },
      outputs: packetPort,
      run({ base, layer: source, options, mask }) { return { value: layer(base, source, options, mask) }; }
    }
  });

  P.materialChannels = Object.freeze({ format, version, valid, validMap, pack, channel, replace, layer, operations });
})(KIT);
