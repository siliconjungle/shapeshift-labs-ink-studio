/* An editable grid of references to shared pixel document frames. */
const PixelTilemap = (() => {
  const fields = (row,names)=>row && Object.getPrototypeOf(row) === Object.prototype &&
    Object.keys(row).every(key=>names.includes(key));
  const dimension = value=>Number.isSafeInteger(value) && value > 0 && value <= 256;
  const validPoint = (at,width,height)=>Array.isArray(at) && at.length === 2 &&
    Number.isSafeInteger(at[0]) && Number.isSafeInteger(at[1]) && at[0] >= 0 && at[0] < width && at[1] >= 0 && at[1] < height;

  function prepare(source,frameIds,tileWidth,tileHeight) {
    if (source === undefined) return;
    if (!fields(source,['version','width','height','cells']) || source.version !== 1 ||
        !dimension(source.width) || !dimension(source.height) || !Array.isArray(source.cells))
      throw new TypeError('Use a version 1 tilemap with 1–256 columns and rows and a list of cells');
    const { width,height,cells } = source, w = width*tileWidth, h = height*tileHeight;
    if (w > 4096 || h > 4096 || w*h > 4_000_000 || cells.length > width*height)
      throw new RangeError('Tilemap exceeds the native raster budget');
    const placed = new Map();
    for (const row of cells) {
      if (!fields(row,['at','tile']) || !validPoint(row.at,width,height) ||
          typeof row.tile !== 'string' || !frameIds.has(row.tile))
        throw new RangeError('Map cells need native cell coordinates and a known tile frame ID');
      const key = row.at[1]*width+row.at[0];
      if (placed.has(key)) throw new RangeError('Tilemap repeats cell '+row.at.join(', '));
      placed.set(key,row.tile);
    }
    return { width,height,w,h,tileWidth,tileHeight,placed };
  }

  function place(source,frameIds,tileWidth,tileHeight,points,tile) {
    const grid = prepare(source,frameIds,tileWidth,tileHeight);
    if (!grid) throw new RangeError('Create a tilemap before placing tiles');
    const { width,height,placed } = grid;
    if (tile !== null && (typeof tile !== 'string' || !frameIds.has(tile)))
      throw new RangeError('Place a known tile frame ID or use null to erase');
    if (!Array.isArray(points) || !points.length || points.length > width*height ||
        !Array.from(points).every(at=>validPoint(at,width,height)))
      throw new RangeError('A tile stroke needs cell coordinates inside the map');
    const changes = [];
    for (const at of points) {
      const key = at[1]*width+at[0], before = placed.get(key) ?? null;
      if (before === tile) continue;
      if (tile === null) placed.delete(key);
      else placed.set(key,tile);
      changes.push({ at:[...at],before,after:tile });
    }
    if (!changes.length) return { tilemap:source,changes };
    const cells = [...placed].sort(([a],[b])=>a-b).map(([key,tile])=>({ at:[key%width,Math.floor(key/width)],tile }));
    return { tilemap:{ ...source,cells },changes };
  }

  function raster(grid,read) {
    const { width,w,h,tileWidth,tileHeight,placed } = grid, rgba = new Uint8Array(w*h*4), tiles = new Map();
    for (const [key,id] of placed) {
      if (!tiles.has(id)) {
        const image = read(id);
        if (image?.width !== tileWidth || image?.height !== tileHeight || image.rgba?.length !== tileWidth*tileHeight*4)
          throw new RangeError('Tile raster needs the native document dimensions for '+id);
        tiles.set(id,image.rgba);
      }
      const pixels = tiles.get(id), x = key%width*tileWidth, y = Math.floor(key/width)*tileHeight;
      for (let row=0;row<tileHeight;row++) {
        const start = row*tileWidth*4;
        rgba.set(pixels.subarray(start,start+tileWidth*4),((y+row)*w+x)*4);
      }
    }
    return { w,h,rgba };
  }

  return Object.freeze({ prepare,place,raster });
})();
if (typeof module !== 'undefined') module.exports = PixelTilemap;
else globalThis[Symbol.for('ink-studio.pixel-tilemap')] = PixelTilemap;
