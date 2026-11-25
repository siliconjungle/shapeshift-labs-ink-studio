/* Source for the bundled materials. Every authored layer becomes a named node in an ordinary material graph. */
const input = input => ({ input });
const ref = (node, port = 'value') => ({ node, port });
const op = (op, inputs) => ({ op, inputs });
const wrap = { u: 'wrap', v: 'wrap' };
const raster = { width: input('resolution'), height: input('resolution') };
const ranges = {
  resolution: [128, 'Texture size', 48, 192, 8, 'px'],
  seed: [41, 'Seed', 0, 9999, 1],
  relief: [1.4, 'Relief depth', 0, 4, .05, 'art-px']
};

function studio() {
  const inputs = {}, controls = {}, nodes = {};
  function control(id, [value, label, min, max, step, units], group = 'Pattern') {
    inputs[id] = { type: 'number', default: value };
    controls[id] = { input: id, label, group, widget: 'slider', min, max, step,
      ...(units && { units }), order: Object.keys(controls).length };
    return input(id);
  }
  function select(id, label, value, allowed) {
    inputs[id] = { type: 'number', default: value };
    controls[id] = { input:id, label, group:'Pattern', widget:'select',
      options:allowed.map(n=>({label:String(n),value:n})), order:Object.keys(controls).length };
    return input(id);
  }
  for (const [id, spec] of Object.entries(ranges))
    control(id, spec, id === 'relief' ? 'Surface' : 'Bake');
  function add(id, type, bindings) {
    nodes[id] = op(type, bindings);
    return ref(id);
  }
  const record = (id, fields) => add(id, 'data.record', fields);
  const list = (id, parts) => {
    const values = Object.fromEntries(parts.map((part, i) => ['item' + i, part]));
    return add(id, 'data.collect', { source: record(id + 'Parts', values), keys: Object.keys(values) });
  };
  const noise = (id, family, options = {}) => add(id, 'image.noise', { family, ...raster,
    options: record(id + 'Options', { tiling: 'wrap', ...options, seed: input('seed') }) });
  const scalar = (id, a, operation, b) => add(id, 'image.channelMath', { a, b, operation, options: { precision: 'float32' } });
  const curve = (id, source, stops) => add(id, 'image.curve', { source, curve: { stops, interpolation: 'smooth' } });
  const color = (id, source, stops) => add(id, 'image.gradientMap', { source,
    ramp: { stops, interpolation: 'smooth' }, options: { precision: 'unorm8' } });
  const palette = (id, source, colors) => color(id, source, colors.map((value, i) => [i / (colors.length - 1), value]));
  const mask = (id, source, level, softness) => add(id, 'image.threshold', { source,
    options: record(id + 'Options', { level, softness }) });
  const blend = (id, background, foreground, mask = null) =>
    add(id, 'image.blend', { background, foreground, mask, mode: 'copy' });
  const warp = (id, source, map, amount, angle) => add(id, 'image.directionalWarp', { source, map,
    options: record(id + 'Options', { amount, angle, units: 'normalized', center: .5, border: 'wrap', filter: 'linear' }) });
  const tiles = (id, columns, rows, options, stamp) => add(id, 'image.tileGenerator', { ...raster, columns, rows,
    ...(stamp && { stamp }), options: record(id + 'Options', { samples: 2, seed: input('seed'), ...options }) });
  const scatter = (id, columns, rows, density, stamps, options, drivers = {}, controls = {}) =>
    add(id, 'image.tileSampler', { ...raster, columns, rows, stamps, ...drivers,
      options: record(id + 'Options', { samples: 2, seed: input('seed'), color: '#ffffff', ...options }),
      controls: record(id + 'Controls', { density, ...controls }) });
  const data = (id, source) => add(id,'image.convert',{ source,descriptor:{ intent:'data',precision:'float32' } });
  const plane = (id, source, intent) => add(id, 'image.declare', {
    source: add(id + 'Samples','image.toRaster',{source}),
    descriptor: { intent, precision:'float32', sampling:'linear', tiling:wrap }
  });
  const coverage = node => plane(node.node + 'Coverage',ref(node.node,'coverage'),'mask');
  const uniform = (id, value, intent = 'data') => add(id, 'image.uniform', { ...raster, value,
    descriptor: { intent, precision: 'float32', sampling: 'linear', tiling: wrap } });
  const metal = (source, maskStrength) => ({ metalness: curve('metalness', source, [[0, maskStrength], [1, .92]]) });
  return { inputs, controls, nodes, control, select, add, record, list, noise, scalar, curve, color, palette, mask, blend,
    warp, tiles, scatter, coverage, plane, data, uniform, metal };
}

