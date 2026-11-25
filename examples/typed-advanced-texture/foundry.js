/* A cast enamel lighthouse plaque with simulated scan lighting and dust. */
const foundryWidth = 144, foundryHeight = 100;
const foundryViews = {
  finish: ['Finished enamel', 'Light azimuth', -180,180,1,-127],
  scan: ['Scan cleanup', 'Cleanup strength', 0,1,.01,1],
  seam: ['Seam repair', 'Edge band width', 1,22,1,9],
  slope: ['Slope blur', 'Trail travel', -20,20,.5,9],
  bevel: ['Bevel relief', 'Bevel width', .5,9,.1,3],
  emboss: ['Emboss', 'Light azimuth', -180,180,1,-127],
  shadow: ['Cast shadows', 'Light elevation', 5,65,1,22],
  frequency: ['Height frequency', 'Fine gain', 0,3,.05,.75],
  wear: ['Edge wear', 'Cut depth', 0,2,.05,.58]
};
const foundryDefaults = {
  clean:{ threshold:.24, support:.86, amount:1 },
  seam:{ width:9 },
  slope:{ distance:9, samples:13, mode:'max', slopeGain:3 },
  bevel:{ width:3, height:4.2, profile:'round' },
  emboss:{ azimuth:-127, elevation:32, strength:1.1 },
  shadow:{ azimuth:-127, elevation:22, reach:24, step:.8, softness:6 },
  frequency:{ fineRadius:1, coarseRadius:6, fineGain:.75, midGain:1.1 },
  wear:{ threshold:.10, softness:.30, radius:2, depth:.58 }
};
const foundryClamp = n => Math.max(0,Math.min(1,n));
function foundryColorSpace() {
  return typeof ColorSpace === 'undefined' ? require('../..').load().ColorSpace : ColorSpace;
}

