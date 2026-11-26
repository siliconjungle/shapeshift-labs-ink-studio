const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');

const root = path.resolve(process.argv[2] ?? 'prism-relay');
const asset = name => path.join(root, name);
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'deep-shot', ...args], { encoding:'utf8' }));
const loadJSON = file => JSON.parse(fs.readFileSync(file,'utf8'));
const kit = ink.load(), drawing = kit.KIT.procedural.drawing2d;
const rectangle = (x,y,w,h,fill) => ({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale = 1,color = '#f6db9a') => ({type:'text',text,at:[x,y],scale,color});
const poly = (points,fill) => ({type:'polygon',points,fill});
const render = (width,height,commands) => drawing.render({width,height,edges:'hard',commands});
const encode = image => PNG.encode(image.width,image.height,image.data,4);

const scene = require('./deep-openexr/signal-relay.js')(kit).build(51);
const width = 192, height = 126, times = [0,.5,1];
const { frames } = ink.exportDeepEXR(scene,{ out:asset('camera'), view:{w:width,h:height}, times });
const at = [104,66], originalFile = path.join(asset('camera'),frames[1].file);
const beforeRay = run('inspect',originalFile,'--pixel',at.join(',')).pixel.samples;
const front = beforeRay.find(sample=>sample.object==='teal front sheet');
const rear = beforeRay.find(sample=>sample.object==='amber rear sheet');
assert(front && rear && front.z < rear.z);
const depth = (front.z + rear.z) / 2;

const cardWidth = 84, cardHeight = 68, cardFrames = [];
for (const [i,time] of times.entries()) {
  const phase = i * 5;
  const commands = [
    poly([[10,11],[71,11],[78,18],[78,53],[71,60],[10,60],[4,54],[4,17]],'#291c30'),
    poly([[11,14],[70,14],[75,19],[75,51],[69,57],[11,57],[7,52],[7,19]],'#ce7882'),
    rectangle(10,20,62,31,'#642b50'), rectangle(11,21,60,27,'#43213a'),
    rectangle(11,19,59,1,'#ffc99d'), rectangle(11,49,59,1,'#e78d84'),
    rectangle(13,45,55,1,'#985476'),
    poly([[21+phase,25],[27+phase,37],[21+phase,43],[15+phase,37]],'#f8a385'),
    poly([[21+phase,26],[21+phase,42],[15+phase,37]],'#ffe2ad'),
    text('KEY',43,26,2,'#ffe5b3'), text('PRISM',37,39,1,'#e1acc2'),
    rectangle(12,53,23,1,'#ec9d8c'), rectangle(44,53,25,1,'#9c4d6e')
  ];
  const file = 'card-' + i + '.png';
  files.write(asset(file),encode(render(cardWidth,cardHeight,commands)));
  cardFrames.push({file,time:time+.125});
}
files.json(asset('cards.json'),{format:'ink-studio/deep-shot-sequence',version:1,frames:cardFrames});
const source = {id:'camera',file:'camera/deep.json'};
const settings = {format:'ink-studio/deep-shot',version:1,reference:'camera',
  working:'display-p3-linear',display:{space:'srgb',outOfRange:'clamp'}};
files.json(asset('before.json'),{...settings,inputs:[source]});
files.json(asset('prism-relay.shot.json'),{...settings,inputs:[source,{id:'key',kind:'card',file:'cards.json',
  offset:[63,30],timeOffset:-.125,depth,object:'prism service key',material:'rose enamel'}],effects:[
    {id:'transmission-recovery',operator:'opacity',select:{object:'teal front sheet'},params:{scale:.85}},
    {id:'key-exposure',operator:'color',select:{source:'key'},color:{input:'srgb-linear',output:'srgb-linear'},
      params:{exposure:.16,matrix:[[1.03,0,.03],[0,.9,0],[.04,0,1.04]]}}
  ]});
const baseline = run('run',asset('before.json'),'--out',asset('before'));
const result = run('run',asset('prism-relay.shot.json'),'--out',asset('composite'));
const reportPath = path.join(asset('composite'),result.report), report = loadJSON(reportPath);
const middle = path.dirname(reportPath);
const afterRay = run('inspect',path.join(middle,report.frames[1].deep.file),'--pixel',at.join(',')).pixel.samples;
assert.deepEqual(afterRay.slice(0,3).map(sample=>sample.object),
  ['teal front sheet','prism service key','amber rear sheet']);
assert.deepEqual(report.frames.map(frame=>frame.sources[1].delta),[0,0,0]);
assert(report.frames.every(frame=>frame.effects.every(effect=>effect.matched>0)));

const W=728,H=395, sheet=render(W,H,[
  rectangle(0,0,W,H,'#10212b'), rectangle(24,48,680,1,'#3e6970'),
  text('PRISM RELAY',24,18,3), text('REGISTERED DEEP COMPOSITE',481,27,1,'#a4c9c5'),
  text('CAMERA PLATE',24,63), text('PRISM KEY BETWEEN GLASS',239,63), text('REGISTERED RAY',461,63),
  rectangle(459,81,242,125,'#172d38'), text('FRONT TO BACK',471,93,1,'#9cc8c8'),
  text('TEAL GLASS',485,116,1,'#b9ebd7'), text('PRISM KEY',485,138,1,'#f5b3ba'),
  text('AMBER GLASS',485,160,1,'#f1bb80'), text('HOUSING',485,182,1,'#a2b5bc'),
  rectangle(471,115,8,8,'#72c5ba'), rectangle(471,137,8,8,'#e38c9f'),
  rectangle(471,159,8,8,'#dca16b'), rectangle(471,181,8,8,'#8297a2'),
  rectangle(23,224,681,1,'#3e6970'), text('ALIGNED SHOT SEQUENCE',24,239,1,'#adc6bb'),
  text('0.00 S',24,349), text('0.50 S',189,349), text('1.00 S',354,349),
  text('SAME CAMERA DEPTH',528,277,1,'#bad1cb'), text('LINEAR WORKING COLOR',528,293,1,'#bad1cb'),
  text('EDITED SAMPLES RETAINED',528,309,1,'#bad1cb')
]);
function paste(image,left,top,w=image.w,h=image.h) {
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=(Math.floor(y*image.h/h)*image.w+Math.floor(x*image.w/w))*4;
    if(!image.data[p+3])continue;
    sheet.data.set(image.data.subarray(p,p+4),((top+y)*W+left+x)*4);
  }
}
const baseDir=path.dirname(path.join(asset('before'),baseline.report)), baseReport=loadJSON(path.join(baseDir,'report.json'));
paste(PNG.raster(path.join(baseDir,baseReport.frames[1].image.file)),24,81);
paste(PNG.raster(path.join(middle,report.frames[1].image.file)),239,81);
for(const [i,row] of report.frames.entries())paste(PNG.raster(path.join(middle,row.image.file)),24+i*165,256,142,92);
files.write(asset('prism-relay.png'),encode(sheet));
files.json(asset('demo-report.json'),{shot:'prism-relay.shot.json',report:path.relative(root,reportPath),
  probe:at,before:beforeRay,after:afterRay,times:report.frames.map(frame=>frame.time)});
console.log(asset('prism-relay.png'));