const rect = (size, radius = 0) => ({ type: 'rectangle', size, radius });
const stroke = (points, width) => ({ type: 'stroke', points, width });
const poly = points => ({ type: 'polygon', points });
const disc = radius => ({ type: 'disc', radius });
const minus = (studio, id, map) => studio.scalar(id, studio.data(id + 'Input',map), 'multiply', -1);
const fill = (studio, id, map, weight, bed) => studio.scalar(id, studio.data(id + 'Base',bed), 'add',
  studio.scalar(id + 'Detail', studio.data(id + 'Field',map), 'multiply', weight));
const tileFace = (s, id, coverage, bevel) => {
  const height = s.add(id + 'Bevel', 'image.bevel', { source: coverage,
    options: s.record(id + 'BevelOptions', { width: bevel, height: 1, profile: 'smooth' }) });
  return s.plane(id + 'Surface',height,'data');
};
const directional = (s, name, extent, angle, wander = .22) => s.noise(name, 'directional', { extent, angle, wander });
const clothThread = (s, id, columns, rows, horizontal, thickness) => {
  const ends = horizontal ? [[.5,0],[.5,1]] : [[0,.5],[1,.5]];
  const ribbon = { type:'gradient', source:{ type:'linear',from:ends[0],to:ends[1] },
    curve:{ interpolation:'smooth',stops:[[0,0],[.14,0],[.25,.48],[.48,1],[.68,.79],[.87,0],[1,0]] } };
  const size = s.list(id + 'Width', horizontal ? [1, thickness] : [thickness, 1]);
  return s.coverage(s.tiles(id, columns, rows, { size, gutter:[0,0] }, ribbon));
};

