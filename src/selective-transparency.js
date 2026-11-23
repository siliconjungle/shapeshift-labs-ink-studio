/* Shared settings and art-grid receipts for bounded local transparency. */
const SelectiveTransparency = (() => {
  const int = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;

  function prepare(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !['region','layers','maxPixels','colorDelta','depthBias','tileSize'].includes(key)))
      throw new TypeError('Selective transparency needs a settings object');
    const { region = [0,0,1,1], layers = 4, maxPixels = 65536,
      colorDelta = 2/255, depthBias = .0001, tileSize = 16 } = value;
    if (!Array.isArray(region) || region.length !== 4 || !Array.from(region).every(n => Number.isFinite(n) && n >= 0 && n <= 1) ||
        !region[2] || !region[3] || region[0]+region[2] > 1 || region[1]+region[3] > 1 ||
        !int(layers,2,8) || !int(maxPixels,1,1048576) || !int(tileSize,4,64) ||
        !Number.isFinite(colorDelta) || colorDelta < 0 || colorDelta > 1 ||
        !Number.isFinite(depthBias) || depthBias < 0 || depthBias > 1)
      throw new RangeError('Invalid selective transparency region, layer or pixel budget, tile size, or tolerance');
    return { region:region.slice(), layers, maxPixels, colorDelta, depthBias, tileSize };
  }

  function bounds([x,y,w,h], width, height) {
    const left = Math.floor(x*width), top = Math.floor(y*height);
    return [left,top,Math.ceil((x+w)*width)-left,Math.ceil((y+h)*height)-top];
  }

  const empty = () => ({ culledFragments:0, overlapPixels:0, crossingPixels:0, sortedPixels:0,
    layerBudgetPixels:0, fragmentBudgetPixels:0, pixelBudgetPixels:0 });
  function report(settings, width, height, details = {}) {
    const tiles = new Map(), totals = empty(), size = settings.tileSize;
    function record(x, y, key, amount = 1) {
      const left = Math.floor(x/size)*size, top = Math.floor(y/size)*size;
      const index = top*width+left;
      let tile = tiles.get(index);
      if (!tile) {
        tile = { x:left,y:top,width:Math.min(size,width-left),height:Math.min(size,height-top),...empty() };
        tiles.set(index,tile);
      }
      tile[key] += amount;
      totals[key] += amount;
    }
    function finish(extra = {}) {
      return { mode:'selective', width,height,settings,...details,...totals,...extra,
        tiles:[...tiles.entries()].sort((a,b)=>a[0]-b[0]).map(([,row])=>row) };
    }
    return { record, finish, totals };
  }

  return { prepare, bounds, report };
})();
if (typeof module !== 'undefined') module.exports = SelectiveTransparency;
else globalThis[Symbol.for('ink-studio.selective-transparency')] = SelectiveTransparency;
