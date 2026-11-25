/* Scene-local image sources shared by editable mesh materials. */
(function (K) {
  const A = K.authoring, { freeze } = K.procedural.data;
  const maxEdge = 2048;
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) && value !== 'constructor';
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const byte = value => Number.isInteger(value) && value >= 0 && value <= 255;

  function dimensions(width, height) {
    if (![width,height].every(edge => Number.isInteger(edge) && edge >= 1 && edge <= maxEdge))
      throw new RangeError('Tileset images need dimensions from 1 to '+maxEdge+' texels per side');
  }

  function blank({ width, height, background = 'transparent' } = {}) {
    dimensions(width,height);
    const color = background === 'transparent' ? [0,0,0,0] : DrawingPrimitives.color(background);
    const pixel = String.fromCharCode(...color);
    const data = btoa(pixel.repeat(width*height));
    return freeze({version:1,width,height,encoding:'rgba8',data});
  }

  function packed(value, length) {
    const padding = (3-length%3)%3;
    return typeof value === 'string' && value.length === 4*Math.ceil(length/3) &&
      value.endsWith('='.repeat(padding)) && value[value.length-padding-1] !== '=' &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  function image(source) {
    if (!record(source) || source.version !== 1 || !['rgba8','indexed8'].includes(source.encoding))
      throw new TypeError('Expected a version 1 tileset image');
    const {width,height,encoding,data,palette,alpha} = source;
    dimensions(width,height);
    const indexed = encoding === 'indexed8';
    if (Object.keys(source).some(key => !['version','width','height','encoding','data',...(indexed ? ['palette','alpha'] : [])].includes(key)) ||
        !packed(data,width*height*(indexed ? 1 : 4)) ||
        indexed && (!Array.isArray(palette) || !palette.length || palette.length > 256 ||
          !Array.from(palette).every(color => Number.isInteger(color) && color >= 0 && color <= 0xffffff) ||
          alpha !== undefined && (!Array.isArray(alpha) || alpha.length > palette.length || !Array.from(alpha).every(byte))))
      throw new TypeError('Invalid '+encoding+' tileset image data');
    if (indexed) {
      const slots = atob(data);
      for (let i=0;i<slots.length;i++) if (slots.charCodeAt(i) >= palette.length)
        throw new RangeError('Tileset image uses an index outside its palette');
    }
    return freeze({version:1,width,height,encoding,data,
      ...(indexed && {palette:[...palette],...(alpha !== undefined && {alpha:[...alpha]})})});
  }

  function prepare(sources = {}) {
    if (!record(sources)) throw new TypeError('Scene tilesets need a map of image sources');
    const prepared = new Map(), decoded = new Map();
    for (const [key,source] of Object.entries(sources)) {
      if (!id(key)) throw new TypeError('Invalid tileset ID '+key);
      prepared.set(key,image(source));
    }
    function source(key) {
      const asset = prepared.get(key);
      if (!asset) throw new RangeError('Unknown tileset '+key);
      return asset;
    }
    return {
      source,
      resolve(texture) {
        if (!record(texture) || !Object.hasOwn(texture,'tileset')) return;
        const key = texture.tileset;
        if (!id(key) || Object.keys(texture).length !== 1)
          throw new TypeError('A tileset texture needs a single tileset ID');
        if (!decoded.has(key)) {
          const {width,height,encoding,data,palette,alpha} = source(key), bytes = atob(data);
          const pixels = new Uint8Array(width*height*4);
          if (encoding === 'rgba8') {
            for (let i=0;i<bytes.length;i++) pixels[i] = bytes.charCodeAt(i);
          } else {
            for (let i=0;i<bytes.length;i++) {
              const slot = bytes.charCodeAt(i), color = palette[slot], offset = i*4;
              pixels[offset] = color >> 16;
              pixels[offset+1] = color >> 8;
              pixels[offset+2] = color;
              pixels[offset+3] = alpha?.[slot] ?? 255;
            }
          }
          decoded.set(key,{width,height,pixels});
        }
        return decoded.get(key);
      }
    };
  }

  function register(scene, key, source) {
    if (!record(scene) || typeof scene.id !== 'string' || !Array.isArray(scene.solids))
      throw new TypeError('A tileset needs a retained scene with an ID and solids');
    if (!id(key)) throw new TypeError('Use a lowercase tileset ID with letters, digits, and dashes');
    const current = scene.tilesets === undefined ? {} : scene.tilesets;
    prepare(current);
    const asset = image(source);
    if (Object.hasOwn(current,key)) {
      if (JSON.stringify(image(current[key])) !== JSON.stringify(asset))
        throw new RangeError('A different image is already registered as tileset '+key);
      return scene;
    }
    return {...scene,tilesets:{...current,[key]:asset}};
  }

  A.tilesets = Object.freeze({ dimensions, blank, prepare, register });
})(KIT);
