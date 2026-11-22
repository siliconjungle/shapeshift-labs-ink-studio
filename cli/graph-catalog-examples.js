const path = require('node:path');

const rgba = { width: 4, height: 4, channels: 4, data: Array.from({ length: 16 }, (_, i) =>
  i === 5 || i === 6 || i === 9 || i === 10 ? [60, 135, 190, 255] : [0, 0, 0, 0]).flat() };
const mask = { width: 4, height: 4, channels: 1, data: [0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0] };
const palette = ['#102032', '#3c87be', '#f2be6e'];
const slots = { ...mask, data: mask.data.map(value => value ? 1 : 0) };
const motion = { width: 4, height: 4, channels: 2, data: Array.from({ length: 16 }, () => [.5, 0]).flat() };
const bone = { id: 'root', pivot: [0, 0], tip: [3, 3] };
const motionControl = { from: [[0, 0], [3, 2]], to: [[0, 0], [3, 3]] };
const triangle = [[0, 0], [1, 0], [0, 1]], quad = [[0, 0], [1, 0], [0, 1], [1, 1]];
const mesh = { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], faces: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] };
const clip = { width: 4, height: 4, fps: 8, layers: { ink: { frames: [rgba.data, rgba.data] } } };
const audio = { sampleRate: 8000, channels: 1, samples: Array.from({ length: 128 }, (_, i) => i % 4 === 1 ? .5 : i % 4 === 3 ? -.5 : 0) };
const fitTone={sampleRate:8000,channels:1,samples:Array.from({length:1600},(_,i)=>
  .5*Math.sin(2*Math.PI*280*i/8000)*Math.min(1,i/40)*Math.exp(-i/1200))};
const fittedTone={op:'audio.fitInstrument',inputs:{source:fitTone}};
const playableSound={op:'music.buildPlayableSound',inputs:{source:fitTone,options:{
  variants:[{id:'body',family:'contour'},{id:'air',family:'handoff'}]}}};
const soundDiscovery={op:'music.auditionSoundSources',inputs:{assets:{tone:fitTone},spec:{
  candidates:[{id:'ring',family:'sampled',source:{asset:'tone'},root:'C4'},
    {id:'reed',family:'synth',patch:{type:'fm',index:.25}}],
  settings:{sampleRate:8000,keys:[60],velocities:[.8]}
}}};
const event = { time: 0, channel: 'held', value: true };
const sampleCapture = {op:'audio.captureSample',inputs:{source:audio,settings:{
  sample:{id:'tone',label:'Bench tone',material:'synth',pitch:'A4',license:{id:'CC0-1.0'}},
  source:{kind:'graph',name:'oscillator'},firstSample:16,endSample:48
}}};
const sampleMotifPlan={op:'music.planSampleMotif',inputs:{source:audio,score:audio}};
const timbreGesture={op:'music.extractTimbreGesture',inputs:{source:audio,options:{id:'tone'}}};
const timbreComparison={format:'ink-studio/timbre-gesture',version:1,id:'second',
  source:{sampleRate:8000,channels:1,frames:128},active:{fromSample:0,toSample:128},peakRms:.35,pitchTrack:[],
  attacks:[{id:'hit-0',sample:0,strength:.8,range:{fromSample:0,toSample:54}}],
  tail:{fromSample:72,toSample:128,midi:null},timeline:[{fromSample:0,toSample:128,rms:.35,brightness:.4}]};
const atmosphereReference={sampleRate:8000,frames:128,events:{lead:[]}};
const atmosphereSettings={layers:[{id:'drift',kind:'bed',assets:['tone']}]};
const atmospherePlan={op:'music.planAtmosphere',inputs:{source:atmosphereReference,assets:{tone:audio},settings:atmosphereSettings}};
const resamplingJam = {format:'ink-studio/resampling-jam',version:1,id:'bench',
  kit:{id:'bench',pads:{hit:{articulations:{default:[{id:'layer',takes:[{asset:'tone'}]}]}}}},
  performance:{events:[{id:'first',pad:'hit',time:0}],options:{sampleRate:8000,duration:.04}},
  branches:[{id:'slow',speed:.65}]};
const slicedAudio = {format:'ink-studio/sample-edit',version:1,
  source:{id:'recording',sampleRate:8000,channels:1,frames:128},
  markers:[{id:'middle',at:64}],
  clips:[{id:'attack',from:0,to:64},{id:'tail',from:64,to:128,reverse:true}],
  joins:[{left:'attack',right:'tail',frames:8,curve:'linear'}]
};
const editorial = {
  format:'ink-studio/audio-editorial',version:1,id:'bench',sampleRate:8000,
  picture:{fps:25,shots:[{id:'door',frames:2}]},sourceEdits:{tone:slicedAudio},
  clips:[{id:'tap',spot:{shot:'door',sourceFrame:1},take:'first',takes:{first:{asset:'tone',sync:{marker:'middle'}}}}]
};
const motif = { length: 2, events: [{beat:0,duration:.35,degree:1}, {beat:.75,duration:.25,degree:3}] };
const arrangement = { score:{key:{root:'C4'},harmonies:{home:{root:'C4',quality:'unison'}}},
  motifs:{melody:motif},parts:{lead:{role:'lead',material:'melody'}},
  sections:[{id:'opening',bars:1,harmony:'home'}] };
const production = {arrangement,patches:{pluck:{type:'fm'}},tracks:{lead:{patch:'pluck',gain:-11,send:.2}}};
const rehearsalTimeline={entry:'wait',end:1.4,segments:{wait:{source:'score',end:.5},reveal:{source:'score'}}};
const rehearsalTrace={format:'ink-studio/adaptive-score-trace',version:1,id:'short',entry:'wait',end:1.4,
  intents:[{kind:'music-transition',from:'wait',to:'reveal',time:.7}]};
const rehearsalEdit={id:'tail',transitions:[{from:'wait',to:'reveal',tail:.1}]};
const editSession={format:'ink-studio/music-edit-session',version:1,id:'bench',sampleRate:8000,production};
const phraseCapture={op:'music.editSession',inputs:{source:editSession,edits:[{op:'record-phrase',lane:'lead',take:'soft',
  phrase:{id:'opening',from:0,to:2,drivers:{effort:[{id:'begin',beat:0,value:.2},{id:'lift',beat:1,value:.85}]},
    mapping:{amplitude:{base:.06,from:{effort:.9}},pitchCents:{base:-21,from:{effort:24}}}}}]}};
const performanceRange=(from,to)=>({from:{beat:from},to:{beat:to}});
const performanceLead=[['pick',.25,.18,60],['lift',1.1,.22,63],['hold',3.2,1.25,65],
  ['return-a',8.15,.35,60],['return-b',9.15,.42,63]].map(([id,beat,duration,midi])=>
  ({id,beat,duration,midi,velocity:.75}));
const accompanimentSession={...editSession,production:{...production,arrangement:{...arrangement,
  parts:{...arrangement.parts,bass:{role:'bass',material:'melody'},metal:{role:'percussion',material:'melody'}},
  motifs:{melody:{length:2,events:[{beat:0,duration:.1,degree:1,velocity:0}]}},
  sections:[{id:'opening',bars:3,harmony:'home'}]},patches:{...production.patches,metal:{type:'drum',kind:'metal'}},
  tracks:{lead:{patch:'pluck',gain:-13,clips:[{id:'call',beat:0,length:12,voices:[{id:'line',notes:performanceLead}]}]},
    bass:{patch:'pluck',gain:-16,clips:[{id:'rest',beat:0,length:12,voices:[{id:'line',notes:[]}]}]},
    metal:{patch:'metal',gain:-20}}}};
const accompanimentBrief={lead:'lead',bass:'bass',metal:'metal',response:performanceRange(0,7.5),
  hook:performanceRange(8,11),context:performanceRange(0,12)};