function foundrySources() {
  const width = foundryWidth, height = foundryHeight, count = width * height, tau = Math.PI * 2;
  const scan = new Uint8Array(count * 3), cast = new Uint8Array(count), stains = new Float64Array(count);
  const bed = new Float64Array(count), guide = new Float64Array(count), illumination = new Float64Array(count);
  const protection = new Uint8Array(count).fill(255);
  const palette = {
    night:[37,48,68], air:[57,76,89], cloud:[78,105,110], moon:[225,156,102], moonEdge:[182,109,82],
    lapis:[47,86,91], surf:[89,141,130], teal:[61,115,111], foam:[140,168,139],
    rock:[78,81,80], shade:[64,64,77], clay:[143,76,70], bronze:[183,113,74], gold:[224,151,88],
    window:[251,200,119], ivory:[238,211,150], frame:[116,103,91], distant:[100,135,132]
  };
  const sparkles = [[15,17],[126,27],[50,8],[107,10],[121,45],[32,48]];
  const dust = new Set([[9,43],[112,52],[54,61],[28,73],[128,89],[65,11],[7,90],[110,15],[132,61],[45,92]]
    .map(([x,y])=>y*width+x));
  const { prepare } = foundryColorSpace(), decode = prepare('srgb','srgb-linear'), encode = prepare('srgb-linear','srgb');
  const raw = [0,0,0], pixel = [0,0,0];
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++,p++) {
    const u = (x+.5)/width, v = (y+.5)/height, dx = x + .5 - 88;
    const noise = ((Math.imul(x+33,839) ^ Math.imul(y+33,8191)) >>> 0) % 113 / 113;
    const gust = Math.sin(tau * u) * 2.1 + .55 * Math.sin(tau * 3 * u);
    const coast = 69 + gust;
    const cloud = (y - 12 + 1.5*Math.sin(tau*u+.6)) % 15;
    const wave = y - coast + 1.2*Math.sin(tau*(u*2 + v*2));
    const sun = Math.hypot(x+.5-43,y+.5-32);
    let ink = y < coast ? (y < 21 ? 'night' : 'air') : wave % 6 < 1.05 ? 'surf' : wave % 6 < 3.2 ? 'teal' : 'lapis';
    if (y < coast - 10 && cloud >= 0 && cloud < 1.15 && (u + .1*y)% .41 < .31) ink = 'cloud';
    if (sun < 15 && y < coast) ink = sun > 13.7 || y > 40 ? 'moonEdge' : 'moon';
    if (sun < 15 && y >= 34 && y <= 39 && y % 3 === 0) ink = 'moonEdge';
    const stars = sparkles.some(([sx,sy])=>Math.abs(x-sx)+Math.abs(y-sy) <= 1);
    if (stars) { ink = 'ivory'; protection[p] = 0; }
    const boulder = (dx / 23) ** 2 + ((y - 77 + .08*dx) / 10) ** 2 < 1 ||
      ((dx + 20)/11) ** 2 + ((y - 81)/6) ** 2 < 1 || ((dx - 18)/12) ** 2 + ((y - 81)/6) ** 2 < 1;
    if (boulder) ink = Math.floor((y + .14 * dx + noise*.6) / 4) % 3 ? 'rock' : 'shade';
    const tower = y >= 39 && y < 76 && Math.abs(dx) < 6.5 + (y-39)*.14;
    const plinth = y >= 74 && y < 79 && Math.abs(dx) < 14.5;
    const balcony = y >= 33 && y < 39 && Math.abs(dx) < (y>=36?12.3:13.7);
    const lamp = y >= 24 && y < 33 && Math.abs(dx) < 6.5;
    const roof = y >= 16 && y < 24 && Math.abs(dx) < 1 + (y-16)*1.36;
    const antenna = y >= 12 && y < 17 && Math.abs(dx) < 1.1;
    if (tower || plinth) {
      const ring = (y + 2*Math.max(0,Math.abs(dx)-3)*.12) % 15;
      ink = plinth || Math.abs(dx)>8.8 ? 'clay' : ring < 4 ? 'clay' : dx < -2.4 ? 'gold' : 'bronze';
      if (y > 62 && y < 71 && Math.abs(dx - 1.4) < 1.3) ink = 'night';
    }
    if (balcony) ink = y === 35 && Math.round(dx)%4!==0 ? 'night' : dx < -2 ? 'gold' : 'frame';
    if (lamp) ink = Math.abs(dx - 1.5) < .75 || Math.abs(dx) > 5.8 ? 'bronze' : y < 28 ? 'window' : 'ivory';
    if (roof || antenna) ink = dx < 0 && !antenna ? 'gold' : 'clay';
    const stream = y > 29 + .09*(x-94) && y < 30.6 + .09*(x-94) && x > 95 && x < 132;
    if (stream) ink = x < 108 ? 'ivory' : 'distant';
    const waves = y > coast+2 && wave % 6 < 1.05;
    cast[p] = tower || lamp || roof || antenna || plinth || balcony || boulder || waves ? 255 : 0;
    bed[p] = (noise-.5)*.38 + .20*Math.cos(tau*(2*u+2*v)) + (boulder ? .59 : sun<14 ? .16 : 0);
    guide[p] = 3*Math.sin(tau*(u*2+v*1.4)) + 2.1*Math.cos(tau*(v*3-u)) + (noise-.5)*.5;
    stains[p] = (tower && y>51 && y<54 && dx>1 && dx<5) ||
      (boulder && y>76 && Math.abs(dx-7)<5) || (balcony && dx>2 && dx<7) ? 1 : 0;
    const capture = .69+.33*v+.14*Math.sin(tau*(u*.5+v*.13));
    illumination[p] = capture;
    for (let c = 0; c < 3; c++) raw[c] = palette[ink][c]/255;
    decode(raw,pixel);
    for (let c = 0; c < 3; c++) pixel[c] *= capture*(.82+.25*u)*(noise>.94 ? .83 : 1);
    encode(pixel,raw);
    for (let c = 0; c < 3; c++) scan[p*3+c] = dust.has(p) ? [251,235,203][c] : Math.round(255*foundryClamp(raw[c]));
  }
  const grid = (data, channels=1) => ({ width,height,channels,data });
  return { scan:grid(scan,3), cast:grid(cast), stains:grid(stains), bed:grid(bed), driver:grid(guide),
    illumination:grid(illumination), protection:grid(protection) };
}

