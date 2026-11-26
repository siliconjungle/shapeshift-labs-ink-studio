const { width, height, art } = require('./art.cjs');
const ref = (node, port = 'value') => ({ node, port }), op = (op, inputs) => ({ op, inputs });
const from = input => ({ input });
const channel = (source, name) => op('material.image', { source: ref(source), name });
const uv = points => points.map(([x, y]) => [x / 256, y / 160]);
const xy = points => points.map(([x, y]) => [x * 4, y * 4]);
const uniform = (value, descriptor) => op('image.uniform', { width, height, value, descriptor });
const paintDoc = layers => ({ format: 'ink-studio/material-paint', version: 1, layers,
  charts: {
    'world-panel': { space: 'world', projection: { origin: [6, 0, -2] }, extent: [3.2, 2] },
    'rest-panel': { space: 'rest', projection: { origin: [0, 0, 0] }, extent: [3.2, 2] }
  }
});

function fixture({ KIT }) {
  const tilt = KIT.flowMap.create({ width: 20, height: 14, bounds: [0, 0, 1, 1] });
  tilt.stroke({ points: [[.12, .34], [.4, .43], [.65, .38], [.88, .27]], radius: .7, direction: 'stroke', speed: 1 });
  const flows = { current: tilt.asset() };
  const lens = { type: 'rectangle', rect: [208, 180, 606, 300] };
  const brush = { radius: 10, aspect: .58, hardness: .47 };
  const green = [.085, 1.6, 1.08];
  const waveOne = [[42,111],[54,105],[69,105],[83,115],[100,124],[122,130],[146,124],[163,118],[177,115],[196,119],[212,115]];
  const waveTwo = [[39,119],[62,114],[81,124],[100,134],[121,139],[143,135],[169,124],[185,126],[204,130],[215,125]];
  const plan = paintDoc([
    { id: 'glaze', label: 'Turquoise glaze', channel: 'baseColor', mask: 'mask.inlay', opacity: .57, strokes: [{
      space: 'uv', samples: uv([[60,84],[83,77],[114,78],[137,83],[159,78]]),
      value: [.025,.327,.334], opacity: .85, brush: { radius: 51, aspect: .73, hardness: .38 }, flow: 'current', selection: lens
    }] },
    { id: 'ridges', label: 'Raised enamel', channel: 'height', mask: 'mask.inlay', opacity: .7, strokes: [{
      space:'rest', chart:'rest-panel', samples: uv(waveOne).map(([u,v])=>[u*3.2,0,v*2]),
      value:.57, brush: { radius: 12, hardness: .48 }
    }] },
    { id: 'lit', label: 'Phosphor', channel: 'emission', mask: 'mask.inlay', strokes: [
      { space: 'uv', samples: uv(waveOne), value: green, brush },
      { space: 'uv', samples: uv(waveTwo), value: [.028,.67,.62], opacity: .74, brush: { ...brush, radius: 6 } },
      { space: 'texel', samples: xy([[80.5,73]]), value: [2.1,.92,.21], brush: { radius: 15, hardness: .76 } },
      { space: 'texel', samples: xy([[120,59],[138,63],[155,73],[172,78],[183,72]]), value: [.038,.55,.41],
        brush: { radius: 7, aspect: 1, hardness: .5 }, opacity: .85 }
    ] },
    { id: 'polish', label: 'Satin polish', channel: 'roughness', mask: 'mask.inlay', opacity: .8, strokes: [{
      space:'world', chart:'world-panel', samples: uv([[80,92],[111,83],[156,84]]).map(([u,v])=>[6+u*3.2,0,-2+v*2]),
      value:.15, brush: { radius: 40, aspect: .6, hardness: .35 }, flow: 'current'
    }] },
    { id: 'currents', label: 'Flow vectors', channel: 'flow', mask: 'mask.inlay', strokes: [{
      space: 'uv', samples: uv(waveOne), velocity: 'stroke', speed: .67, brush: { radius: 22, hardness: .4 }
    }] }
  ]);
  const { plate, height: relief, inlay } = art(), source = (encoding, bytes) => ({encoding,base64:bytes.toString('base64')});
  const assets = {
    plate: { format:'bitmap', source: source('png',plate) },
    relief: { format:'bitmap', source: { ...source('pfm',relief), rowOrder:'top-down' },
      interpretation:{intent:'height',units:'mm'} },
    inlay: { format:'bitmap', source: source('png',inlay), interpretation:{intent:'mask'} }
  };
  const inputs = {
    session: { type:'record',default:plan }
  };
  const nodes = {
    stock: op('bitmapAsset',{name:'plate'}), relief:op('bitmapAsset',{name:'relief'}), inlay:op('bitmapAsset',{name:'inlay'}),
    linear:op('image.convert',{source:ref('stock'),descriptor:{precision:'float32',colorSpace:'srgb-linear', intent:'color', layout:'rgba'}}),
    emission:uniform([0,0,0],{intent:'color',layout:'rgb',colorSpace:'srgb-linear',precision:'float32'}),
    rough:uniform(.57,{intent:'data',layout:'r',precision:'float32'}),
    flow:uniform([0,0],{intent:'data',layout:'rg',precision:'float32',units:'uv/s'}),
    maps:op('data.record',{baseColor:ref('linear'),height:ref('relief'),emission:ref('emission'),roughness:ref('rough'),
      'mask.inlay':ref('inlay'),flow:ref('flow')}),
    source:op('material.pack',{maps:ref('maps'),metadata:{height:{texCoord:0},flow:{texCoord:0}}}),
    paint:op('material.paint',{source:ref('source'),session:from('session'),flows}),
    color:channel('paint','baseColor'), emissive:channel('paint','emission'), height:channel('paint','height'),
    roughness:channel('paint','roughness'), velocity:channel('paint','flow'),
    normal:op('image.heightToNormal',{source:ref('height'),options:{spacing:[.063,.063],strength:1.2}})
  };
  const outputs = { source:ref('source'), material:ref('paint'), report:ref('paint','report'),
    color:ref('color'), emission:ref('emissive'), height:ref('height'), roughness:ref('roughness'), velocity:ref('velocity'), normal:ref('normal') };
  return { flows, graph:{format:'ink-studio/graph-project',version:1,assets,inputs,nodes,outputs} };
}
module.exports = { width,height,paintDoc,fixture };