const performanceBallot={op:'music.performanceBallot',inputs:{source:accompanimentSession,brief:{
  lead:'lead',context:accompanimentBrief.context,call:performanceRange(0,2.5),recall:accompanimentBrief.hook,
  sources:[{id:'bell',change:'Swap to a brighter tone.',patch:{type:'fm',index:2.4}}],
  performances:[{id:'late',change:'Lean into the held note and delay the second note of the return.',edits:[
    {op:'record-phrase',lane:'lead',take:'bend',phrase:{id:'delivery',from:0,to:11,
      drivers:{air:[{id:'a',beat:0,value:.24},{id:'b',beat:3.5,value:.95},{id:'c',beat:11,value:.38}]},
      mapping:{amplitude:{base:.08,from:{air:.9}}},
      notes:[{clip:'call',voice:'line',note:'hold',delay:.026,gate:1.29},
        {clip:'call',voice:'line',note:'return-b',delay:.06,accent:1.24}]}},
    {op:'comp',lane:'lead',take:'bend',...performanceRange(0,11)}]}],
  accompaniment:{bass:'bass',metal:'metal',response:accompanimentBrief.response,hook:accompanimentBrief.hook},
  arrangements:[{id:'pedal',return:'withheld',change:'Put a low pedal under the new delivery.'}]
}}};
const sessionExperiment={op:'music.experimentEditSession',inputs:{source:editSession,brief:{
  focus:{from:{beat:0},to:{beat:2}},scout:{from:{beat:0},to:{beat:1}},roles:{hook:'lead'},
  axes:{sound:[{id:'lighter',revision:{patches:{pluck:{type:'fm',index:.34}}}}]}
}}};
const lockedSearch={op:'music.searchLockedArrangement',
  inputs:{source:production,brief:{range:{from:0,to:2},locks:{tracks:{lead:'all'}},kinds:['counterline']}}};
const padPattern = {op:'music.programPads',inputs:{
  source:{id:'bench-roll',length:1,steps:[{id:'tap',beat:0,pad:'metal',play:{sample:'hit'},
    roll:{count:2,spacing:.25,velocity:[1,.7]}}]},options:{render:{sampleRate:8000}}
}};
const producerPlan = {op:'music.planProducer',inputs:{source:production,brief:{
  section:'opening',goal:'Expose the opening echo on the pluck.',strategies:[],takes:[{
    id:'echo',hypothesis:'More room makes the quiet spaces audible.',components:[
      {id:'room-send',summary:'Raise the lead send.',revision:{tracks:{lead:{send:.7}}}}
    ]
  }]
}}};
const critiquePlan={op:'music.planCritique',inputs:{source:production,brief:{section:'opening',kind:'arrival',
  goal:'Make space before the pluck answers.',offsetBeats:1,focusBeats:2,sampleRate:8000}}};
const foregroundScore={...production,arrangement:{...arrangement,parts:{
  ...arrangement.parts,keys:{role:'pad',material:'melody'}}},tracks:{...production.tracks,keys:{patch:'pluck',gain:-7}}};
const foregroundMix={source:foregroundScore,settings:{sampleRate:8000,moments:[
  {id:'signal',from:0,to:1,parts:['lead']},{id:'answer',from:1,to:2,parts:['keys']}] }};
const critiqueProbe={range:{from:{beat:0},to:{beat:1}},context:{beforeBeats:0,afterBeats:.5},sampleRate:8000};
const critiqueCompare={op:'music.compareCritiqueEdits',inputs:{source:production,request:{...critiqueProbe,
  candidates:[{id:'trim',edits:[{op:'level',parts:['lead'],gainDb:-4}]}]}}};
const referenceSettings={id:'tone',title:'Dry pluck',source:'Bench PCM',note:'The short tail leaves the downbeat clear.',
  tags:['short tail'],firstSample:16,endSample:112};
const transientAudio = { sampleRate: 8000, channels: 1,
  samples: Array.from({ length: 80 }, (_, i) => i === 32 ? .9 : 0) };
const diorama = { id: 'node-catalog', seed: 1, style: 'slate', solids: [
  { id: 'block', kind: 'box', at: [0, 0, 0], half: [.45, .45, .45], mat: { role: 'stone' }, res: .22 }
] };

const link = (node, port = 'value') => ({ node, port });
const listenerPack={op:'music.packListenerCalibration',inputs:{
  clips:{full:fitTone,quiet:{...fitTone,samples:fitTone.samples.map(sample=>sample*.45)}},
  settings:{cases:[{id:'level',kind:'known',criterion:'level',question:'Which clip is louder?',
    left:'full',right:'quiet',expected:'left'}]}
}};
const outputGrid={format:'ink-studio/grid-field',version:1,shape:[2,2],components:1,origin:[0,0],
  spacing:[1,1],unit:'m',frame:'world',data:[0,.2,.3,.1]};
const outputTrace={format:'ink-studio/sample-trace',version:1,sampleRate:8000,startSample:5,frames:3,
  channels:{bell:{unit:'Pa',samples:[0,.2,-.1]}}};
const outputPoints={format:'ink-studio/point-buffer',version:1,count:1,positions:[1,2,3],frame:'world',unit:'m'};
const outputEvents={format:'ink-studio/event-log',version:1,dropped:0,entries:[{at:.1,event:{kind:'hit'}}]};

const motionSoundMeasurements={format:'ink-studio/sound-measurements',version:1,unit:'m/s',
  points:[{at:0,value:0},{at:.5,value:.6}]};
const motionSoundPlan={format:'ink-studio/motion-sound-plan',version:1,id:'wheel',sampleRate:24000,
  lanes:{level:{source:'speed',input:[0,1],output:[0,.8]}}};

const blindCritique={op:'music.blindCritique',inputs:{source:production,plan:link('plan')}};
const memoryContext={scene:'intimate',moment:'pickup',role:'lead'};
const memoryPlan={op:'music.planCritique',inputs:{...critiquePlan.inputs,brief:{...critiquePlan.inputs.brief,
  listeningContext:memoryContext}}};
const keepMemoryExample={op:'music.keepCritique',inputs:{source:production,key:link('blind','key'),
  token:link('blind','token'),selection:{take:'a',reason:'The held breath makes the pickup easier to follow.',
    votes:[{listener:'example',trial:'pair-1',preferences:{shape:'a'}}]}}};
const questionQueue={op:'music.prioritizeListeningQuestions',inputs:{source:production,plan:link('plan'),questions:[{
  id:'arrival',criterion:'shape',question:'Which entrance has more room to breathe?',
  impacts:{'opening-arrangement':2},moves:['reference','empty-beat']}],options:{seed:4,budget:1}}};
const focusedBlind={op:'music.blindCritique',inputs:{source:production,plan:link('plan'),
  options:{moves:['reference','empty-beat'],criterion:'shape',question:'Which entrance has more room to breathe?'}}};
const rememberExample={op:'music.rememberListeningPreference',inputs:{reference:link('decision','reference')}};