function foundryGraph(artifacts = false) {
  const link = (node,port='value') => ({node,port}), input = input => ({input}), op = (op,inputs) => ({op,inputs});
  const tiling={u:'wrap',v:'wrap'}, height={intent:'height',units:'art-px',tiling};
  const graph={format:'ink-studio/graph-project',version:1,inputs:{},nodes:{},outputs:{},exports:{}};
  const maps={ scan:{intent:'color',precision:'unorm8',tiling}, cast:{intent:'mask',precision:'unorm8',tiling},
    stains:{intent:'mask',tiling}, bed:height, driver:height, illumination:{intent:'data',tiling},
    protection:{intent:'mask',precision:'unorm8',tiling} };
  for(const [id,descriptor] of Object.entries(maps)){
    graph.inputs[id]='raster';
    graph.nodes[id]=op('image.declare',{source:input(id),descriptor});
  }
  for(const [id,value] of Object.entries(foundryDefaults)) graph.inputs[id+'Options']={type:'record',default:value};
  const opts = id => input(id+'Options');
  Object.assign(graph.nodes,{
    clean:op('image.scanCleanup',{source:link('scan'),mask:link('protection'),illumination:link('illumination'),options:opts('clean')}),
    seam:op('image.seamRepair',{source:link('clean'),options:opts('seam')}),
    slope:op('image.slopeBlur',{source:link('stains'),slope:link('driver'),options:opts('slope')}),
    bevel:op('image.bevel',{source:link('cast'),options:opts('bevel')}),
    relief:op('image.channelMath',{a:link('bed'),b:link('bevel'),operation:'add'}),
    tileHeight:op('image.seamRepair',{source:link('relief'),options:opts('seam')}),
    frequency:op('image.heightFrequency',{source:link('tileHeight'),options:opts('frequency')}),
    wear:op('image.edgeWear',{source:link('frequency'),options:opts('wear')}),
    emboss:op('image.emboss',{source:link('wear','height'),options:opts('emboss')}),
    shadow:op('image.heightShadow',{source:link('wear','height'),options:opts('shadow')}),
    scanDisplay:op('image.toDisplay',{source:link('scan')}),
    cleanDisplay:op('image.toDisplay',{source:link('clean')}),
    seamDisplay:op('image.toDisplay',{source:link('seam')})
  });
  graph.outputs={ source:link('scanDisplay'), scan:link('cleanDisplay'), seam:link('seamDisplay'),
    repaired:link('clean','repaired'), slope:link('slope'), bevel:link('bevel'), frequency:link('frequency'),
    height:link('wear','height'), wear:link('wear'), emboss:link('emboss'), shadow:link('shadow'),
    cast:link('cast'), stainSource:link('stains'), rawHeight:link('tileHeight') };
  if(artifacts) graph.exports={ pigment:{output:'seam',format:'png'}, relief:{output:'height',format:'json'},
    wear:{output:'wear',format:'json'}, shadows:{output:'shadow',format:'json'}, stains:{output:'slope',format:'json'} };
  return graph;
}

function foundryPreview(outputs, view, before=false) {
  const {width,height}=outputs.source, out=new Uint8Array(width*height*4);
  const data=(name)=>outputs[name].raster?.data??outputs[name].data;
  const scan=data('source'), clean=data('scan'), pigment=data('seam'), slope=data('slope');
  const raised=data('bevel'), emboss=data('emboss'), shadow=data('shadow'), worn=data('wear'), frequency=data('frequency');
  const { prepare }=foundryColorSpace(), decode=prepare('srgb','srgb-linear'), encode=prepare('srgb-linear','srgb');
  const rgb=[0,0,0], linear=[0,0,0], inlay=[.38,.23,.11], rust=[.035,.22,.18];
  const a=[29,43,61], b=[235,192,133], heights=data('height'), inputHeight=data('rawHeight');
  const relief = n => foundryClamp(.12 + n*.18);
  const scalar = {
    slope: before ? p => data('stainSource')[p] : p => slope[p],
    bevel: before ? p => data('cast')[p]/255 : p => foundryClamp(raised[p]/4.2),
    emboss: before ? p => relief(heights[p]) : p => emboss[p],
    shadow: before ? p => relief(heights[p]) : p => 1-shadow[p],
    frequency: before ? p => relief(inputHeight[p]) : p => relief(frequency[p]),
    wear: before ? p => relief(frequency[p]) : p => foundryClamp((frequency[p]-heights[p])*1.3)
  }[view];
  const pixels = view === 'seam' ? before ? clean : pigment : view === 'scan' && !before ? clean : scan;
  for(let p=0;p<width*height;p++){
    if(view==='finish'&&!before){
      for(let c=0;c<3;c++) rgb[c]=pigment[p*3+c]/255;
      decode(rgb,linear);
      const band=Math.round(emboss[p]*11)/11;
      const light=(.47+band*1.15)*(1-.62*shadow[p]);
      const patina=.35*Math.round(slope[p]*4)/4, abrasion=.38*Math.round(worn[p]*5)/5;
      for(let c=0;c<3;c++){
        let value=linear[c]*light;
        value=value*(1-patina)+rust[c]*patina;
        linear[c]=foundryClamp(value*(1-abrasion)+inlay[c]*abrasion*(.4+band));
      }
      encode(linear,rgb);
      rgb.forEach((n,c)=>out[p*4+c]=Math.round(255*foundryClamp(n)));
    }else if(scalar){
      const n=scalar(p);
      for(let c=0;c<3;c++) out[p*4+c]=Math.round(a[c]+(b[c]-a[c])*n);
    }else for(let c=0;c<3;c++) out[p*4+c]=pixels[p*3+c];
    out[p*4+3]=255;
  }
  return {width,height,data:out};
}
if(typeof module!=='undefined') module.exports={foundrySources,foundryGraph,foundryPreview,foundryDefaults,foundryViews};
