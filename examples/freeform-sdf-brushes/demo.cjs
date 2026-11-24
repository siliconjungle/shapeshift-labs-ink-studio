'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const R = require('../../cli/render.js');

const w = 116, h = 80, sceneRef = 'relief-studies.json';
const round = (at,r) => ({kind:'ball',at,r});
const merge = (a,b,size) => ({kind:'join',how:'union',a,b,size});
const plate = {kind:'box',at:[0,0,-.22],half:[1.22,.85,.15],round:.145,res:.055,mat:'metal'};
const relief = merge(round([0,0,.15],[.88,.58,.33]),
  merge(round([-.68,.30,.13],[.29,.28,.25]),round([.68,.30,.13],[.29,.28,.25]),.05),.105);
const scene = {
  id:'relief-studies',style:'ember',
  camera:{target:[0,0,0],dist:4.4,yaw:0,pitch:0,sway:0,projection:'orthographic'},
  solids:[{...plate,id:'backing'}, {...relief,id:'relief',res:.045,mat:'ember'}]
};
const drawing = {
  format:'ink-studio/pixel-art',version:2,width:w,height:h,pixelAspect:[1,1],
  palette:{ink:'#17222b'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
  sceneBindings:[{id:'relief',scene:sceneRef,object:'relief'}],destinations:[{id:'sculpt',kind:'sdf-shape',binding:'relief'}]
};
const world = radius => ({unit:'world',radius});
const pixels = radius => ({unit:'pixels',radius});
const plans = [
  {mode:'grab',size:world(.57),pixels:[[77,33]],delta:[.24,.06,0],mirror:{axis:'x'}},
  {mode:'flatten',size:pixels(19),pixels:[[58,32]]},
  {mode:'scrape',size:world(.56),pixels:[[58,39]],depth:.22},
  {mode:'crease',size:pixels(20),pixels:[[49,38],[58,37],[68,37]],depth:.18,angle:-9},
  {mode:'pinch',size:world(.70),pixels:[[76,34]],angle:80,mirror:{axis:'x'}}
];

function write(file,value) {
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
}

function native(source, camera) {
  const world = ink.createSceneEditor(source).build(undefined,{retainRenderSdf:true});
  return R.render(world,{w,h,px:1,raw:true,sdfAssist:true,passes:['depth','objectId'],...camera});
}

function changeMap(before, after) {
  const rgb = new Uint8Array(before.rgb.length);
  const stats = {changed:0,extended:0,receded:0};
  const reliefMask = image=>image.passes.objects.indexOf('relief');
  const a=reliefMask(before), b=reliefMask(after);
  for (let i=0;i<w*h;i++) {
    const from=before.passes.depth[i], to=after.passes.depth[i];
    let color=[21,29,39];
    if (before.passes.objectId[i]===a || after.passes.objectId[i]===b) {
      color=[61,57,57];
      const depth=from-to;
      if (Math.abs(depth)>.013) {
        stats.changed++;
        stats[depth>0?'extended':'receded']++;
        color=depth>0?[87,220,188]:[247,145,91];
      }
    }
    rgb.set(color,i*3);
  }
  return { image:{w,h,rgb},stats };
}

function run(directory) {
  fs.mkdirSync(directory,{recursive:true});
  const out=name=>path.join(directory,name);
  const camera={yaw:.13,pitch:.20}, before=native(scene,camera), rows=[], report=[];
  PNG.write(out('before.png'),w,h,before.rgb);
  write(out(sceneRef),scene);
  write(out('drawing.json'),drawing);
  for (const [i,brush] of plans.entries()) {
    const source=ink.createSceneEditor(scene);
    const editor=ink.createPixelEditor(drawing,{sceneEditor:source,sceneRef});
    const {documentRevision:revision,sourceRevision}=editor.targets('sculpt');
    const edit={id:brush.mode,frame:'front',destination:'sculpt',revision,sourceRevision,operation:{brush}};
    const preview=editor.previewEdit(edit);
    if (!preview.valid) throw new Error(JSON.stringify(preview.conflicts));
    const edited=editor.apply(edit), after=native(edited,camera);
    const {image,stats}=changeMap(before,after);
    if (!stats.changed) throw new Error('No native depth change for '+brush.mode);
    const file=out(brush.mode+'.png');
    PNG.write(file,w,h,after.rgb);
    PNG.write(out(brush.mode+'-depth-change.png'),w,h,image.rgb);
    write(out(brush.mode+'-edit.json'),edit);
    write(out(brush.mode+'-scene.json'),edited);
    rows.push(before,after,image);
    report.push({number:i+1,mode:brush.mode,...stats,brush:preview.targets[0].brush});
  }
  const labels=plans.flatMap((_,i)=>[String(i+1),'','']);
  const sheet=R.grid(rows,3,labels);
  PNG.write(out('comparison.png'),sheet.w,sheet.h,sheet.rgb);
  write(out('report.json'),{grid:{width:w,height:h},map:{mint:'closer or added',orange:'farther or removed'},rows:report});
}

run(path.resolve(process.argv[2] ?? 'studio/out/freeform-sdf-brushes'));
