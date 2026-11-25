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

  return Object.freeze({pick,between});
})();
if (typeof module !== 'undefined') module.exports = TilesetSelection;
