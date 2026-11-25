/* Exact top-down texel bounds for numeric and pointer picks. */
const TilesetSelection = (() => {
  function pick(tileset, grid, { x, y, width, height } = {}) {
    if (![x,y,width,height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1 ||
        width > grid.width-x || height > grid.height-y)
      throw new RangeError('Use whole texels inside the tileset with positive width and height');
    return {format:'ink-studio/tileset-selection',version:1,tileset,x,y,width,height};
  }

  function between([ax,ay], [bx,by]) {
    return {x:Math.min(ax,bx),y:Math.min(ay,by),width:Math.abs(bx-ax)+1,height:Math.abs(by-ay)+1};
  }

  const layoutKeys = ['paddingX','paddingY','offsetX','offsetY'];

  function tileSize(size) {
    if (!size || Object.getPrototypeOf(size) !== Object.prototype ||
        Object.keys(size).some(key => !['width','height',...layoutKeys].includes(key)) ||
        ![size.width,size.height].every(value=>Number.isSafeInteger(value) && value>=1 && value<=2048))
      throw new RangeError('Tile size needs an integer width and height from 1 to 2048 texels');
    const layout = {};
    for (const key of layoutKeys) {
      const value = size[key] === undefined ? 0 : size[key];
      if (!Number.isSafeInteger(value) || value<0 || value>2048)
        throw new RangeError('Tile padding and offsets need integer distances from 0 to 2048 texels');
      if (value) layout[key] = value;
    }
    return {width:size.width,height:size.height,...layout};
  }

  function gridFits(grid, size) {
    return (size.offsetX ?? 0)+size.width <= grid.width && (size.offsetY ?? 0)+size.height <= grid.height;
  }

  function block(tileset, grid, rectangle, size) {
    const tile = tileSize(size);
    if (!gridFits(grid,tile)) throw new RangeError('Tile dimensions and origin must fit the tileset');
    const {width:tileWidth,height:tileHeight,...layout} = tile;
    const {paddingX=0,paddingY=0,offsetX=0,offsetY=0} = layout;
    const strideX = tileWidth+paddingX, strideY = tileHeight+paddingY;
    // Stop at the content edge of the final complete tile.
    const widthLimit = offsetX+Math.floor((grid.width-offsetX+paddingX)/strideX)*strideX-paddingX;
    const heightLimit = offsetY+Math.floor((grid.height-offsetY+paddingY)/strideY)*strideY-paddingY;
    const {x,y,width,height} = pick(tileset,{width:widthLimit,height:heightLimit},rectangle);
    if (x < offsetX || y < offsetY || (x-offsetX)%strideX || (y-offsetY)%strideY ||
        (width+paddingX)%strideX || (height+paddingY)%strideY)
      throw new RangeError('A tile brush must start and end on whole tile boundaries');
    return {format:'ink-studio/tileset-brush',version:1,tileset,x,y,width,height,tileWidth,tileHeight,
      columns:(width+paddingX)/strideX,rows:(height+paddingY)/strideY,...layout};
  }

  function readBrush(grid, saved) {
    if (saved?.format !== 'ink-studio/tileset-brush' || saved.version !== 1)
      throw new TypeError('Expected a version 1 tileset brush');
    const layout = Object.fromEntries(layoutKeys.filter(key=>Object.hasOwn(saved,key)).map(key=>[key,saved[key]]));
    const selected = block(saved.tileset,grid,saved,{width:saved.tileWidth,height:saved.tileHeight,...layout});
    if (saved.columns !== selected.columns || saved.rows !== selected.rows)
      throw new RangeError('Tile brush row and column counts do not match its bounds');
    return selected;
  }

  function hasGaps(brush) {
    return Boolean(brush.columns>1 && brush.paddingX || brush.rows>1 && brush.paddingY);
  }

  function cell(brush, {column,row}) {
    if (![column,row].every(Number.isSafeInteger) || column<0 || row<0 || column>=brush.columns || row>=brush.rows)
      throw new RangeError('Brush column and row must identify a cell inside the pick');
    const {tileWidth:width,tileHeight:height,paddingX=0,paddingY=0} = brush;
    return {column,row,x:brush.x+column*(width+paddingX),y:brush.y+row*(height+paddingY),width,height,
      offset:[column*width,row*height]};
  }

  function pack(brush, sourceWidth, pixels, channels) {
    const {x,y,tileWidth,tileHeight,columns,rows,paddingX=0,paddingY=0} = brush;
    const width = columns*tileWidth, height = rows*tileHeight;
    const packed = new Uint8Array(width*height*channels);
    const strips = paddingX ? columns : 1, span = paddingX ? tileWidth : width;
    for (let row=0;row<height;row++) {
      const sourceY = y+row+Math.floor(row/tileHeight)*paddingY;
      const start = sourceY*sourceWidth+x;
      for (let column=0;column<strips;column++) {
        const sample = start+column*(span+paddingX);
        packed.set(pixels.subarray(sample*channels,(sample+span)*channels),(row*width+column*span)*channels);
      }
    }
    return {width,height,pixels:packed};
  }

  const edges = ['top','bottom','left','right'];

  function uvMapping(grid, brush, changes = {}, sample) {
    function check(inset) {
      if (!inset || Object.getPrototypeOf(inset) !== Object.prototype ||
          Object.entries(inset).some(([edge,value]) => !edges.includes(edge) || !Number.isFinite(value) || value < 0))
        throw new RangeError('UV insets need nonnegative finite texel distances for top, bottom, left, or right');
    }
    const saved = brush.uvInset === undefined ? {} : brush.uvInset;
    check(saved);
    check(changes);
    const uvInset = {top:0,bottom:0,left:0,right:0,...saved,...changes};
    const {x,y,width,height} = sample ?? brush, {top,bottom,left,right} = uvInset;
    const texelBounds = [x+left,y+top,x+width-right,y+height-bottom];
    const normalize = ([u0,v0,u1,v1]) => [u0/grid.width,v0/grid.height,u1/grid.width,v1/grid.height];
    const uvBounds = normalize(texelBounds);
    if (!(uvBounds[0] < uvBounds[2] && uvBounds[1] < uvBounds[3]))
      throw new RangeError('UV insets must leave a positive sampling width and height');
    return {brush:{...brush,uvInset},...(sample && {cell:sample}),texelBounds,uvBounds,sourceUVBounds:normalize([x,y,x+width,y+height])};
  }

  return Object.freeze({pick,between,tileSize,layoutKeys:Object.freeze(layoutKeys),gridFits,block,readBrush,hasGaps,cell,pack,uvMapping});
})();
if (typeof module !== 'undefined') module.exports = TilesetSelection;
