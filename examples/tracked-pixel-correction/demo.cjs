'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ViewSource = require('../../src/pixel-view-source.js');
const { runs } = require('../../src/pixel-paint-tools.js');

const root = path.join(__dirname,'../..');
const scene = 'examples/tracked-pixel-correction/scene.js';
const directory = path.resolve(process.argv[2] ?? 'out/signal-capsule');
const [width,height] = [112,64];
const samples = [
  { id:'key',label:'Key frame',time:0,gap:[43,32] },
  { id:'approach',label:'Approach',time:1,gap:[55,32] },
  { id:'crossing',label:'Behind shutter',time:2 },
  { id:'clear',label:'Clear again',time:3,gap:[91,29] },
  { id:'exit',label:'Out of view',time:3.5 },
  { id:'return',label:'Return',time:0,cut:true,gap:[43,32] }
];
const marks = [
  ...[[36,32],[37,32],[38,32],[39,32],[40,32],[40,33],[41,33]].map(at => ({ at,kind:'highlight',swatch:'signal' })),
  ...[[28,30],[28,31],[28,32]].map(at => ({ at,kind:'contour',swatch:'copper-light' })),
  { at:[43,32],kind:'gap',swatch:null,anchors:[[42,32],[44,32]] }
];
const palette = { signal:'#e0ffc9','copper-light':'#ffc68e' };
const layers = [{ id:'backdrop' },{ id:'capsule' },{ id:'gantry' }];

function run(...args) {
  return execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],{ cwd:root,encoding:'utf8' });
}
function write(name,value) {
  const file = path.join(directory,name);
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  return file;
}
function swatch(hex) {
  const id = 'rgb-'+hex;
  palette[id] ??= '#'+hex;
  return id;
}
function backdrop(x,y) {
  if (y === 9 || y === 48) return '263638';
  if (x % 21 === 11 && y > 9 && y < 48) return '1d2d31';
  if (x % 21 === 12 && (y === 13 || y === 44)) return '48584c';
  if (y > 49) return (x+y) % 7 === 0 ? '243238' : '1a292e';
  return y < 9 ? '19252b' : x % 21 > 11 ? '223031' : '1d2a2d';
}
function toFrame(capture,row) {
  const groups = Object.fromEntries(layers.map(({ id }) => [id,new Map()]));
  for (let p=0; p<width*height; p++) {
    const { objects,objectId } = capture.passes, object = objects[objectId[p]];
    const position = [p%width,Math.floor(p/width)];
    const ink = object && Buffer.from(capture.rgb.subarray(3*p,3*p+3)).toString('hex');
    function add(layer,color) {
      const ids = groups[layer], id = swatch(color);
      if (!ids.has(id)) ids.set(id,[]);
      ids.get(id).push(p);
    }
    add('backdrop',backdrop(...position));
    // The editable artwork has one extra painted pixel across the source opening.
    if (row.gap?.[0] === position[0] && row.gap[1] === position[1]) add('capsule','82ad96');
    else if (object === 'relay') add('capsule',ink);
    else if (object) add('gantry',ink);
  }
  return { id:row.id,label:row.label,durationMs:190,
    cels:Object.fromEntries(layers.map(({ id }) => [id,{ marks:[...groups[id]].map(([swatch,pixels]) =>
      ({ swatch,runs:runs(width,pixels) })) }])) };
}

fs.mkdirSync(directory,{ recursive:true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(),'ink-correction-capture-'));
try {
  const captureFile = path.join(scratch,'view.json');
  const frames = samples.map(row => {
    run('capture',scene,'--w',String(width),'--h',String(height),'--t',String(row.time),'--out',captureFile);
    return toFrame(ViewSource.unpack(JSON.parse(fs.readFileSync(captureFile,'utf8'))),row);
  });
  const document = write('signal-capsule.ink.json',{
    format:'ink-studio/pixel-art',version:2,width,height,pixelAspect:[1,1],palette,layers,frames,
    sceneBindings:[{ id:'relay',scene,object:'relay',frame:'key',layer:'capsule' }]
  });
  const plan = write('correction-plan.json',{
    format:'ink-studio/pixel-tracked-correction',version:1,id:'restore-signal',binding:'relay',layer:'capsule',marks,
    samples:samples.map(({ gap,...row }) => ({ ...row,frame:row.id }))
  });
  const preview = JSON.parse(run('correct',document,plan));
  const report = JSON.parse(run('correct',document,plan,'--approval',preview.approval,
    '--apply',path.join(directory,'signal-capsule-corrected.ink.json'),'--review',path.join(directory,'signal-capsule-review.html')));
  write('correction-report.json',report);
  console.log(JSON.stringify({ directory,counts:report.counts,unresolved:report.unresolvedFrames },null,2));
} finally {
  fs.rmSync(scratch,{ recursive:true,force:true });
}