const cameraGrid = { op: 'coord.cameraGrid', inputs: { width: 64, height: 48, camera: { dist: 4 } } };
const param = input => ({ input });
const group = (inputs, op, values) => ({
  inputs, nodes: { step: { op, inputs: values } }, outputs: { value: link('step') }
});
const assetFixtures = {
  pngAsset: ['png', 'swatch.png'], indexedPngAsset: ['indexed-png', 'swatch.png'],
  rasterAsset: ['png', 'swatch.png'], audioAsset: ['wav', 'tone.wav'],
  inputAsset: ['inputs', 'input.json'], jsonAsset: ['json', 'input.json']
};
const dynamic = {
  'quantity.convert': {inputs:{value:12.5,from:{unit:'kPa'},to:{unit:'Pa'}}},
  'array.map': { inputs: { items: [1, 2, 3] }, callback: group({ item: 'number' }, 'multiply', { a: param('item'), b: 2 }) },
  'array.filter': { inputs: { items: [1, 2, 3] }, callback: group({ item: 'number' }, 'lessThan', { a: 1, b: param('item') }) },
  'array.reduce': { inputs: { items: [1, 2, 3], initial: 0 },
    callback: group({ accumulator: 'number', item: 'number' }, 'add', { a: param('accumulator'), b: param('item') }) },
  'array.sort': { inputs: { items: [3, 1, 2] } },
  'data.typed': { type: 'number', inputs: { value: 7 } },
  'data.record': { inputs: { label: 'Ink', count: 3 } },
  'anim.retime': { inputs: { timing: { phase: .1, cues: [{ time: .5, rate: 0 }, { time: 1, seek: 'parent', rate: 1 }] } },
    callback: group({}, 'time', {}) }
};
function worldPortsExample(port) {
  const sample={op:'sim.world',inputs:{
    source:{format:'ink-studio/world',version:1,id:'catalog-dock',dt:.25,systems:{
      stock:{kind:'store',config:{accounts:{dock:{resource:'cargo',units:'crate',type:'integer',initial:3}}}}
    }},
    commands:[{tick:1,action:'world/event',args:{kind:'arrival'}}],
    options:{tick:1,queries:{
      account:{field:'world/account',args:{account:'stock/dock'}},
      amount:{field:'world/account',args:{account:'stock/dock'},select:'/balance'}
    }}
  }};
  if (port===undefined) return {inputs:sample.inputs};
  const options={pulse:{kind:'arrival'},scalar:{query:'amount',range:[0,4]},record:{query:'account'}};
  return {nodes:{frame:sample},inputs:{source:link('frame'),options:options[port]}};
}
const specifications = {
  'coord.pixelToUV': { inputs: { point: [.5, .5], width: 64, height: 48 } },
  'coord.uvToPixel': { inputs: { point: [.5, .5], width: 64, height: 48 } },
  'coord.renderGrid': { nodes: { field: { op: 'sdf.shape' },
    render: { op: 'sdf.render', inputs: { source: link('field'), options: { width: 16, height: 12 } } } },
  inputs: { report: link('render', 'report') } },
  'coord.project': { nodes: { grid: cameraGrid }, inputs: { point: [.3, .2, 0], grid: link('grid') } },
  'coord.unproject': { nodes: { grid: cameraGrid,
    projected: { op: 'coord.project', inputs: { point: [.3, .2, 0], grid: link('grid') } } },
  inputs: { point: link('projected'), depth: link('projected', 'depth'), grid: link('grid') } },
  'time.toFrames': { inputs: { time: 1.001, fps: { numerator: 30000, denominator: 1001 }, rounding: 'exact' } },
  'time.toSeconds': { inputs: { frame: 30, fps: { numerator: 30000, denominator: 1001 } } },
  'color.rasterToDisplay': { nodes: { linear: { op: 'color.rasterToLinear', inputs: { source: rgba } } },
    inputs: { source: link('linear') } },
  lessThan: { inputs: { a: 1, b: 2 } },
  'array.broadcast': { inputs: { arrays: { x: [1, 2], y: [3, 4] }, mode: 'cartesian' } },
  'data.get': { inputs: { record: { hue: 4 }, key: 'hue' } },
  'data.collect': { inputs: { source: { a: 1, b: 2 }, keys: ['b', 'a'] } },
  'atlas.compile': { inputs: { source: { metadata: { width: 4, height: 4, frames: [
    { id: 'tile', rect: { x: 0, y: 0, width: 4, height: 4 } }
  ] }, images: { color: rgba.data } } } },
  'raster.canvas': { inputs: { color: [60, 135, 190, 255] } },
  'raster.channels': { inputs: { planes: [mask, mask, mask] } },
  'raster.math': { inputs: { op: 'add', b: 2 } },
  'raster.crop': { inputs: { options: { x: 1, y: 1, width: 2, height: 2 } } },
  'raster.resize': { inputs: { options: { width: 8, height: 6, filter: 'nearest' } } },
  'raster.nineSlice': { inputs: { options: { width: 8, height: 6, insets: [1, 1, 1, 1] } } },
  'raster.stack': { inputs: { layers: [{ source: rgba }] } },
  'raster.depth': { inputs: { layers: [{ source: rgba, depth: 2 }] } },
  'raster.height': { inputs: { layers: [{ source: rgba, height: .5 }] } },
  'raster.spriteLayer': { inputs: { sprites: [{ id: 'tile', source: rgba }], options: { budget: { limit: 8 } } } },
  'raster.spriteStack': { inputs: { source: rgba, options: { count: 2 } } },
  'raster.pack': { inputs: { sprites: [{ id: 'tile', source: rgba }] } },
  'raster.frame': { inputs: { source: clip } },
  'draw.render': { inputs: { commands: [{ type: 'rect', rect: [0, 0, 3, 2], fill: '#3c87be' }], edges: 'hard' } },
  'draw.trackedAnchors': {
    nodes: { observations: { op: 'fx.regionObservations', inputs: { frames: [mask, mask] } } },
    inputs: { observations: link('observations'), bindings: [{ id: 'signal', track: 1, hold: .2,
      commands: [{ type: 'rect', rect: [-1, -1, 2, 2], fill: '#3c87be' }] }] }
  },
  'draw.path': { inputs: { d: 'M0 0 L2 1 L3 0' } },
  'layout.boxes': { inputs: { boxes: [{ id: 'tile', rect: [0, 0, 3, 3] }] } },
  'layout.place': { inputs: { box: { content: [0, 0, 4, 4] } } },
  'raster.floodFill': { inputs: { options: { seed: [1, 1], color: '#f2be6e' } } },
  'raster.extractComponent': { nodes: { components: { op: 'raster.components', inputs: { source: rgba } } },
    inputs: { labels: link('components', 'labels'), component: { id: 1, rect: { x: 1, y: 1, width: 2, height: 2 } } } },
  'palette.recipe': { inputs: { definition: { anchors: { light: '#3c87be' }, roles: {
    ink: { anchor: 'light', steps: 4, lightness: [.2, .8] }
  } } } },
  'palette.resolve': { inputs: { policy: { palette } } },
  'color.gradient': { inputs: { ramp: palette } },
  'color.stack': { inputs: { stack: { name: 'Sample', steps: [] } } },
  'color.key': { inputs: { options: { color: '#3c87be' } } },
  'fx.bitplane': { inputs: { source: slots } },
  'fx.emissionBands': { inputs: { options: { width: 48, height: 36,
    start: 4, body: 5, gap: 4, jagged: { amount: 4, seed: 10 } } } },
  'fx.rasterSchedule': { inputs: { source: rgba, options: { schedule: [{ row: 2, pixelScale: [2, 1] }] } } },
  'fx.tileAttributes': { inputs: { source: slots, palette, options: { tileSize: 2,
    cells: [{ cell: [1, 0], attributes: { paper: 1, ink: 2, priority: 5 } }] },
    writes: [{ id: 'scanner', rect: [1, 0, 2, 2], priority: 3, attributes: { ink: 2 } }] } },
  'fx.paletteCycle': { inputs: { source: slots, cycles: { shimmer: { range: [0, 1], period: 2 } } } },
  'fx.paletteFault': { inputs: { source: slots, options: { swaps: [[0, 1]] } } },
  'fx.regionObservations': { inputs: { frames: [mask, mask] } },
  'fx.analyze': { output: 'paths' },
  'proc.plasma': { inputs: { options: { width: 16, height: 12 }, motion: { rings: { rate: .25 } } } },
  'warp.scanlines': { inputs: { source: rgba, options: { rows: [{ row: 1, offset: [1, 0] }] } } },
  'warp.address': { inputs: { width: 4, height: 4, transforms: [{ type: 'zoom', scale: 1.5 }] } },
  'warp.compose': { inputs: { fields: [{ width: 1, height: 1, channels: 2, data: [.5, .5] }] } },
  'warp.sample': { nodes: { mapping: { op: 'warp.field', inputs: { width: 4, height: 4 } } },
    inputs: { field: link('mapping') } },
  'warp.mesh': { inputs: { control: { from: triangle, to: triangle, triangles: [[0, 1, 2]] } } },
  'warp.grid': { inputs: { control: { columns: 2, rows: 2, points: quad } } },
  'warp.morph': { inputs: { control: { from: triangle, to: triangle, triangles: [[0, 1, 2]] } } },
  'warp.frames': { inputs: { source: clip } },
  'warp.timeRemap': { inputs: { frames: [rgba, rgba], map: mask, options: { scale: 0 } } },
  'warp.displace': { inputs: { map: mask } },
  'warp.refract': { inputs: { map: mask } },
  'warp.surface': { inputs: { mesh: { ...mesh, uvs: quad } } },
  'proc.reaction': { inputs: { steps: 4, options: { width: 16, height: 16 } } },
  'proc.tiles': { inputs: { definitions: [{ id: 'ink', edges: ['a', 'a', 'a', 'a'] }], options: { width: 2, height: 2 } } },
  'proc.tileImage': { inputs: { layout: { status: 'ok', width: 1, height: 1, tiles: ['ink'] }, images: { ink: rgba } } },
  'proc.parallax': { inputs: { layers: [{ source: rgba }], options: { width: 4, height: 4 } } },
  'proc.horizon': { inputs: { bands: [{ id: 'shore', radius: 20, height: [0, 4], source: rgba }] } },
  'geo.triangulate': { inputs: { rings: [triangle] } },
  'geo.clip': { inputs: { planes: [{ normal: [1, 0, 0], offset: .3 }] } },
  'motion.landmarks': {
    nodes: { observations: { op: 'fx.regionObservations', inputs: { frames: [mask, mask], options: { contours: true } } } },
    inputs: { observations: link('observations'),
      bindings: [{ id: 'edge', track: 1, rest: [2, 2], silhouetteDirection: [1, 0] }] }
  },
  'geo.motionMesh': { inputs: { control: motionControl } },
  'scene.motionSplats': { inputs: { ids: [0], control: motionControl } },
  'geo.scrambleIndices': { inputs: { options: { maxDisplacement: 1.5, amount: .5 } } },
  'textile.pattern': { inputs: { kind: 'knit', options: { columns: 5, rows: 4 } } },
  'textile.world': {
    nodes: { yarn: { op: 'textile.pattern', inputs: { kind: 'weave', options: { columns: 6, rows: 4 } } } },
    inputs: { source: link('yarn') }
  },
  'paper.stack': {inputs:{layers:[{id:'sheet',profile:[[0,0],[1,0],[1,1],[0,1]],color:'#d9b07a'}]}},
  'paper.relief': {inputs:{options:{levels:[.1,.3],cell:.12}}},
  'paper.world': {nodes:{sheet:{op:'paper.stack',inputs:{layers:[{profile:[[-1,-1],[1,-1],[1,1],[-1,1]],color:'#d9b07a'}]}}},inputs:{source:link('sheet'),options:{draw:{shadowSamples:1}}}},
  'sdf.bound': { inputs: { bounds: { min: [-1, -1, -1], max: [1, 1, 1] } } },
  'sdf.combine': { nodes: {
    shape: { op: 'sdf.shape' }, fields: { op: 'data.record', inputs: { first: link('shape') } },
    sources: { op: 'data.collect', inputs: { source: link('fields'), keys: ['first'] } }
  }, inputs: { sources: link('sources') } },
  'sdf.voxels': { inputs: { options: { size: .3 } } },
  'voxels.world': {nodes:{shape:{op:'sdf.shape'},blocks:{op:'sdf.voxels',inputs:{source:link('shape'),options:{size:.3}}}},inputs:{source:link('blocks')}},
  'voxels.mesh': {nodes:{shape:{op:'sdf.shape'},blocks:{op:'sdf.voxels',inputs:{source:link('shape'),options:{size:.3}}}},inputs:{source:link('blocks')}},
  'sdf.facets': { inputs: { options: { size: .3 } } },
  'sdf.render': { inputs: { options: { width: 16, height: 16 } } },
  'scene.diorama': { inputs: { definition: diorama } },
  'scene.cameraTrack': { inputs: { definition: { shots: { main: { yaw: 0, dist: 4 } },
    sequence: [{ time: 0, shot: 'main' }] } } },
  'scene.world': { nodes: {
    prop: { op: 'scene.object', inputs: { source: mesh, options: { id: 'prop', resolution: .15 } } },
    props: { op: 'data.record', inputs: { prop: link('prop') } },
    objects: { op: 'data.collect', inputs: { source: link('props'), keys: ['prop'] } }
  }, inputs: { objects: link('objects') } },
  'scene.render': { inputs: { options: { width: 16, height: 16 } } },
  'scene.deepLayer': { nodes: {
    source: { op: 'scene.diorama', inputs: { definition: diorama } },
    captured: { op: 'scene.render', inputs: { source: link('source'), options: { width: 16, height: 16, deepComposite: true } } }
  }, inputs: { frame: link('captured', 'frame') } },
  'scene.objectMatte': { nodes: {
    source: { op:'scene.diorama', inputs:{definition:diorama} },
    captured: { op:'scene.render', inputs:{source:link('source'), options:{width:16,height:16,objectMattes:[1]}} }
  }, inputs:{frame:link('captured','frame'),options:{object:1}} },
  'scene.bindControls': {inputs:{template:{cutaway:{planes:[{normal:[1,0,0],offset:0}]}},
    controls:{section:.2},targets:[{control:'section',path:'/cutaway/planes/0/offset'}]}},
  'scene.pass': { inputs: { channel: 'color' } },
  'rig.bindSprite': { inputs: { bones: [bone] } },
  'rig.skinSprite': { nodes: { binding: { op: 'rig.bindSprite', inputs: { source: rgba,
    bones: [bone] } } }, inputs: { bind: link('binding') } },
  'anim.keyframes': { inputs: { channels: { x: 'number' }, keys: [{ time: 0, value: { x: 2 } }] } },
  'anim.spriteDesync': { inputs: { source: clip } },
  'anim.subjectFeedback': { inputs: { source: rgba, options: { width: 4, height: 4 } } },
  'fx.signalRecovery': { inputs: { source: rgba, options: { lossFrames: 2, lockFrames: 3 } } },
  'anim.datamosh': { inputs: { source: rgba, motion,
    options: { halfLife: 1, blockSize: [2, 2], blockMemory: { recovery: { groupSize: [1, 1], every: 4 } } } } },
  'anim.frameBank': { inputs: { source: rgba, options: { tiles: { size: [2, 2], every: 4 } } } },
  'sim.measure': {inputs:{
    plan:{format:'ink-studio/simulation-measurement-plan',version:1,id:'tap',
      measurements:{arrival:{kind:'arrival',source:'trace',threshold:.1},
        pitch:{kind:'signal-compare',source:'note',metric:'pitch',band:[800,1200]}},
      assertions:{timing:{measurement:'arrival',min:.0005,max:.001},tuning:{measurement:'pitch',max:.1}}},
    sources:{trace:outputTrace,note:{sampleRate:8000,channels:1,
      samples:Array.from({length:128},(_,i)=>.5*Math.sin(i*Math.PI/4))}}
  }},
  'sim.outputField': {inputs:{source:{width:2,height:2,data:[0,.2,.3,.1]}}},
  'sim.outputTrace': {inputs:{source:outputTrace}},
  'sim.outputPoints': {inputs:{source:[{id:'left',point:[0,1,2]},{id:'right',point:[1,2,3]}]}},
  'sim.outputMesh': {inputs:{source:mesh}},
  'sim.outputRaster': {inputs:{source:rgba}},
  'sim.outputAudio': {inputs:{source:outputTrace,options:{channels:['bell'],gain:.5}}},
  'sim.outputEvents': {inputs:{source:outputEvents}},
  'sim.fieldRaster': {inputs:{source:outputGrid}},
  'sim.fieldMesh': {inputs:{source:outputGrid}},
  'sim.traceWindow': {inputs:{source:outputTrace,options:{from:6,to:8}}},
  'sim.pointRecords': {inputs:{source:outputPoints}},
  'sim.eventWindow': {inputs:{source:outputEvents,options:{from:0,to:.2}}},
  'sim.world': worldPortsExample(),
  'sim.worldPulse': worldPortsExample('pulse'),
  'sim.worldScalar': worldPortsExample('scalar'),
  'sim.worldRecord': worldPortsExample('record'),
  'sim.define': { inputs: { kind: 'particles' } },
  'sim.run': { nodes: { recipe: { op: 'sim.define', inputs: { kind: 'particles' } } }, inputs: { recipe: link('recipe') } },
  'audio.soundMeasurements': {inputs:{rows:[{at:0,value:[0,0]},{at:.5,value:[.6,0]}],
    options:{unit:'m/s',project:'magnitude'}}},
  'audio.measureRender': {nodes:{
    subject:{op:'scene.diorama',inputs:{definition:diorama}},
    capture:{op:'scene.render',inputs:{source:link('subject'),channels:['coverage'],options:{width:16,height:16}}}
  },inputs:{frame:link('capture','frame'),options:{channel:'coverage'}}},
  'audio.motionControls': {inputs:{plan:motionSoundPlan,measurements:{speed:motionSoundMeasurements}}},
  'audio.sampleMotionControls': {nodes:{
    automation:{op:'audio.motionControls',inputs:{plan:motionSoundPlan,measurements:{speed:motionSoundMeasurements}}}
  },inputs:{source:link('automation'),options:{at:.3}}},
  'audio.physicalSignal': { inputs:{
    trace:{format:'ink-studio/wave-trace',version:1,info:{sampleRate:24000},start:0,end:3,
      pressure:{end:[.1,.2,-.03]}},selection:{name:'end'}
  } },
  'audio.physical': { inputs:{
    plan:{format:'ink-studio/physical-audio-plan',version:1,id:'bench',sampleRate:24000,frames:64,
      sources:{pipe:{signal:'tap',pcmPerUnit:.5}},paths:{arrival:{source:'pipe',delaySamples:4}}},
    signals:{tap:{format:'ink-studio/physical-signal',version:1,kind:'pressure',quantity:{unit:'Pa'},
      sampleRate:24000,startSample:0,samples:[.1,.2,-.03]}}
  } },
  'sim.wave-sensors': { inputs: {
    rig:{format:'ink-studio/sensor-rig',version:1,id:'audio-probe',revision:1,
      sensors:{mic:{kind:'microphone',source:{kind:'wave',probe:'end'}}}},
    trace:{format:'ink-studio/wave-trace',version:1,info:{sampleRate:24000},start:0,end:3,
      pressure:{end:[.1,.2,-.03]}}
  } },
  'sim.controller': { inputs: {
    controller:{format:'ink-studio/controller',version:1,id:'valve',revision:1,mode:'follow',limits:{rise:1}},
    samples:[{target:1},{target:1},{target:0}], options:{dt:.1}
  } },
  'sim.fit-targets': { inputs: { plan:{
    format:'ink-studio/inverse-target-plan',version:1,id:'level',parameters:{drive:{min:0,max:1}},
    targets:{level:{value:.8,tolerance:.0001}},
    evaluator:{kind:'world',world:{dt:.02,systems:{plant:{kind:'control',config:{op:'scale',scale:2}}}},
      inputs:{drive:'plant/value'},outputs:{level:{port:'plant/value',tick:1}}}
  } } },
  'input.compile': { inputs: { plan: {
    format:'ink-studio/input-compile-plan',version:1,id:'spoken-cue',
    sources:{voice:{kind:'ipa',text:'a m',targets:{a:{jaw:.8},m:{jaw:.1}}}}
  } } },
  'sim.gesture-score': { inputs: { score: {
    format:'ink-studio/gesture-score', version:1, id:'shutter', revision:1, rate:120,
    channels:{opening:{type:'number',base:0,limits:{min:0,max:1,maxSpeed:2}}},
    gestures:[{id:'open',channel:'opening',start:.2,end:.8,leadIn:.1,release:.2,target:1}]
  }, options:{tick:40} } },
  'sim.model': { inputs: { model: require('../examples/simulation-models/sluice.json'), options: {tick:12} } },
  'anim.feedback': { inputs: { frames: [rgba, rgba] } },
  'music.clock': { inputs: { map: { tempo: 120, swing: .625, changes: [{ beat: 4, tempo: 150 }] },
    options: { time: 2.4 } } },
  'music.resolve': { inputs: { map: { tempo: 120, barsPerPhrase: 2, swing: .625 },
    items: [{ time: { phrase: 1 }, value: { glow: 1 } }, { time: { bar: 2, beat: .5, offset: .05 }, value: { glow: 0 } }] } },
  'music.score': { inputs: { score: {
    tempoMap: { tempo: 120 }, duration: .5,
    voices: [{id:'lead'},{id:'shadow'}],
    harmonies: { home: { root:'C4',quality:'fifth',tuning:'just' } },
    changes: [{harmony:'home',time:0}],
    bindings: { angle: {voice:'lead',from:'signal',range:[-.3,.3]} }
  }, options: { time:.25 } } },
  'music.scoreAudio': { inputs: { score: {
    duration: .25, voices: [{id:'tone',waveform:'triangle'}], harmonies: {home:{root:'C3',quality:'unison'}},
    changes: [{harmony:'home',time:0}]
  }, options:{sampleRate:8000} } },
  'music.fifths': { inputs: { from:'C',to:'A' } },
  'music.motif': { inputs:{source:motif,operations:[{type:'answer'}]} },
  'music.makeMotif': { inputs:{options:{length:2,count:3,seed:42}} },
  'music.makePhrase': { inputs:{options:{beatsPerBar:4,bars:4,style:'syncopated',seed:42}} },
  'music.analyzeArrangement': { inputs:{source:arrangement,options:{audio:{end:2,sampleRate:8000}}} },
  'music.suggest': { inputs:{source:{...arrangement,sections:[{id:'opening',bars:4,harmony:'home'}]},options:{limit:2}} },
  'music.renderProduction': { inputs:{source:{...production,patches:{pluck:{type:'subtractive',pulseWidth:.41,
    pwm:{depth:.19,rate:.83},filter:{cutoff:480,resonance:1.6,envAmount:36,keyTrack:.8}}}},
    options:{end:.25,sampleRate:8000,stems:true}} },
  'music.inspectProduction': { inputs:{source:production} },
  'music.applyGroove': {inputs:{source:production,mapping:{
    template:{format:'ink-studio/performance-groove',version:1,id:'take',step:.25,length:2,
      lanes:{keys:[{slot:3,offset:.035,accent:.9,length:.21}]}},roles:{lead:{lane:'keys'}}
  }}},
  'music.inspectInstrumentGraph': {inputs:{patch:{type:'graph',output:'amp',nodes:{
    tone:{type:'oscillator',wave:'sine'},shape:{type:'envelope'},
    amp:{type:'gain',input:'tone',amount:{base:0,from:{shape:.6},by:{pressure:.2}}}
  }}}},
  'music.instrumentLibrary': {inputs:{}},
  'music.loadInstrumentPack': {inputs:{name:'cinder-flute',options:{sampleRate:8000}}},
  'music.instrumentPresets': {inputs:{}},
  'music.searchLockedArrangement': {inputs:lockedSearch.inputs},
  'music.keepLockedArrangement': {nodes:{search:lockedSearch},inputs:{search:link('search'),take:'reference'}},
  'music.renderLockedArrangement': {nodes:{search:lockedSearch,
    pick:{op:'music.keepLockedArrangement',inputs:{search:link('search'),take:'reference'}}},
    inputs:{source:link('pick'),options:{sampleRate:8000}}},
  'music.composeWholePiece': {inputs:{brief:{duration:90,palette:'electric',forms:['afterimage']}}},
  'music.planPocket': {inputs:{source:production,brief:{
    rhythm:{edits:[{part:'lead',section:'opening',scope:'section',adopt:{length:4,events:[
      {beat:.25,duration:.24,degree:1},{beat:.75,duration:.28,degree:3}
    ]}}]},
    groove:{template:{format:'ink-studio/performance-groove',version:1,id:'late',step:.25,length:2,
      lanes:{lead:[{slot:3,offset:.035,accent:1}]}},tracks:{lead:{lane:'lead'}}}
  }}},
  'music.noteClip': {inputs:{source:{id:'lines',beat:0,length:2,voices:[
    {id:'alto',notes:[{id:'held',beat:0,duration:2,midi:64}]},
    {id:'tenor',notes:[{id:'answer',beat:.5,duration:1,midi:55}]}]}}},
  'music.voiceLead': {inputs:{source:{
    ...production,arrangement:{...arrangement,parts:{...arrangement.parts,
      bass:{role:'bass',material:'melody'},inner:{role:'pad'}}},
    tracks:{...production.tracks,bass:{patch:'pluck'},inner:{patch:'pluck'}}
  },settings:{track:'inner',melody:'lead',bass:'bass',voices:[{id:'alto',low:53,high:60}]}}},
  'music.cueMap': {inputs:{source:production,map:{groups:[{id:'opening',from:0,to:4}],
    landmarks:[{id:'statement',beat:2,kind:'return'}],register:[{from:2,to:4,parts:['lead'],semitones:12}]}}},
  'music.planPerformances': { inputs:{
    source:{...production,patches:{pluck:{type:'fm',gestures:{open:{cutoff:[[0,500],[1,6500]]}}}}},
    takes:[{id:'flat'},{id:'opening',tracks:{lead:[{gesture:'open'}]}}]
  } },
  'music.developThemes': { inputs:{source:production,plan:{
    themes:{signal:{motif:'melody'}},
    appearances:[{id:'opening',theme:'signal',section:'opening',stage:'statement',targets:[{part:'lead'}]}]
  }} },
  'music.analyzeProduction': { inputs:{source:production} },
  'music.suggestProduction': { inputs:{source:production,options:{section:'opening'}} },
  'music.reviseProduction': { inputs:{source:production,revision:{tracks:{lead:{pan:.28}}}} },
  'music.auditionProduction': { inputs:{source:production,variants:[{id:'dry'},{id:'room',tracks:{lead:{send:.7}}}],
    options:{end:.25,sampleRate:8000}} },
  'music.planProducer': {inputs:producerPlan.inputs},
  'music.searchComposition': {inputs:{source:production,brief:{section:'opening',kinds:['note-gesture'],
    constraints:{pins:{lead:'pitch'}},preferences:{gesture:'pickup'}}}},
  'music.reviewProducer': {nodes:{plan:producerPlan},inputs:{
    source:production,session:link('plan'),options:{end:.25,sampleRate:8000,focus:[{id:'lead',tracks:['lead']}]}}},
  'music.keepProducer': {nodes:{plan:producerPlan},inputs:{source:production,session:link('plan'),
    selection:{keep:[{take:'echo',component:'room-send'}],reason:'Give the held notes a trailing reflection.'}}},
  'music.planForegroundMix': {inputs:foregroundMix},
  'music.auditionForegroundMix': {inputs:foregroundMix},
  'music.inspectCritiqueAudio': {inputs:{source:production,request:critiqueProbe}},
  'music.compareCritiqueEdits': {inputs:critiqueCompare.inputs},
  'music.diagnoseCritiqueAudio': {inputs:{source:foregroundScore,request:{...critiqueProbe,
    test:{kind:'masking',track:'keys'}}}},
  'music.packListenerCalibration': {inputs:listenerPack.inputs},
  'music.evaluateListenerCalibration': {nodes:{pack:listenerPack},inputs:{key:link('pack','key'),
    token:link('pack','token'),responses:{model:'Example without responses',responses:[]}}},
  'music.applyCritiqueEdit': {nodes:{comparison:critiqueCompare},inputs:{source:production,key:link('comparison','key'),
    token:link('comparison','token'),selection:{take:'trim',reason:'The adjusted opening leaves room for the answer.'}}},
  'music.planCritique': {inputs:critiquePlan.inputs},
  'music.blindCritique': {nodes:{plan:critiquePlan},inputs:blindCritique.inputs},
  'music.keepCritique': {nodes:{plan:critiquePlan,blind:blindCritique},inputs:{source:production,
    key:link('blind','key'),token:link('blind','token'),selection:{take:'a',reason:'The empty beat makes the pluck easier to follow.',
      votes:[{listener:'demo',trial:'pair-1',preferences:{shape:'a'}}]}}},
  'music.rememberListeningPreference': {nodes:{plan:memoryPlan,blind:blindCritique,decision:keepMemoryExample},
    inputs:rememberExample.inputs},
  'music.recallListeningPreferences': {nodes:{plan:memoryPlan,blind:blindCritique,decision:keepMemoryExample,remember:rememberExample},
    inputs:{memory:link('remember'),query:{context:memoryContext,criterion:'shape',moves:['reference','empty-beat']}}},
  'music.prioritizeListeningQuestions': {nodes:{plan:memoryPlan},inputs:questionQueue.inputs},
  'music.archiveListeningBallot': {nodes:{plan:memoryPlan,blind:focusedBlind},inputs:{
    key:link('blind','key'),audio:link('blind','audio'),token:link('blind','token'),ballot:{
      reason:'The two arrivals sound equally clear.',votes:[{listener:'example',trial:'pair-1',preferences:{shape:'tie'}}]}}},
  'music.tagListeningReference': {inputs:{source:audio,settings:referenceSettings}},
  'music.findListeningReferences': {inputs:{references:[{format:'ink-studio/critique-reference',version:1,...referenceSettings}],
    options:{tags:['short tail']}}},
  'music.renderTransitions': { inputs:{sources:{score:production},
    timeline:{entry:'opening',end:.25,segments:{opening:{source:'score'}},performers:{tracks:['lead']}},options:{sampleRate:8000}} },
  'music.captureScoreTrace': {inputs:{score:{entry:'wait',sections:{wait:{resource:'wait'}}},
    settings:{id:'short',end:1.4}}},
  'music.rehearseTransitions': {inputs:{sources:{score:production},timeline:rehearsalTimeline,traces:[rehearsalTrace],
    variants:[rehearsalEdit],options:{sampleRate:8000,limit:1}}},
  'music.regressAdaptiveScore': {inputs:{sources:{score:production},timeline:rehearsalTimeline,
    settings:{traces:[rehearsalTrace],variants:[rehearsalEdit],options:{sampleRate:8000,limit:1}}}},
  'music.reviseTransitions': {inputs:{sources:{score:production},timeline:rehearsalTimeline,revision:rehearsalEdit}},
  'music.arrange': { inputs:{source:arrangement} },
  'music.revise': { inputs:{source:arrangement,options:{edits:[{part:'lead',operations:[{type:'answer'}]}]}} },
  'music.reference': { inputs:{source:arrangement,part:'lead',section:'opening'} },
  'music.audition': { inputs:{source:arrangement,variants:[{id:'original'},{id:'answer',
    edits:[{part:'lead',operations:[{type:'answer'}]}]}],options:{audio:false,end:1}} },
  'music.scale': { inputs: {root:'C4',options:{mode:'dorian'}} },
  'music.scaleChord': { inputs: {root:'C4',degree:5,options:{mode:'major',size:4}} },
  'music.scaleMap': { inputs: {value:.61,options:{mode:'majorPentatonic'}} },
  'music.quantizePitch': { inputs: {value:61.6,root:'C4',options:{mode:'dorian'}} },
  'music.interval': { inputs: {a:220,b:330} },
  'music.roughness': { inputs: {spectra:[[[220,1],[440,.5]],[[228,1],[456,.5]]]} },
  'audio.buffer': { inputs: audio },
  'audio.captureSample': {inputs:sampleCapture.inputs},
  'audio.print': {nodes:{bus:{op:'data.record',inputs:{dry:audio,wet:audio}}},
    inputs:{sources:link('bus'),settings:{sample:{id:'print',label:'Bench print'},
      range:{firstSample:4,endSample:40},markers:[{id:'attack',at:8,kind:'attack'}]}}},
  'audio.searchSamples': {inputs:{entries:[{...sampleCapture.inputs.settings.sample,sampleRate:8000,
    channels:1,frames:32,duration:.004,source:{kind:'graph',name:'oscillator',firstSample:16,endSample:48,sampleRate:8000}}],
    options:{material:'synth'}}},
  'audio.proposeSampleSlices': {inputs:{source:transientAudio}},
  'audio.editSample': {inputs:{source:slicedAudio,edits:[{op:'move',id:'middle',at:62}]}},
  'audio.renderSampleEdit': {inputs:{source:audio,edit:slicedAudio}},
  'audio.auditionSampleEdit': {inputs:{source:audio,edit:slicedAudio,
    options:{left:'attack',right:'tail',before:12,after:12}}},
  'audio.spotFoley': {inputs:{assets:{tone:audio},source:{
    kit:{id:'bench',materials:{steel:{tap:{soft:{
      close:{asset:'tone',sync:{sample:63}},distant:{asset:'tone',sync:{sample:64}}
    }}}}},
    sampleRate:8000,picture:editorial.picture,
    world:{simulationRate:25,events:[{id:'1.0',tick:1,kind:'contact',material:'steel',action:'tap'}]},
    bindings:[{id:'contacts',on:{kind:'contact'}}]
  }}},
  'audio.inspectEditorial': {inputs:{source:editorial,assets:{tone:audio}}},
  'audio.reviseEditorial': {inputs:{source:editorial,assets:{tone:audio},edits:[{op:'fades',clip:'tap',fades:{inSamples:8}}]}},
  'audio.renderEditorial': {inputs:{source:editorial,assets:{tone:audio},options:{stems:true}}},
  'audio.reconformEditorial': {inputs:{source:editorial,assets:{tone:audio},revision:{
    picture:{fps:25,shots:[{id:'insert',frames:1},{id:'door',frames:2}]}}}},
  'audio.describeGesture': {inputs:{source:audio}},
  'audio.searchGestures': {inputs:{entries:[{id:'bench/take/tap',articulation:'metal',descriptors:{
    version:1,duration:.19,pitchMotion:null,tailRoughness:.08,voicedFraction:0,brightness:.5,tailLevel:-12,attackRate:5.26,
    root:null,peak:.8,rms:.12}}],options:{phrase:'short metal'}}},
  'audio.auditionGestures': {inputs:{clips:[{id:'take/direct',value:audio}],options:{targetRmsDb:-23}}},
  'audio.synthesizeGesture': {inputs:{options:{model:'metal',duration:.2,seed:12,room:.5}}},
  'audio.shapeInstrumentSample': {inputs:{source:audio,options:{attackFrames:8}}},
  'audio.analyzeInstrumentSamples': {inputs:{assets:{tone:audio}}},
  'audio.auditionInstrumentRange': {inputs:{assets:{tone:audio},options:{offsets:[0]}}},
  'audio.buildSampleInstrument': {inputs:{assets:{tone:audio},source:{zones:[{id:'tiny',takes:['tone'],low:60,high:60,root:null}]}}},
  'audio.fitInstrument': {inputs:fittedTone.inputs},
  'audio.auditionInstrumentFit': {nodes:{fit:fittedTone},inputs:{
    fit:link('fit'),assets:link('fit','assets'),reference:link('fit','reference'),
    options:{candidates:['synth'],sampleRate:8000,cases:[{id:'match',midi:61,velocity:.8,gate:.2}]}}},
  'music.auditionSoundSources': {inputs:soundDiscovery.inputs},
  'music.keepDiscoveredSound': {nodes:{discover:soundDiscovery},inputs:{bank:link('discover','bank'),
    libraries:link('discover','libraries'),selection:{candidate:'ring',from:'source',reason:'Keep the falling edge.'}}},
  'music.buildPlayableSound': {inputs:playableSound.inputs},
  'music.auditionPlayableSound': {nodes:{build:playableSound},inputs:{workshop:link('build'),assets:link('build','assets'),
    options:{pitches:[61],velocities:[.8],sampleRate:8000}}},
  'music.keepPlayableSound': {nodes:{build:playableSound},inputs:{workshop:link('build'),assets:link('build','assets'),
    selection:{candidate:'body',from:'source',projection:{beats:.75}}}},
  'audio.warp': {nodes:{edited:{op:'audio.renderSampleEdit',inputs:{source:audio,edit:slicedAudio}}},
    inputs:{source:link('edited'),options:{mode:'repitch',speed:.8}}},
  'music.planSampleMotif': {inputs:sampleMotifPlan.inputs},
  'music.renderSampleMotif': {nodes:{plan:sampleMotifPlan},inputs:{source:audio,score:audio,plan:link('plan'),role:'lead'}},
  'music.auditionSampleMotif': {nodes:{plan:sampleMotifPlan},inputs:{source:audio,score:audio,plan:link('plan')}},
  'music.extractTimbreGesture': {inputs:timbreGesture.inputs},
  'music.projectTimbreGesture': {nodes:{profile:timbreGesture},inputs:{source:link('profile')}},
  'music.matchTimbreGesture': {nodes:{profile:timbreGesture},inputs:{source:link('profile'),candidates:[timbreComparison]}},
  'music.measureTimbreEvolution': {inputs:{source:fitTone}},
  'music.planTimbreEvolution': {nodes:{evolution:{op:'music.measureTimbreEvolution',inputs:{source:fitTone}}},
    inputs:{profile:link('evolution'),production,settings:{placements:[{section:'opening',length:1}],
      routes:{attack:{part:'lead'},body:{part:'lead'},decay:{part:'lead'}}}}},
  'music.timbrePalette': {inputs:{name:'broken-beat',options:{sampleRate:8000}}},
  'music.planTimbreOrchestration': {inputs:{source:audio,production,settings:{placements:[{section:'opening'}],
    takes:[{id:'air',tail:{part:'lead'}}]}}},
  'music.handoffEditSession': {inputs:{source:editSession}},
  'music.inspectEditSession': {inputs:{source:editSession}},
  'music.editSession': {inputs:{source:editSession,edits:[{op:'pin',lane:'lead',mode:'pitch'}]}},
  'music.auditionPhraseTakes': {nodes:{capture:phraseCapture},inputs:{source:link('capture'),
    settings:{lane:'lead',phrase:'opening',takes:['soft']}}},
  'music.arrangePerformance': {inputs:{source:accompanimentSession,brief:accompanimentBrief}},
  'music.performanceBallot': {inputs:performanceBallot.inputs},
  'music.recordPerformanceBallot': {nodes:{listen:performanceBallot},inputs:{key:link('listen','key'),
    audio:link('listen','audio'),token:link('listen','token'),ballot:{listener:'example',
      answers:{identity:{choices:['a','c'],reason:'Both contours were equally memorable.'}}}}},

  'music.experimentEditSession': {inputs:sessionExperiment.inputs},
  'music.keepSessionExperiment': {nodes:{trial:sessionExperiment},inputs:{source:editSession,report:link('trial'),
    choice:{candidate:'take-001',reason:'Keep the lighter onset for this example.'}}},
  'music.renderEditSession': {inputs:{source:editSession,options:{preview:{from:{beat:0},to:{beat:1}}}}},
  'music.atmosphereReference': {inputs:{score:audio,performance:{events:{lead:[]}}}},
  'music.planAtmosphere': {inputs:atmospherePlan.inputs},
  'music.renderAtmosphere': {nodes:{plan:atmospherePlan},
    inputs:{source:link('plan'),score:audio,assets:{tone:audio},options:{stems:true}}},
  'music.auditionAtmosphere': {inputs:{source:atmosphereReference,score:audio,assets:{tone:audio},
    settings:atmosphereSettings,options:{variants:[{id:'dry',muted:true},{id:'drift'}]}}},
  'music.branchResamplingJam': {inputs:{source:resamplingJam,request:{branches:[{id:'fast',from:'slow',speed:1.5}]}}},
  'music.renderResamplingJam': {inputs:{source:resamplingJam,assets:{tone:audio},options:{branch:'slow'}}},
  'music.auditionResamplingJam': {inputs:{source:resamplingJam,assets:{tone:audio},options:{branches:['source','slow']}}},
  'music.renderSampleKit': {nodes:{
    hit:{op:'audio.renderSampleEdit',inputs:{source:audio,edit:slicedAudio,options:{slice:'middle'}}},
    bank:{op:'data.record',inputs:{hit:link('hit')}}, pads:padPattern
  },inputs:{source:{id:'bench',pads:{metal:{notes:[36,36],articulations:{default:[{id:'main',takes:[{asset:'hit'}]}]}}}},
    assets:link('bank'),events:link('pads','events'),options:link('pads','options')}},
  'music.routeSampleKit': {nodes:{played:{op:'music.inspectProduction',inputs:{source:production}}},
    inputs:{tracks:link('played','events'),routes:{lead:{pad:'reed'}}}},
  'music.programPads': {inputs:padPattern.inputs},
  'music.composeSlices': {inputs:{source:{id:'slice-canon',output:'duet',slices:{
    tick:{pad:'metal',play:{sample:'hit'}}
  },patterns:{
    call:{op:'phrase',length:1,hits:[{id:'tap',beat:0,slice:'tick'},{id:'answer',beat:.625,slice:'tick'}]},
    steady:{op:'loop',source:'call',length:4},
    drift:{op:'loop',source:'call',length:4,period:1.0625},
    duet:{op:'stack',layers:{steady:{source:'steady'},drift:{source:'drift'}}}
  },render:{sampleRate:8000}}}},
  'music.capturePadPerformance': {inputs:{source:{events:[{time:.25,kind:'pulse',channel:'switch',value:.65}]},
    routes:{switch:{pad:'metal'}}}},
  'music.editPadPerformance': {nodes:{pads:padPattern},
    inputs:{source:link('pads'),edits:[{op:'set',id:'p0-tap-1',changes:{play:{pan:.5}}}]}},
  'audio.stemControls': { inputs: {
    stems: { drums: transientAudio, synth: audio },
    settings: { drums: { envelope: { measure: 'peak', attack: 0, threshold: .4 } },
      synth: { bands: { high: { hz: [1800, 2800], attack: .03, release: .2 } } } },
    options: { time: .02 }
  } },
  'audio.detectTransients': { inputs: { source: transientAudio } },
  'audio.meterMix': {inputs:{source:audio}},
  'audio.renderRack': {inputs:{source:require('../examples/audio-racks/pocket-repeater.json'),sources:{main:audio},
    options:{tail:'cut'}}},
  'audio.auditionRack': {inputs:{source:require('../examples/audio-racks/pocket-repeater.json'),sources:{main:audio},
    options:{tail:'cut'}}},
  'audio.monitorMix': {inputs:{source:audio,options:{mode:'small-speaker'},references:{focus:audio}}},
  'audio.repairDialogue': {inputs:{source:audio,options:{gainDb:-2,declick:{ranges:[{fromSample:10,toSample:11}]}}}},
  'audio.renderMixer': {nodes:{source:{op:'audio.buffer',inputs:audio},
    bank:{op:'data.record',inputs:{tone:link('source'),space:transientAudio}}},
    inputs:{assets:link('bank'),source:{id:'session',sampleRate:8000,output:'master',
      strips:{tone:{clips:[{id:'take',source:'tone'}],sends:{room:{tap:'pre',level:.3}}},
        room:{inserts:['echo','cabinet']},master:{}},
      processors:{echo:{type:'tempo-delay',beats:.125,feedback:.18,driveDb:9},
        cabinet:{type:'convolution',impulse:'space'}},taps:{room:{strip:'room'}}}}},
  'audio.extractGroove': {inputs:{sources:{tap:transientAudio},options:{
    detect:{size:32,hop:8,sensitivity:1,minStrength:.01}}}},
  'music.fitGroove': {inputs:{events:[{lane:'hat',beat:.52,velocity:.8,durationBeats:.13}]}},
  'audio.editEvents': {
    nodes: { detected: { op: 'audio.detectTransients', inputs: { source: transientAudio } } },
    inputs: { source: link('detected'), edits: [{ op: 'rename', id: 'hit-32', name: 'Opening' },
      { op: 'add', id: 'blackout', name: 'Blackout', time: .25 }] }
  },
  'input.recording': { inputs: { events: [event] } },
  'input.editRecording': { inputs: { source: { events: [event] },
    edits: [{ op: 'move', index: 0, time: .25 }, { op: 'set', index: 0, value: .7 }] } },
  'input.replay': { inputs: { source: { events: [event] } } },
  'input.actions': { inputs: { state: { 'key:space': true }, context: 'main', contexts: { main: { select: ['key:space'] } } } },
  meshPaths: { inputs: { sources: [0], targets: [1] }, output: 'curves' },
  tiles: { inputs: { settings: { bounds: { min: [0, 0], max: [2, 2] } } } }
};

