'use strict';

const assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {test}=require('node:test');
const ink=require('..'), kit=ink.load(), R=require('../cli/render.js'), PNG=require('../cli/png.js');
const {run}=require('../cli/tileset-coverage-review.js');

function fixture() {
  function sheet(width,height,rgb,mode,alpha) {
    const pixels=Array.from({length:width*height},(_,i)=>[...rgb,alpha(i%width,Math.floor(i/width))]).flat();
    return {version:1,width,height,encoding:'rgba8',data:Buffer.from(pixels).toString('base64'),material:{lighting:'unlit',alphaMode:mode}};
  }
  const scene={id:'coverage-window',style:'slate',solids:[],camera:{target:[0,0,0],dist:6,yaw:0,pitch:0,projection:'orthographic',sway:0},
    tilesets:{
      backing:sheet(3,3,[188,131,84],'opaque',()=>0),
      grille:sheet(9,7,[150,180,165],'mask',(x,y)=>x%4===0 || y===0 || y===6 ? 185 : 40),
      pane:sheet(2,2,[64,163,188],'blend',()=>96),
      overlay:sheet(2,2,[144,214,215],'blend',()=>144)
    }};
  const editor=ink.createSceneEditor(scene);
  for (const [id,origin,size] of [
    ['backing',[-2,-1.25,-.45],[4,2.5]],['grille',[-1.45,-.9,.45],[2.9,1.8]],
    ['pane',[-1.5,-.92,.1],[3,1.84]],['overlay',[-.43,-.60,.25],[1.17,.91]]
  ]) {
    const {width,height}=scene.tilesets[id];
    editor.placeTilesetFace({object:id,face:'panel',origin,worldSize:size,
      selection:ink.pickTilesetRectangle(scene,id,{x:0,y:0,width,height})});
  }
  editor.applyTilesetWrap({object:'backing',face:'panel',wrap:{u:'repeat',v:'repeat',repeats:[3,2]}});
  editor.addSurfaceDecal({id:'sign',kind:'lettering',anchor:{object:'backing',face:'panel',normal:[0,0,1],
    at:[-.65,.3,-.45],size:[.48,.20],bias:.01},grid:[2,2],image:{width:1,height:1,pixels:[230,227,167,255]}});
  return editor;
}

const targets=[['wall','backing','opaque'],['screen','grille','mask'],['glass','pane','blend'],['wash','overlay','blend']]
  .map(([id,object,mode])=>({id,object,material:'tileset/'+object,face:'panel',mode}));
targets.push({id:'sign',object:'backing',material:'decal:sign',mode:'mask'});
const spec={w:144,h:96,views:[{id:'left',camera:{yaw:-.34}},{id:'center'},{id:'right',camera:{yaw:.34},zoom:1.1}],
  targets,
  pairs:[{id:'screen-wall',front:'screen',back:'wall'},{id:'glass-wall',front:'glass',back:'wall'},
    {id:'wash-glass',front:'wash',back:'glass'}],
  checks:[{target:'wall',metric:'clearPixels',max:0},{target:'screen',metric:'clearPixels',min:10},
    {target:'glass',metric:'fractionalPixels',min:10},{target:'wash',metric:'overpaintPixels',max:0},
    {pair:'glass-wall',metric:'transmittedPixels',min:10},{pair:'screen-wall',metric:'openPixels',min:10},
    {pair:'wash-glass',metric:'transmittedPixels',min:1},{pair:'wash-glass',metric:'reversedPixels',max:0}]
};

function folder(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-coverage-review-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}

test('native movement review captures clear, opaque, blended, and overlapping coverage without changing picture',t=>{
  const dir=folder(t), editor=fixture(), original=editor.snapshot(), result=run(editor,spec,dir,kit);
  assert.deepEqual(editor.snapshot(),original);
  assert(result.passed);
  assert.equal(result.frames.length,3);
  for (const [i,frame] of result.frames.entries()) {
    assert(frame.targets.wall.sampledPixels>10);
    assert.equal(frame.targets.wall.projectedPixels,frame.targets.wall.sampledPixels);
    assert(frame.targets.glass.visibleCoverage<frame.targets.glass.projectedCoverage);
    assert(frame.targets.screen.hiddenPixels===0 || frame.targets.screen.visiblePixels>0);
    assert(frame.pairs['screen-wall'].blockedPixels>10);
    assert(frame.pairs['screen-wall'].openPixels>10);
    assert(frame.pairs['glass-wall'].transmittedPixels>10);
    assert(frame.pairs['wash-glass'].transmittedPixels>10);
    assert.equal(frame.pairs['wash-glass'].reversedPixels,0);
    const projected=PNG.raster(path.join(dir,frame.files.mats.glass.sampled));
    assert(projected.data.includes(96));
    const raster=PNG.raster(path.join(dir,frame.files.picture));
    const solo=R.render(editor.build(),{w:spec.w,h:spec.h,px:1,raw:true,camera:spec.views[i].camera,zoom:spec.views[i].zoom,
      renderGraph:false,composite:false,renderGrid:false,shutter:false,cameraGuides:false});
    assert(Buffer.from(raster.data.filter((_,i)=>i%4!==3)).equals(solo.rgb));
  }
  assert.notDeepEqual(result.frames[0].camera.view,result.frames[2].camera.view);
  assert(result.frames[2].visiblePixelDelta.glass!==0);
  assert(result.frames.some(frame=>frame.targets.sign.visiblePixels>0));
});

test('authored order checks report reversed overlaps and fail the CLI with evidence',t=>{
  const dir=folder(t), scene=fixture().snapshot();
  const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  save('scene.json',scene);
  save('review.json',{...spec,views:[{id:'center'}],pairs:[{id:'wrong',front:'glass',back:'wash'}],
    checks:[{pair:'wrong',metric:'reversedPixels',max:0}]});
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const args=[cli,'tileset','coverage-review','review.json','--scene','scene.json','--out','evidence'];
  const failed=spawnSync(process.execPath,args,{cwd:dir,encoding:'utf8'});
  assert.equal(failed.status,1,failed.stderr);
  const report=JSON.parse(failed.stdout);
  assert(!report.passed);
  assert(report.frames[0].pairs.wrong.reversedPixels>10);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'evidence','report.json'))),report);
  assert(fs.existsSync(path.join(dir,'evidence',report.frames[0].files.coverage)));
  save('review.json',{...spec,targets:[...targets,{...targets[0],id:'duplicate'}]});
  assert.throws(()=>execFileSync(process.execPath,args,{cwd:dir,stdio:'pipe'}),/targets overlap/);
});