const recipes = {
  brick: {
    label: 'Kiln Brick', category: 'Masonry', summary: 'Soot-fired brick with rounded shoulders and broad charcoal mortar.',
    build(s) {
      const courses = s.control('courses', [8, 'Courses', 4, 14, 2]);
      const joint = s.control('joint', [.13, 'Mortar width', .045, .24, .005]);
      const firing = s.control('firing', [.17, 'Kiln variation', 0, .35, .01], 'Surface');
      const bond = s.tiles('stretcherBond', 4, courses, { pattern: 'brick', rowOffset: .5,
        gutter: s.list('mortarGaps', [joint, joint]), background: '#353038',
        palette: ['#a65647','#c47753','#9c4c44','#b96949','#d38c63','#83505a'],
        jitter: s.record('kilnJitter', { color: firing }) }, rect([1,1], .11));
      const mask = s.coverage(bond), texture = s.noise('clayPores', 'fractal', { extent: [21,21], octaves: 3, gain: .7 });
      const relief = fill(s, 'firedFace', texture, .37, tileFace(s, 'brick', mask, 3));
      const tint = s.palette('soot', texture, ['#725361','#c98c69','#fff0c7']);
      const albedo = s.add('firedColor', 'image.blend', { background: bond, foreground: tint, mode: 'multiply', opacity: .55 });
      return { mask, relief, albedo, rough: [.91,.73] };
    }
  },
  tile: {
    label: 'Harbor Tile', category: 'Masonry', summary: 'Sea-green ceramic with a carved compass rose and copper slip.',
    build(s) {
      const count = s.control('count', [3, 'Tiles across', 2, 5, 1]);
      const seam = s.control('joint', [.095, 'Joint width', .035, .19, .005]);
      const ornament = s.control('ornament', [.92, 'Inlay strength', 0, 1, .02], 'Surface');
      const tiles = s.tiles('glazedSquares', count, count, { gutter: s.list('glazeGap', [seam,seam]),
        palette: ['#23575a','#326e6b','#397b73','#2c6464'], background:'#1f2931',
        jitter:{ color:.12 } }, rect([1,1], .14));
      const compass = { type:'symbol',parts:[
        { shape:{type:'star',tips:4,radius:.391,innerRadius:.114} },
        { shape:disc(.34) }, { op:'subtract',shape:disc(.316) },
        { shape:{type:'star',tips:4,radius:.306,innerRadius:.115} },
        { op:'subtract',shape:disc(.044) }
      ] };
      const inlay = s.tiles('compassRose', count,count,{ color:'#e9b079' }, compass);
      const mask = s.coverage(tiles), detail = s.coverage(inlay);
      const albedo = s.add('glazeAndSlip','image.blend',{ background:tiles,foreground:inlay,opacity:ornament,mode:'copy' });
      const engraving = s.scalar('engravingDepth',detail,'multiply',ornament);
      const relief = fill(s, 'glazeRelief', engraving, -.37, tileFace(s,'ceramic',mask,3.5));
      return { mask, relief, albedo, rough: [.79,.22] };
    }
  },
  wood: {
    label: 'Juniper Grain', category: 'Natural', summary: 'Amber growth rings bent around knots, with dark grain cuts.',
    build(s) {
      const grain = s.control('grain', [1, 'Grain frequency', .55, 2.2, .05]);
      const curl = s.control('curl', [.32, 'Knot distortion', 0, .6, .01]);
      const grainDepth = s.control('cut', [.38, 'Grain cut', .04, .9, .02], 'Surface');
      const bands = s.noise('growthBands','directional',{ extent:[6,25],angle:3,wander:.6,scale:grain });
      const swirl = s.noise('knottedWood','fractal',{ extent:[3,5],octaves:3, gain:.43 });
      const drift = s.warp('bentGrain',bands,swirl,curl,104);
      const ripples = s.curve('earlywoodLatewood', drift, [[0,.04],[.25,.21],[.43,.74],[.58,.93],[.79,.82],[1,.44]]);
      const pores = s.noise('fineFibers','anisotropic',{ extent:[52,42],angle:3,aspect:13 });
      const pattern = fill(s,'grainAndPores',pores,.26,ripples);
      return { mask: s.mask('denseRings',drift,.52,.1), relief:s.scalar('growthRelief',pattern,'multiply',grainDepth),
        albedo:s.palette('heartwood',pattern,['#45232b','#7a3e31','#ad663c','#d9995c','#f0c580']), rough:[.44,.65] };
    }
  },
  cloth: {
    label: 'Indigo Cloth', category: 'Textiles', summary: 'Folded indigo yardage with a border stripe and fine yarn.',
    build(s) {
      const folds = s.control('folds', [1, 'Fold frequency', .5, 2, .05]);
      const crease = s.control('crease', [1.15, 'Fold height', .15, 2.5, .05], 'Surface');
      const yarn = s.control('yarn', [.26, 'Yarn contrast', 0, .55, .01], 'Surface');
      const billow = s.noise('foldField','directional',{ extent:[5,4],angle:78,wander:.53,scale:folds });
      const fine = directional(s,'looseFibers',[31,32],13,.48);
      const stripe = s.coverage(s.tiles('blueAndGoldSelvage',4,1,{ size:[.34,1],gutter:[0,0] },
        { type:'symbol',parts:[{shape:rect([.44,1])},{shape:{...rect([.13,1]),center:[.16,.5]}}] }));
      const curved = s.warp('foldedStripes',stripe,billow,.095,0);
      const cloth = fill(s,'dyedFibers',fine,yarn,billow);
      const albedo = s.blend('dyedCloth',s.palette('indigo',cloth,['#181a3b','#303c75','#5671a0','#8692bd']),
        s.palette('selvageThread',cloth,['#473438','#957553','#dbb981','#ffdfa9']),curved);
      return { mask:curved, relief:fill(s,'foldAndNap',fine,.23,s.scalar('foldLift',billow,'multiply',crease)),
        albedo, rough:[.86,.9] };
    }
  },
  weave: {
    label: 'Sedge Weave', category: 'Textiles', summary: 'Alternating over-and-under reed crossings in two dyed yarns.',
    build(s) {
      const count = s.select('count','Threads across',10,[4,6,8,10,12,14,16,18]);
      const width = s.control('width', [1, 'Thread width', .55, 1, .025]);
      const fiber = s.control('fiber', [.24, 'Fibrous variation', 0, .5, .01], 'Surface');
      const vertical = clothThread(s,'warpThreads',count,count,false,width);
      const horizontal = clothThread(s,'weftThreads',count,count,true,width);
      const check = s.coverage(s.tiles('overUnderDraft',count,count,{ pattern:'checker',gutter:[0,0] },rect([1,1])));
      const v = s.scalar('warpInFront',vertical,'multiply',check);
      const reverse = s.add('oppositeCrossings','image.invert',{ source:check });
      const h = s.scalar('weftInFront',horizontal,'multiply',reverse);
      const under = s.scalar('crossingUnderside',s.scalar('intersectingThreads',vertical,'max',horizontal),'multiply',.52);
      const thread = s.scalar('overUnderThreads',s.scalar('overCrossings',v,'max',h),'max',under);
      const detail = s.noise('reedFibers','fractal',{ extent:[29,42],octaves:2 });
      const albedo = s.blend('wovenReeds',s.palette('goldWeft',fill(s,'weftFiberTone',detail,fiber,h),['#2d272c','#785640','#b27e49','#e4bb79']),
        s.palette('sageWarp',fill(s,'warpFiberTone',detail,fiber,v),['#1f2d2b','#446050','#80946d','#c8c995']), v);
      return { mask:thread, relief:fill(s,'reedRelief',detail,.13,thread), albedo, rough:[.91,.73] };
    }
  },
  fur: {
    label: 'Fox Pile', category: 'Textiles', summary: 'Tapered locks with auburn underfur and longer sunlit guard hairs.',
    build(s) {
      const density = s.control('density', [.88, 'Lock density', .24, 1, .02]);
      const lean = s.control('lean', [-19, 'Nap direction', -65, 65, 1, '°']);
      const variation = s.control('variation', [.3, 'Guard hair scale', .06, .62, .02]);
      const shapes = [
        poly([[.28,.06],[.62,.08],[.78,.24],[.71,.61],[.47,.99],[.48,.63],[.31,.45]]),
        poly([[.35,.02],[.61,.16],[.72,.42],[.57,.78],[.36,.98],[.42,.64],[.28,.38]]),
        poly([[.28,.06],[.55,.04],[.69,.27],[.64,.55],[.55,.95],[.39,.78],[.35,.47]])
      ];
      const locks = s.scatter('taperedLocks',19,17,density,shapes,{ size:[1.26,1.46], rotation:lean,
        jitter:s.record('lockJitter',{ position:[.56,.66],size:s.list('lockScaleJitter',[variation,variation]),rotation:25 }),
        gutter:[0,0] });
      const mask = s.coverage(locks), underfur = s.noise('underfur','anisotropic',{ extent:[22,34],angle:64,aspect:4.1 });
      const ridge = tileFace(s,'pile',mask,1.9);
      const hairs = s.coverage(s.scatter('guardHairs',29,23,density,[
        stroke([[.36,.05],[.52,.38],[.48,.66],[.37,.93]],.08),
        stroke([[.43,.08],[.38,.37],[.48,.7],[.61,.89]],.07)
      ],{ size:[1.15,1.2],rotation:lean,gutter:[0,0],jitter:{position:[.82,.7],size:[.5,.48],rotation:35}}));
      const nap = fill(s,'guardAndBase',underfur,.4,s.scalar('liftedTips',ridge,'multiply',.68));
      const fox = s.palette('auburnFur',nap,['#351c27','#773a2d','#b35b34','#d68a4d','#ffc782']);
      const tips = s.palette('sunlitGuardHairs',underfur,['#7e4835','#b7794c','#dba26d','#ffe1a0']);
      const albedo = s.add('foxCoat','image.blend',{ background:fox,foreground:tips,mask:hairs,opacity:.48 });
      return { mask, relief:fill(s,'pileHeight',underfur,.24,ridge), albedo, rough:[.94,.72] };
    }
  },
  cracks: {
    label: 'Lime Cracks', category: 'Weathering', summary: 'A branched crack network across mottled, chalky lime plaster.',
    build(s) {
      const network = s.control('cells', [1, 'Crack frequency', .55, 1.9, .05]);
      const width = s.control('width', [.13, 'Fissure width', .035, .29, .005]);
      const fracture = s.control('wander', [.29, 'Wandering edges', 0, .59, .01]);
      const cells = s.noise('fractureNetwork','cellular',{ extent:[8,7],scale:network,jitter:.89 });
      const warp = s.noise('fractureWander','fractal',{ extent:[5,5],octaves:3 });
      const joints = s.warp('brokenEdges',cells,warp,fracture,38);
      const shell = s.mask('plasterCells',joints,width,.06);
      const mask = s.add('fissures','image.invert',{ source:shell });
      const grain = s.noise('limeGrain','fractal',{ extent:[14,14],octaves:4 });
      const albedo = s.blend('splitPlaster',s.palette('lime',grain,['#978675','#c7b695','#eee1bf','#fff1d7']),
        s.palette('fissurePigment',grain,['#362a30','#482f33','#75584a']),mask);
      return { mask, relief:fill(s,'plasterRelief',grain,.36,minus(s,'cutFissures',mask)), albedo, rough:[.78,.98] };
    }
  },
  chips: {
    label: 'Chipped Enamel', category: 'Weathering', summary: 'Irregular paint losses with a pale edge and rusted iron beneath.',
    build(s) {
      const density = s.control('density', [.72, 'Chip density', .12, 1, .02]);
      const scale = s.control('scale', [.79, 'Chip scale', .43, 1.47, .02]);
      const lip = s.control('lip', [2.4, 'Exposed rim width', .65, 4.5, .05, 'px']);
      const chips = s.scatter('flakeShapes',7,7,density,[
        poly([[.06,.38],[.31,.30],[.27,.13],[.49,.10],[.55,.21],[.79,.17],[.93,.49],[.7,.55],[.57,.83],[.36,.72],[.25,.88]]),
        poly([[.13,.49],[.39,.17],[.56,.2],[.84,.34],[.66,.53],[.78,.76],[.36,.83],[.3,.67]]),
        poly([[.09,.51],[.33,.46],[.28,.27],[.53,.36],[.74,.15],[.83,.38],[.8,.63],[.52,.91],[.42,.73]])
      ],{ size:s.list('chipScale',[scale,scale]), gutter:[0,0],jitter:{position:[.62,.62], size:[.55,.55],rotation:175} });
      const mask = s.coverage(chips), grain = s.noise('oxidizedIron','fractal',{extent:[19,19],octaves:4});
      const basin = tileFace(s,'exposedIron',mask,lip);
      const paint = s.palette('oldEnamel',grain,['#17343a','#23585c','#328081','#659b89']);
      const rust = s.palette('rustLayers',grain,['#281e29','#65332d','#a55a3e','#da9358']);
      const primer = s.palette('brokenPrimer',grain,['#6e5148','#b89170','#e2be90','#ffe0a9']);
      const exposed = s.blend('exposedSubstrate',primer,rust,s.plane('ironBasinMask',basin,'mask'));
      return { mask, relief:fill(s,'underpaint',grain,.24,minus(s,'chipDepth',basin)),
        albedo:s.blend('flakedCoating',paint,exposed,mask), rough:[.36,.86] };
    }
  },
  scratches: {
    label: 'Scored Steel', category: 'Weathering', summary: 'Fine brushed marks interrupted by longer, brighter gouges.',
    build(s) {
      const density = s.control('density', [.64, 'Scratch density', .12, 1, .02]);
      const angle = s.control('angle', [-24, 'Brush direction', -90, 90, 1, '°']);
      const length = s.control('length', [1.06, 'Scratch length', .58, 1.8, .02]);
      const strokes = [
        stroke([[.04,.47],[.43,.59],[.95,.52]],.036),
        stroke([[.07,.55],[.28,.48],[.91,.41]],.024),
        poly([[.028,.42],[.42,.37],[.82,.46],[.99,.47],[.81,.52],[.45,.43]])
      ];
      const scratches = s.scatter('scoreMarks',5,20,density,strokes,{
        size:s.list('scratchStretch',[length,1]), gutter:[0,0],rotation:angle,
        jitter:{position:[.59,.76],size:[.38,.38],rotation:12} });
      const mask = s.coverage(scratches), brushing = directional(s,'brushLines',[31,48],angle,.18);
      const albedo = s.blend('scoredMetal',s.palette('coldSteel',brushing,['#2a3546','#56677c','#838f9e','#b1b6bf']),
        s.palette('exposedEdges',brushing,['#526070','#9eb3c1','#d0dfde','#f7e6ce']),mask);
      return { mask, relief:fill(s,'scoredRelief',brushing,.19,minus(s,'scoredGrooves',mask)),
        albedo, rough:[.34,.64], ...s.metal(brushing,.82) };
    }
  },
  'rain-streaks': {
    label: 'Rain Streaks', category: 'Weathering', summary: 'Long mineral trails and shorter runs on smoky slate.',
    build(s) {
      const density = s.control('density', [.8, 'Trail density', .2, 1, .02]);
      const lean = s.control('lean', [0, 'Runoff angle', -32, 32, 1, '°']);
      const strength = s.control('strength', [.86, 'Deposit strength', .1, 1, .02], 'Surface');
      const taper = (points, end) => ({ type:'linear',from:[.5,end],to:[.5,.02],clip:poly(points) });
      const runs = s.scatter('taperedTrails',19,5,density,[
        taper([[.2,.03],[.8,.03],[.59,.49],[.52,.95],[.42,.66],[.39,.31]],.94),
        taper([[.3,.03],[.7,.05],[.68,.43],[.53,.83],[.48,.82],[.43,.41]],.84),
        taper([[.14,.04],[.89,.09],[.71,.38],[.61,.41],[.50,.7],[.34,.42]],.7)
      ],{ size:[.57,1.92],gutter:[0,0],rotation:lean,jitter:{position:[.77,.69],size:[.48,.48],rotation:4} });
      const mask = s.scalar('depositedMinerals',s.coverage(runs),'multiply',strength);
      const slate = s.noise('cloudySlate','fractal',{ extent:[6,9],octaves:3 });
      return { mask, relief:fill(s,'depositRelief',mask,.3,s.scalar('slatePores',slate,'multiply',.31)),
        albedo:s.blend('weatheredSlate',s.palette('slate',slate,['#252832','#424851','#6e7478']),
          s.palette('salt',slate,['#7a7e72','#b6b9a1','#e1e5c6']),mask), rough:[.53,.88] };
    }
  },
  patina: {
    label: 'Copper Patina', category: 'Weathering', summary: 'Verdigris blooms around small pits, revealing flashes of copper.',
    build(s) {
      const age = s.control('age', [.57, 'Oxidation threshold', .38, .73, .01]);
      const bloom = s.control('scale', [1, 'Bloom frequency', .55, 2.2, .05]);
      const pit = s.control('pit', [.6, 'Pitting depth', 0, 1.35, .05], 'Surface');
      const weather = s.noise('oxidationBands','fractal',{ extent:[6,8],octaves:5,scale:bloom,gain:.67 });
      const cell = s.noise('oxideIslands','worley',{ extent:[16,14],jitter:.92 });
      const mixed = fill(s,'oxidationFront',cell,.19,weather);
      const mask = s.mask('verdigrisCoverage',mixed,age,.085);
      const copper = s.palette('burnishedCopper',weather,['#572b30','#a45138','#d0814e','#efb179']);
      const oxide = s.palette('malachite',mixed,['#173b42','#25656a','#499281','#84b199','#b7ccb0']);
      const relief = fill(s,'pittedRelief',s.scalar('oxidePits',mask,'multiply',cell),s.scalar('pitDepth',s.uniform('pitStrength',pit),'multiply',-1),weather);
      return { mask, relief, albedo:s.blend('oxidizedCopper',copper,oxide,mask), rough:[.28,.79],
        metalness:s.curve('metalness',mask,[[0,.94],[1,.13]]) };
    }
  },
  'organic-scatter': {
    label: 'Forest Floor', category: 'Natural', summary: 'Raised leaves, seed shells, pebbles, and moss on a dark bed.',
    build(s) {
      const density = s.control('density', [.75, 'Litter density', .15, 1, .02]);
      const size = s.control('scale', [.145, 'Stamp scale', .075, .24, .005]);
      const leaves = [
        poly([[.05,.68],[.19,.45],[.36,.32],[.66,.33],[.94,.16],[.78,.49],[.69,.6],[.56,.71],[.3,.8]]),
        { type:'symbol',parts:[{shape:disc(.44)},{op:'subtract',shape:{ type:'disc',center:[.56,.45],radius:.21 }}] },
        poly([[.15,.54],[.24,.28],[.51,.12],[.81,.27],[.9,.58],[.68,.82],[.39,.91]])
      ];
      const ground = s.noise('mossPatches','fractal',{ extent:[7,7],octaves:4 });
      const elevation = s.add('softEarth','image.toHeight',{source:ground,scale:.072,units:'shape-units'});
      const sparse = s.curve('patchyGrowth',ground,[[0,.49],[.42,.72],[.65,.99],[1,1]]);
      const field = (id,kind,options)=>s.add(id,'sdf.shape',{kind,options});
      const volumes = s.list('roundedLitter',[field('riverPebble','sphere',{radius:.47}),
        field('angularBark','box',{half:[.42,.19,.32],round:.09})]);
      const scatter = s.add('signedLeafLitter','image.shapeSplatter',{ ...raster,columns:11,rows:11,shapes:leaves,volumes,
        background:elevation,density:sparse, options:s.record('litterPlacement',{ seed:input('seed'), density, scale:size,
          scaleJitter:[.35,.4,.31],jitter:.92,rotationJitter:[20,179,23],heightJitter:.023,
          rounding:.063,extrusion:.23,samples:2,steps:38 })
      });
      const local = (id,source)=>s.add(id,'image.shape',{width:56,height:56,source,options:{samples:2}});
      const veins = { type:'symbol',parts:[
        {shape:stroke([[.08,.68],[.37,.57],[.66,.43],[.91,.18]],.025)},
        ...[[[.27,.63],[.22,.43]],[[.43,.54],[.33,.32]],[[.57,.48],[.46,.31]],
          [[.31,.59],[.39,.78]],[[.50,.51],[.56,.69]],[[.68,.42],[.70,.58]]]
          .map(points=>({shape:stroke(points,.018)}))
      ] };
      const shell = {type:'gradient',source:{type:'radial',radius:.69,clip:rect([1,1])},
        curve:{interpolation:'smooth',stops:[[0,.08],[.26,.26],[.36,.66],[.48,.29],[.58,.91],[.68,.31],[.81,.74],[1,.38]]}};
      const leaf = s.palette('localLeafOil',local('leafVeins',veins),['#7c8a47','#c0bf66','#e1ce8e']);
      const pod = s.palette('localSeedBands',local('shellGrowthRings',shell),['#683d35','#aa6a45','#d29a57','#edba79']);
      const grainTexture = (id,extent,colors)=>{
        const field = s.add(id+'Pores','image.noise',{family:'fractal',width:48,height:48,
          options:s.record(id+'GrainSettings',{extent,octaves:3,tiling:'wrap',seed:input('seed')})});
        return s.palette(id+'Pigment',field,colors);
      };
      const swatches = [leaf,pod,grainTexture('lichen',[4,4],['#4b5e45','#83966e','#aeb893']),
        grainTexture('stone',[10,12],['#415552','#68786b','#acac94']),
        grainTexture('bark',[5,14],['#423138','#6d503e','#9a704e'])];
      const mask = s.coverage(scatter);
      const albedo = s.add('paintedLitter','image.scatterColor',{ source:ref(scatter.node,'surface'),
        base:s.palette('forestBed',ground,['#1c2527','#333930','#4d5940','#6e7b50']), textures:s.list('litterColors',swatches) });
      const relief = s.scalar('litterRelief',scatter,'multiply',15.4);
      return { mask, relief, albedo, rough:[.91,.68], contactShadow:true };
    }
  }
};