function project(node, output, extra = {}) {
  const { nodes, ...fields } = extra;
  return { format: 'ink-studio/graph-project', version: 1, ...fields,
    nodes: { ...nodes, example: node }, outputs: { value: link('example', output) } };
}

const density = 'P.density.bounded({ bounds: { min: [-1, -1, -1], max: [1, 1, 1] }, ' +
  'sample: (x, y, z) => Math.max(0, 1 - Math.hypot(x, y, z)) })';
const runtime = {
  materialSample: { inputs: { uv: [.25, .5] }, output: 'height', factory: 'P.graph.material({ height: 0.25, wetness: 0.3 })' },
  rasterLayer: { inputs: { layer: 'ink' }, type: 'any', factory: 'P.graph.raster(' + JSON.stringify(clip) + ')' },
  attributeTransfer: { inputs: { domain: 'point', entities: [[.1, .1, 0]] }, factory: 'P.attributes.mesh(' + JSON.stringify(mesh) + ')' },
  densityMesh: { inputs: { options: { resolution: .2 } }, factory: density },
  densityPoints: { inputs: { options: { count: 6 } }, factory: density }
};

function runtimeExample(id, { inputs, output = 'value', type = 'field', factory }) {
  const graph = project({ op: id, inputs: { source: param('source'), ...inputs } }, output, { inputs: { source: type } });
  return { kind: 'node', source: 'const ink = require(process.env.INK_STUDIO_MODULE || ' +
    JSON.stringify(path.resolve(__dirname, '../index.js')) + ');\n' +
    'const P = ink.load().KIT.procedural;\n' +
    'const project = ink.createGraphProject(' + JSON.stringify(graph, null, 2) + ');\n' +
    'console.log(project.run({ inputs: { source: ' + factory + ' } }).report.outputs);\n' };
}

