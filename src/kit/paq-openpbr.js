/* OpenPBR Surface input contract for graph-authored materials. */
(function (P) {
  const format = 'ink-studio/openpbr-core';
  const version = 1, spec = '1.1.2', colorSpace = 'srgb-linear';
  const record = P.graphTypes.validator('record');
  const empty = Object.freeze({});
  const field = (type, fallback, units = 'unitless', min = 0, max = 1) =>
    Object.freeze({ type, default: Array.isArray(fallback) ? Object.freeze(fallback) : fallback, units, min, max });
  const scalar = value => field('float', value);
  const rgb = (value = 1, max = 1) => field('color3', [value, value, value], 'unitless', 0, max);
  const direction = field('vector3', null, 'unitless', -Infinity, Infinity);
  const positive = value => field('float', value, 'unitless', Number.MIN_VALUE, Infinity);
  const inputs = Object.freeze({
    base_weight: scalar(1),
    base_color: rgb(.8),
    base_metalness: scalar(0),
    base_diffuse_roughness: scalar(0),
    specular_weight: field('float', 1, 'unitless', 0, Infinity),
    specular_color: rgb(),
    specular_roughness: scalar(.3),
    specular_roughness_anisotropy: scalar(0),
    specular_ior: positive(1.5),
    transmission_weight: scalar(0),
    transmission_color: rgb(),
    transmission_depth: field('float', 0, 'cm', 0, Infinity),
    transmission_scatter: rgb(0),
    transmission_scatter_anisotropy: field('float', 0, 'unitless', -1),
    transmission_dispersion_scale: scalar(0),
    transmission_dispersion_abbe_number: positive(20),
    subsurface_weight: scalar(0),
    subsurface_color: rgb(.8),
    subsurface_radius: field('float', 1, 'cm', 0, Infinity),
    subsurface_radius_scale: field('color3', [1, .5, .25]),
    subsurface_scatter_anisotropy: field('float', 0, 'unitless', -1),
    coat_weight: scalar(0),
    coat_color: rgb(),
    coat_roughness: scalar(0),
    coat_roughness_anisotropy: scalar(0),
    coat_ior: positive(1.6),
    coat_darkening: scalar(1),
    fuzz_weight: scalar(0),
    fuzz_color: rgb(),
    fuzz_roughness: scalar(.5),
    thin_film_weight: scalar(0),
    thin_film_thickness: field('float', .5, 'um', 0, Infinity),
    thin_film_ior: positive(1.4),
    emission_luminance: field('float', 0, 'nits', 0, Infinity),
    emission_color: rgb(1, Infinity),
    geometry_opacity: scalar(1),
    geometry_thin_walled: Object.freeze({ type: 'boolean', default: false }),
    geometry_normal: direction,
    geometry_coat_normal: direction,
    geometry_tangent: direction,
    geometry_coat_tangent: direction
  });

  function resolve(name, value) {
    const definition = inputs[name];
    const { type, min, max } = definition;
    const range = n => Number.isFinite(n) && n >= min && n <= max;
    if (type === 'float' && range(value) || type === 'boolean' && typeof value === 'boolean') return value;
    if (type === 'vector3' && value === null) return value;
    if ((type === 'color3' || type === 'vector3') && Array.isArray(value) && value.length === 3 &&
        Array.from(value).every(range) && (type !== 'vector3' || value.some(Boolean)))
      return Object.freeze(value.slice());
    throw new RangeError('Invalid ' + type + ' for OpenPBR input ' + name);
  }

  function map(name, image) {
    const definition = inputs[name];
    if (!P.graphImages.valid(image)) throw new TypeError('OpenPBR map ' + name + ' needs a typed image');
    const { intent, units, layout, precision, domain, alpha } = image.descriptor;
    const { data, channels } = image.raster;
    const full = precision === 'unorm8' ? 255 : precision === 'unorm16' ? 65535 : 1;
    const { type, min, max } = definition;
    if (type === 'vector3' && units === 'unitless' && alpha === 'none' &&
        (name.endsWith('_normal') ? intent === 'normal' :
          intent === 'data' && layout === 'rgb' && domain === 'finite')) {
      if (intent === 'data' && data.some(n => n < -1 || n > 1))
        throw new RangeError('OpenPBR tangent map ' + name + ' requires signed XYZ in [-1, 1]');
      return image;
    }
    if (type === 'float' && layout === 'r' && ['mask', 'data'].includes(intent) &&
        (units === definition.units || name === 'emission_luminance' && units === 'cd/m2' ||
          definition.units === 'um' && ['µm', 'μm'].includes(units))) {
      if (data.some(n => n / full < min || n / full > max))
        throw new RangeError('OpenPBR map samples outside the range for ' + name);
      return image;
    }
    if (type === 'color3' && intent === 'color') {
      for (let at = 0; at < data.length; at += channels) {
        const divisor = alpha === 'premultiplied' ? data[at + 3] || 1 : full;
        for (let c = 0; c < 3; c++)
          if (data[at + c] / divisor < min || data[at + c] / divisor > max)
            throw new RangeError('OpenPBR map samples outside the range for ' + name);
      }
      return image;
    }
    throw new TypeError('OpenPBR map ' + name + ' does not match its ' + type + ' and units');
  }

  function define(parameters = empty, maps = empty) {
    for (const value of [parameters, maps]) {
      if (!record(value)) throw new TypeError('OpenPBR inputs and maps must be named records');
      for (const key of Object.keys(value))
        if (!Object.hasOwn(inputs, key)) throw new RangeError('Unknown OpenPBR input ' + key);
    }
    const values = Object.fromEntries(Object.entries(inputs).map(([name, entry]) =>
      [name, Object.hasOwn(parameters, name) ? resolve(name, parameters[name]) : entry.default]));
    const bindings = Object.fromEntries(Object.entries(inputs).flatMap(([name]) =>
      Object.hasOwn(maps, name) ? [[name, map(name, maps[name])]] : []));
    return Object.freeze({ format, version, spec, colorSpace, parameters: Object.freeze(values), maps: Object.freeze(bindings) });
  }

  function read(packet) {
    if (!record(packet) || !record(packet.parameters) || !record(packet.maps) || packet.format !== format || packet.version !== version || packet.spec !== spec ||
        packet.colorSpace !== colorSpace || Object.keys(packet).length !== 6)
      throw new TypeError('Expected an OpenPBR surface packet in linear sRGB');
    return define(packet.parameters, packet.maps);
  }

  function describe(value) {
    const fields = Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, {
      type: input.type, ...(input.units && { units: input.units }), default: input.default,
      value: value.parameters[name], ...(Object.hasOwn(value.maps, name) && { map: value.maps[name].descriptor })
    }]));
    return { spec: value.spec, colorSpace: value.colorSpace, fields };
  }

  const operations = Object.freeze({
    'material.openPbr': {
      description: 'Author OpenPBR Surface values and typed texture bindings using standard input names.',
      inputs: {
        parameters: { type: 'record', default: empty, description: 'Uniform OpenPBR inputs in linear sRGB, with nits for emission, centimeters for depth and radius, and micrometers for film thickness.' },
        maps: { type: 'record', default: empty, description: 'Typed image bindings by standard input name. A map overrides the uniform value.' }
      },
      outputs: { value: 'record', report: 'record' },
      run({ parameters, maps }) {
        const value = define(parameters, maps);
        return { value, report: describe(value) };
      }
    }
  });
  P.openPbr = Object.freeze({ format, version, spec, colorSpace, inputs, define, read, describe, operations });
})(KIT.procedural);
