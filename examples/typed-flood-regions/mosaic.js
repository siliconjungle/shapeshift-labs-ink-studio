/* Native enamel tesserae and a reusable stamped pigment pattern. */
const mosaicWidth = 136, mosaicHeight = 92;
const mosaicPalette = ['#438780','#316b73','#285968','#b86d52','#ca956a','#d2b37c','#477d77','#a65349','#79a08a'];
const mosaicModes = {
  glaze:'Glazed mosaic', id:'Region IDs', center:'Centroids', bounds:'Bounds', area:'Area',
  orientation:'Orientation', position:'Chart position', randomValue:'Random value', randomColor:'Random color',
  localUV:'Local UV', gradient:'Gradient', lookup:'Texture lookup'
};
const mosaicDefaults = { connectivity: 4, seed: 86, border: { u: 'wrap', v: 'wrap' } };
const mosaicAngle = -33;
const mosaicClamp = v => Math.min(1, Math.max(0, v));

function mosaicSources() {
  const width = mosaicWidth, height = mosaicHeight, data = new Uint8Array(width * height);
  const knots = [[0,0],[29,6],[54,1],[83,11],[109,6],[133,28],[22,29],[49,26],[73,37],[104,33],
    [3,58],[25,58],[47,52],[65,64],[92,56],[114,61],[19,83],[44,78],[79,84],[106,81]];
  const difference = (n, span) => n - Math.round(n / span) * span;
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
    let a = Infinity, b = Infinity, ax = 0, ay = 0, bx = 0, by = 0;
    for (const [u,v] of knots) {
      const dx = difference(x + .5 - u, width), dy = difference(y + .5 - v, height), d = dx * dx + dy * dy;
      if (d < a) {
        b = a; bx = ax; by = ay;
        a = d; ax = dx; ay = dy;
      } else if (d < b) {
        b = d; bx = dx; by = dy;
      }
    }
    const clearance = (b - a) / (2 * Math.hypot(ax - bx, ay - by));
    data[p] = clearance >= 1.05 ? 255 : 0;
  }

  const size = 48, stamp = new Uint8Array(size * size * 4);
  for (let y = 0, at = 0; y < size; y++) for (let x = 0; x < size; x++, at += 4) {
    const u = (x + .5) / size - .5, v = (y + .5) / size - .5;
    const radius = Math.hypot(u,v), diamond = Math.abs(u) + Math.abs(v);
    const spiral = Math.sin(Math.atan2(v,u) * 3 - radius * 37);
    const curls = radius >= .10 && radius < .29 && spiral > .83;
    const dots = Math.abs(radius - .35) < .024 && Math.cos(Math.atan2(v,u) * 6) > .76;
    const center = diamond < .095;
    const ring = Math.abs(radius - .306) < .014;
    if (curls || dots || center || ring) {
      stamp.set(center || dots ? [246,220,159,218] : ring ? [41,55,63,112] : [33,67,71,189], at);
    }
  }
  return { cuts: { width, height, channels: 1, data }, stamp: { width: size, height: size, channels: 4, data: stamp } };
}

function mosaicGraph() {
  const link = (node, port = 'value') => ({ node, port });
  const input = input => ({ input });
  const op = (op, inputs) => ({ op, inputs });
  const tiling = { u: 'wrap', v: 'wrap' };
  const graph = { format: 'ink-studio/graph-project', version: 1,
    inputs: { cuts:'raster', stamp:'raster', flood:{ type:'record', default:mosaicDefaults },
      grad:{ type:'record', default:{ angle:mosaicAngle, align:'orientation' } },
      edge:{ type:'record', default:{ border:tiling, maxDistance:24 } } },
    nodes: {
      mask: op('image.declare',{ source:input('cuts'), descriptor:{ intent:'mask', precision:'unorm8', tiling } }),
      stamp: op('image.declare',{ source:input('stamp'), descriptor:{ intent:'color', precision:'unorm8' } }),
      packet: op('image.floodRegions',{ source:link('mask'),options:input('flood') }),
      glaze: op('image.regionMap',{ source:link('packet'), kind:'randomColor',options:{palette:mosaicPalette} }),
      gradient: op('image.regionMap',{ source:link('packet'), kind:'gradient',options:input('grad') }),
      depth: op('image.signedDistance',{ source:link('mask'),options:input('edge') }),
      lookup: op('image.regionLookup',{ regions:link('packet'),source:link('stamp'),options:{filter:'linear'} }),
      lookupPreview: op('image.toDisplay',{ source:link('lookup') })
    },
    outputs: { field:link('packet'), id:link('packet','labels'), glaze:link('glaze'), randomColor:link('glaze'),
      gradient:link('gradient'), depth:link('depth'), lookup:link('lookup'), lookupPreview:link('lookupPreview') },
    exports: { lookup:{output:'lookupPreview',format:'png'}, regions:{output:'field',format:'json'} }
  };
  for (const kind of Object.keys(mosaicModes)) {
    if (graph.outputs[kind]) continue;
    graph.nodes[kind] = op('image.regionMap',{ source:link('packet'), kind });
    graph.outputs[kind] = link(kind);
  }
  return graph;
}

