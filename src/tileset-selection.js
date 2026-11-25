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

  function completeGrid(grid, {width,height} = {}) {
    if (![width,height].every(Number.isSafeInteger) || width < 1 || height < 1 ||
        width > grid.width || height > grid.height)
      throw new RangeError('Tile width and height must be positive integers that fit the tileset');
    return {width:grid.width-grid.width%width,height:grid.height-grid.height%height};
  }

  function block(tileset, grid, rectangle, tile) {
    const {x,y,width,height} = pick(tileset,completeGrid(grid,tile),rectangle);
    const {width:tileWidth,height:tileHeight} = tile;
    if (x%tileWidth || y%tileHeight || width%tileWidth || height%tileHeight)
      throw new RangeError('A tile brush must start and end on whole tile boundaries');
    return {format:'ink-studio/tileset-brush',version:1,tileset,x,y,width,height,tileWidth,tileHeight,
      columns:width/tileWidth,rows:height/tileHeight};
  }

  const edges = ['top','bottom','left','right'];

  function uvMapping(grid, brush, changes = {}) {
    function check(inset) {
      if (!inset || Object.getPrototypeOf(inset) !== Object.prototype ||
          Object.entries(inset).some(([edge,value]) => !edges.includes(edge) || !Number.isFinite(value) || value < 0))
        throw new RangeError('UV insets need nonnegative finite texel distances for top, bottom, left, or right');
    }
    const saved = brush.uvInset === undefined ? {} : brush.uvInset;
    check(saved);
    check(changes);
    const uvInset = {top:0,bottom:0,left:0,right:0,...saved,...changes};
    const {x,y,width,height} = brush, {top,bottom,left,right} = uvInset;
    const texelBounds = [x+left,y+top,x+width-right,y+height-bottom];
    const normalize = ([u0,v0,u1,v1]) => [u0/grid.width,v0/grid.height,u1/grid.width,v1/grid.height];
    const uvBounds = normalize(texelBounds);
    if (!(uvBounds[0] < uvBounds[2] && uvBounds[1] < uvBounds[3]))
      throw new RangeError('UV insets must leave a positive sampling width and height');
    return {brush:{...brush,uvInset},texelBounds,uvBounds,sourceUVBounds:normalize([x,y,x+width,y+height])};
  }

  return Object.freeze({pick,between,block,uvMapping});
})();
if (typeof module !== 'undefined') module.exports = TilesetSelection;
