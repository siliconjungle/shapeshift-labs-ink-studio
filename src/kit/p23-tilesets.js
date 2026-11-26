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

  const tileDimensions = size => size == null ? null : freeze(TilesetSelection.tileSize(size));

  function positiveScale(value, label) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(label+' must be a finite positive number');
    return value;
  }

  function encodeRaster(bytes) {
    let data = '';
    for (let i=0;i<bytes.length;i+=8192) data += String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(data);
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

  function namedPalette({palette,paletteMetadata}) {
    if (!palette) throw new TypeError('A named tileset palette needs an indexed image');
    return PixelPalette.fromStamp({swatchIds:palette.map((_,i)=>'slot-'+i),...paletteMetadata,
      palette:palette.map(color=>'#'+color.toString(16).padStart(6,'0'))},{max:256});
  }

  const paletteMetadata = palette=>({swatchIds:palette.swatches.map(row=>row.id),...PixelPalette.stampMetadata(palette)});

  function appendSwatch(metadata,preferred) {
    const ids = metadata.swatchIds, stem = preferred ?? 'slot-'+ids.length;
    let next = stem, suffix = 2;
    while (ids.includes(next)) {
      const tail = '-'+suffix++;
      next = stem.slice(0,64-tail.length)+tail;
    }
    return {...metadata,swatchIds:[...ids,next]};
  }

  function image(source) {
    if (!record(source) || source.version !== 1 || !['rgba8','indexed8'].includes(source.encoding))
      throw new TypeError('Expected a version 1 tileset image');
    const {width,height,encoding,data,palette,alpha,paletteMetadata:metadata} = source;
    dimensions(width,height);
    const tileSize = tileDimensions(source.tileSize), indexed = encoding === 'indexed8';
    if (Object.keys(source).some(key => !['version','width','height','encoding','data','tileSize',...(indexed ? ['palette','alpha','paletteMetadata'] : [])].includes(key)) ||
        !packed(data,width*height*(indexed ? 1 : 4)) ||
        indexed && (!Array.isArray(palette) || !palette.length || palette.length > 256 ||
          !Array.from(palette).every(color => Number.isInteger(color) && color >= 0 && color <= 0xffffff) ||
          alpha !== undefined && (!Array.isArray(alpha) || alpha.length > palette.length || !Array.from(alpha).every(byte))))
      throw new TypeError('Invalid '+encoding+' tileset image data');
    if (metadata!==undefined && (!record(metadata) || !Array.isArray(metadata.swatchIds) ||
        Object.keys(metadata).some(key=>!['swatchIds','swatchLabels','lockedSwatches','ramps'].includes(key))))
      throw new TypeError('Indexed tileset palette metadata needs swatch IDs and optional labels, locks, and ramps');
    const named = metadata!==undefined && paletteMetadata(namedPalette(source));
    if (indexed) {
      const slots = atob(data);
      for (let i=0;i<slots.length;i++) if (slots.charCodeAt(i) >= palette.length)
        throw new RangeError('Tileset image uses an index outside its palette');
    }
    return freeze({version:1,width,height,encoding,data,...(tileSize && {tileSize}),
      ...(indexed && {palette:[...palette],...(alpha !== undefined && {alpha:[...alpha]}),...(named && {paletteMetadata:named})})});
  }

  function prepare(sources = {}, defaults = {}) {
    if (!record(sources)) throw new TypeError('Scene tilesets need a map of image sources');
    if (!record(defaults) || Object.keys(defaults).some(key => !['tileSize','texelsPerUnit'].includes(key)))
      throw new TypeError('Scene tilesetDefaults accepts tileSize and texelsPerUnit');
    const defaultSize = tileDimensions(defaults.tileSize), texelsPerUnit = defaults.texelsPerUnit ?? null;
    if (texelsPerUnit !== null) positiveScale(texelsPerUnit,'Texels per unit');
    const prepared = new Map(), decoded = new Map();
    for (const [key,source] of Object.entries(sources)) {
      if (!id(key)) throw new TypeError('Invalid tileset ID '+key);
      const asset = image(source), size = asset.tileSize ?? defaultSize;
      if (size && !TilesetSelection.gridFits(asset,size))
        throw new RangeError('Tile size must fit tileset '+key);
      prepared.set(key,asset);
    }
    function source(key) {
      const asset = prepared.get(key);
      if (!asset) throw new RangeError('Unknown tileset '+key);
      return asset;
    }
    return {
      source,texelsPerUnit,
      grid(key) {
        const override = key === undefined ? null : source(key).tileSize;
        return {tileSize:override ?? defaultSize,source:override ? 'override' : defaultSize ? 'default' : 'unset'};
      },
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

  function checkScene(scene) {
    if (!record(scene) || typeof scene.id !== 'string' || !Array.isArray(scene.solids))
      throw new TypeError('A tileset needs a retained scene with an ID and solids');
  }

  function register(scene, key, source) {
    checkScene(scene);
    if (!id(key)) throw new TypeError('Use a lowercase tileset ID with letters, digits, and dashes');
    const current = scene.tilesets === undefined ? {} : scene.tilesets;
    if (!record(current)) throw new TypeError('Scene tilesets need a map of image sources');
    if (Object.hasOwn(current,key)) {
      const {tileSize:oldSize,...oldImage} = prepare(current,scene.tilesetDefaults).source(key);
      const {tileSize:newSize,...newImage} = image(source);
      if (JSON.stringify(oldImage) !== JSON.stringify(newImage))
        throw new RangeError('A different image is already registered as tileset '+key);
      if (newSize && JSON.stringify(newSize) !== JSON.stringify(oldSize))
        throw new RangeError('Edit the registered tile grid for '+key+' separately');
      return scene;
    }
    const tilesets = {...current,[key]:source};
    const asset = prepare(tilesets,scene.tilesetDefaults).source(key);
    return {...scene,tilesets:{...current,[key]:asset}};
  }

  function extract(scene, sourceId, targetId, rectangle) {
    checkScene(scene);
    if (sourceId === targetId) throw new RangeError('Extract the crop under a different tileset ID');
    const source = prepare(scene.tilesets,scene.tilesetDefaults).source(sourceId);
    const {x,y,width,height} = TilesetSelection.pick(sourceId,source,rectangle);
    const {encoding,palette,alpha,paletteMetadata} = source;
    const channels = encoding === 'indexed8' ? 1 : 4, pixels = atob(source.data), rows = [];
    for (let row=0;row<height;row++) {
      const start = ((y+row)*source.width+x)*channels;
      rows.push(pixels.slice(start,start+width*channels));
    }
    const asset = {version:1,width,height,encoding,data:btoa(rows.join('')),tileSize:{width,height},
      ...(palette && {palette}),...(alpha !== undefined && {alpha}),...(paletteMetadata && {paletteMetadata})};
    return register(scene,targetId,asset);
  }

  function gridPatch(scene, key, size) {
    checkScene(scene);
    if (key !== undefined && (!id(key) || !Object.hasOwn(scene.tilesets ?? {},key)))
      throw new RangeError('Unknown tileset '+key);
    const current = key === undefined ? scene.tilesetDefaults : scene.tilesets[key];
    const tileSize = tileDimensions(size);
    // The scene editor merges records. Reset any previous layout field omitted from the replacement.
    const fields = tileSize && {...Object.fromEntries(TilesetSelection.layoutKeys.filter(name=>
      Object.hasOwn(current?.tileSize ?? {},name)).map(name=>[name,0])),...tileSize};
    const patch = key === undefined ? {tilesetDefaults:{...current,tileSize:fields}} :
      {tilesets:{...scene.tilesets,[key]:{...current,tileSize:fields}}};
    const updated = {...scene,...patch};
    const grid = prepare(updated.tilesets,updated.tilesetDefaults).grid(key);
    return {patch,grid};
  }

  function scalePatch(scene, texelsPerUnit) {
    checkScene(scene);
    const density = texelsPerUnit === null ? null : positiveScale(texelsPerUnit,'Texels per unit');
    return {tilesetDefaults:{...scene.tilesetDefaults,texelsPerUnit:density}};
  }

  A.tilesets = Object.freeze({ maxEdge, validId:id, dimensions, encodeRaster, blank, prepare, register, extract, gridPatch, positiveScale, scalePatch, namedPalette, paletteMetadata, appendSwatch });
})(KIT);