const labels = { baseColor:'Base color',height:'Height',normal:'Normal',roughness:'Roughness',mask:'Feature mask',metalness:'Metalness' };

function graph(id) {
  if (!Object.hasOwn(recipes,id)) throw new RangeError('Unknown material recipe ' + id);
  const { label, category, summary, build } = recipes[id], s = studio();
  const { albedo, relief, mask, rough, metalness, contactShadow } = build(s);
  const height = s.add('materialHeight','image.toHeight',{ source:relief,scale:input('relief'),units:'art-px' });
  const normal = s.add('tangentNormal','image.heightToNormal',{source:height,options:{method:'central',border:'wrap'}});
  const roughness = s.curve('roughnessResponse',mask,[[0,rough[0]],[1,rough[1]]]);
  const light = s.add('previewLight','image.emboss',{ source:height,
    options:{azimuth:-135,elevation:37,strength:.86,bias:.68,border:'wrap'} });
  const shade = s.color('previewLightRamp',light,[[0,'#382947'],[.29,'#776477'],[.68,'#e8e2db'],[1,'#fff8e6']]);
  const lit = s.add('preview','image.blend',{ background:albedo,foreground:shade,mode:'multiply',opacity:.89 });
  let preview = lit;
  if (contactShadow) {
    const shadow = s.add('contactShadows','image.heightShadow',{source:height,
      options:{azimuth:-135,elevation:23,reach:9,step:1,softness:21,bias:.035,border:'wrap'}});
    const tint = s.color('contactShade',shadow,[[0,'#ffffff'],[1,'#594d65']]);
    preview = s.add('shadowedPreview','image.blend',{background:lit,foreground:tint,mode:'multiply',opacity:.63});
  }
  const previewDisplay = s.add('displayPreview','image.toDisplay',{source:preview});
  const outputs = { baseColor:albedo,height,normal,roughness,mask,...(metalness && { metalness }),preview,previewDisplay };
  const outputUsages = Object.fromEntries(Object.keys(outputs).filter(name=>Object.hasOwn(labels,name)).map((name,order)=>
    [name,{ usage:name==='mask'?'mask.feature':name,label:labels[name],order,source:{output:name},
      format:name==='height'?{format:'json'}:{format:'png',bitDepth:['baseColor','normal'].includes(name)?8:16} }]));
  return { label, category, summary, controls:s.controls,
    project:{ format:'ink-studio/graph-project',version:1,inputs:s.inputs,nodes:s.nodes,outputs,outputUsages,
      exports:{ preview:{ output:'previewDisplay',format:'png' } } } };
}

module.exports = { ids:Object.keys(recipes), graph, labels };
