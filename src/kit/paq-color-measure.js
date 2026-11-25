/* Decode one measurement channel for typed image analysis. */
const TypedImageMeasure = ({ requireImage, alphaAt, integerMax, convertColor, luminance }) =>
  function measure(source, { channel } = {}, maxCells = 6000000) {
    const { raster: grid, descriptor: spec } = requireImage(source);
    const { width, height, channels, data } = grid;
    if (width * height > maxCells) throw new RangeError('Typed image analysis exceeds its grid budget');
    const color = spec.intent === 'color';
    const name = channel ?? (color ? spec.alpha === 'none' ? 'luminance' : 'alpha' : 'value');
    if (color ? !['luminance', 'r', 'g', 'b', 'alpha'].includes(name) :
      channels !== 1 || spec.intent === 'normal' || name !== 'value')
      throw new TypeError('Typed image analysis needs a color channel or a single-plane numeric image');
    const divisor = integerMax(spec.precision) || 1;
    const component = ['r', 'g', 'b'].indexOf(name), rgb = [0, 0, 0];
    const decode = color && name !== 'alpha' && convertColor(spec, name === 'luminance' ? 'srgb-linear' : spec.colorSpace);
    function sample(p) {
      if (!color) return data[p] / divisor;
      const i = p * channels;
      if (name === 'alpha') return alphaAt(data, i, spec);
      if (!alphaAt(data, i, spec)) return 0;
      decode(data, i, rgb);
      return component < 0 ? luminance(rgb) : rgb[component];
    }
    return { grid, spec, width, height, sample, units: color ? 'unitless' : spec.units };
  };