function mosaicPreview(outputs, mode = 'glaze') {
  const { field, id: { raster: ids }, glaze, gradient, lookup, depth } = outputs;
  const { width, height, data: labels } = ids;
  const data = new Uint8Array(labels.length * 4), rows = new Map(field.regions.map(row => [row.id,row]));
  const colors = glaze.raster.data, slopes = gradient.raster.data, stamps = lookup.raster.data, distance = depth.raster.data;
  const sample = outputs[mode].raster.data;
  const alphaBlend = (a,b,t) => a + (b-a)*t;
  const tint = [0,0,0];
  const largest = Math.max(1, ...field.regions.map(row => row.area));
  function at(x,y) {
    return distance[((y + height) % height) * width + (x + width) % width];
  }
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
    const i = p * 4, label = labels[p];
    const speck = ((Math.imul(x + 19, 149) ^ Math.imul(y + 7, 2429)) >>> 0) % 71 < 3;
    tint[0] = speck ? 32 : 21; tint[1] = speck ? 45 : 32; tint[2] = speck ? 53 : 40;
    if (label) {
      const row = rows.get(label);
      if (mode === 'glaze') {
        const bevel = distance[p] >= -2.01 ? mosaicClamp(.53 + .27 * (at(x - 1,y - 1) - at(x + 1,y + 1))) : .53;
        const band = Math.round(slopes[p] * 9) / 9;
        const relief = (.62 + .51 * band + .33 * bevel) * (speck ? .87 : 1);
        for (let c = 0; c < 3; c++) tint[c] = alphaBlend(colors[i+c] * relief, stamps[i+c], .56 * stamps[i+3] / 255);
      } else if (mode === 'id') {
        const hue = (Math.imul(label, 2654435761) >>> 0) / 2 ** 32;
        for (let c = 0; c < 3; c++) tint[c] = 142 + 87 * Math.sin((hue + c / 3) * 2 * Math.PI);
      } else if (mode === 'randomColor') {
        for (let c = 0; c < 3; c++) tint[c] = sample[i+c];
      } else if (mode === 'lookup') {
        for (let c = 0; c < 3; c++) tint[c] = alphaBlend(colors[i+c] * .42, stamps[i+c], stamps[i+3] / 255);
      } else if (mode === 'bounds') {
        tint[0] = 47 + 270 * sample[i+2] / width;
        tint[1] = 68 + 308 * sample[i+3] / height;
        tint[2] = 122 + 130 * sample[i] / width;
      } else if (['center','position','localUV'].includes(mode)) {
        const u = mode === 'localUV' ? sample[2*p] : sample[2*p] / width;
        const v = mode === 'localUV' ? sample[2*p+1] : sample[2*p+1] / height;
        tint[0] = 35 + 184 * u;
        tint[1] = 35 + 186 * v;
        tint[2] = mode === 'center' && row.crosses.some(Boolean) ? 225 : 123;
      } else {
        const value = mode === 'area' ? sample[p] / largest : mode === 'orientation' ? .5 + sample[p] / Math.PI : sample[p];
        for (let c = 0; c < 3; c++) tint[c] = alphaBlend([39,55,73][c],[244,202,137][c],value);
      }
    }
    for (let c = 0; c < 3; c++) data[i+c] = Math.round(255 * mosaicClamp(tint[c] / 255));
    data[i+3] = 255;
  }
  return { width, height, channels: 4, data };
}

if (typeof module !== 'undefined') module.exports = { mosaicSources, mosaicGraph, mosaicPreview, mosaicDefaults };