function exampleFor(id, operation, kit) {
  if (Object.hasOwn(runtime, id)) return runtimeExample(id, runtime[id]);
  if (Object.hasOwn(assetFixtures, id)) {
    const [format, file] = assetFixtures[id];
    return { kind: 'graph', project: project({ op: id, inputs: { name: 'sample' } }, 'value',
      { assets: { sample: { format, file: path.join(__dirname, 'graph-catalog-assets', file) } } }) };
  }
  if (Object.hasOwn(dynamic, id)) {
    const { type, inputs, callback } = dynamic[id];
    return { kind: 'graph', project: project({ op: id, inputs, ...(type && { type }), ...(callback && { group: 'Callback' }) }, 'value',
      callback && { groups: { Callback: callback } }) };
  }
  if (operation.specialize) return;
  const { inputs: specified = {}, nodes: earlier, output = Object.keys(operation.outputs ?? { value: 'any' })[0] } =
    id === 'anim.visualSample' ? (() => {
      const capture = kit.KIT.procedural.visualResampling.create();
      capture.append(rgba, { motion });
      return { inputs: { source: capture.snapshot() } };
    })() : id === 'color.look' ? { inputs: { pack: kit.KIT.authoring.assetPacks.savePaletteLook({ id: 'catalog/ink', label: 'Catalog ink', palette }),
      binding: { asset: 'catalog/ink' } } } : specifications[id] ?? {};
  const nodes = { ...earlier };
  const field = { op: 'sdf.shape' }, world = { op: 'scene.diorama', inputs: { definition: diorama } };
  function sample(type, name) {
    switch (type) {
      case 'number': case 'pixelCount': case 'frames': case 'seconds': return 4;
      case 'boolean': return true;
      case 'string': return 'Ink';
      case 'raster': case 'image': case 'displayRaster': return name === 'mask' ? mask : name === 'motion' ? motion : rgba;
      case 'palette': return palette;
      case 'path': return { points: triangle };
      case 'points': return triangle;
      case 'mesh': case 'geometry': return mesh;
      case 'vec2': case 'pixels': case 'uv': return [.3, .5];
      case 'vec3': case 'worldPosition': return name === 'end' ? [1, 1, 0] : [0, 0, 0];
      case 'rgb8': return [60, 135, 190, 255];
      case 'srgb': case 'srgb-linear': return [.25, .5, .75, 1];
      case 'field': nodes.field ??= field; return link('field');
      case 'world': nodes.world ??= world; return link('world');
      case 'renderFrame': return { w: 1, h: 1, rgb: [60, 135, 190] };
      case 'audio': return audio;
      case 'record': return {};
      case 'array': case 'array<record>': return [];
      case 'array<raster>': return [rgba, rgba];
      case 'array<mesh>': return [mesh];
      case 'array<vec2>': return [[1.5, 1.5]];
      case 'array<string>': return ['ink'];
      default: return 1;
    }
  }
  const inputs = { ...specified };
  for (const [name, socket] of Object.entries(operation.inputs ?? {})) {
    if (Object.hasOwn(inputs, name) || Object.hasOwn(socket, 'default')) continue;
    inputs[name] = sample(typeof socket === 'string' ? socket : socket.type, name);
  }
  return { kind: 'graph', project: project({ op: id, ...(Object.keys(inputs).length && { inputs }) }, output, { nodes }) };
}

module.exports = { exampleFor };
