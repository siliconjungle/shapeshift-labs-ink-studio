'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), K = ink.load().KIT, paint = require('../cli/tileset-face-paint.js').paint;

const colors=[[226,74,70],[79,196,139],[54,111,223]], sentinel=[244,13,191];
const crop={x:3,y:1,width:3,height:1}, other={x:7,y:1,width:3,height:1};
const view={w:108,h:72,px:1,raw:true};
function fixture(material) {
  const width=11,height=3,pixels=new Uint8Array(width*height*4);
  for (let i=0;i<width*height;i++) pixels.set([...sentinel,255],i*4);
  colors.forEach((rgb,i)=>pixels.set([...rgb,255],(width+crop.x+i)*4));
  const asset={version:1,width,height,encoding:'rgba8',data:Buffer.from(pixels).toString('base64'),...(material && {material})};
  const source={id:'studio-wall',style:'slate',solids:[],tilesets:{masonry:asset},
    camera:{yaw:0,pitch:0,dist:6,target:[0,0,0],projection:'orthographic',sway:0}};
  const editor=ink.createSceneEditor(source);
  editor.placeTilesetFace({object:'wall',face:'run',selection:ink.pickTilesetRectangle(source,'masonry',crop),
    origin:[-2.5,-.5,0],worldSize:[5,1]});
  return editor;
}

const rule=(u,extra={})=>({u,v:'clamp',repeats:[2,1],...extra});
const request=wrap=>({object:'wall',face:'run',wrap});
const render=editor=>ink.render(editor.build(),view);
const center=frame=>Array.from({length:frame.w},(_,x)=>Array.from(frame.rgb.slice(
  (Math.floor(frame.h/2)*frame.w+x)*3,(Math.floor(frame.h/2)*frame.w+x)*3+3)));
const same=(a,b)=>a.every((value,i)=>value===b[i]);
function runs(pixels) {
  const output=[];
  for (const rgb of pixels) {
    const color=colors.findIndex(row=>same(rgb,row));
    if (color<0) continue;
    if (output.at(-1)?.color===color) output.at(-1).count++;
    else output.push({color,count:1});
  }
  return output;
}

test('sample clamp, repeat and mirror on one quad and recover the source through a repeated copy',()=>{
  const editor=fixture(), original=editor.snapshot(), originalPixels=render(editor).rgb;
  const clamp=editor.applyTilesetWrap(request(rule('clamp')));
  assert.equal(clamp.faceTriangles,2);
  assert.equal(clamp.meshTriangles,2);
  assert.deepEqual(editor.meshTopology('wall').document,original.topologyMeshes.wall.document);
  assert.deepEqual(editor.snapshot().tilesets,original.tilesets);
  const clamped=runs(center(render(editor)));
  assert.deepEqual(clamped.map(row=>row.color),[0,1,2]);
  assert(clamped[2].count>3*clamped[0].count);
  editor.applyTilesetWrap(request(rule('repeat')));
  const repeated=center(render(editor));
  assert(!repeated.some(rgb=>same(rgb,sentinel)));
  assert.deepEqual(runs(repeated).map(row=>row.color),[0,1,2,0,1,2]);
  const hits=repeated.flatMap((row,x)=>same(row,colors[1]) ? [x] : []);
  const tool=(x,operation)=>paint(editor,{...operation,at:[x,Math.floor(view.h/2)],object:'wall',face:'run',
    view:{w:view.w,h:view.h,raw:true}}).report;
  for (const x of [hits[2],hits.at(-3)]) assert.deepEqual(tool(x,{tool:'eyedropper',sample:'color'}).source.at,[crop.x+1,crop.y]);
  const fill=tool(hits.at(-3),{tool:'fill',fill:{colors:[{color:'#ddd2ae'}]}});
  assert(fill.canCommit);
  assert.deepEqual(fill.fill.rect,[crop.x,crop.y,crop.width,crop.height]);
  assert(fill.changedPixels>hits.length/2);
  editor.applyTilesetWrap(request(rule('mirror')));
  assert.deepEqual(runs(center(render(editor))).map(row=>row.color),[0,1,2,1,0]);
  assert.equal(editor.eyedropTilesetFace({object:'wall',face:'run'}).wrap.u,'mirror');
  editor.applyTilesetWrap(request(rule('repeat',{offset:[-1/3,0]})));
  assert.equal(runs(center(render(editor)))[0].color,2);
  editor.applyTilesetWrap(request(null));
  assert(!editor.meshTopology('wall').bindings[0].data.wrap);
  assert(Buffer.from(render(editor).rgb).equals(originalPixels));
  assert(editor.undo());
  assert.equal(editor.meshTopology('wall').bindings[0].data.wrap.offset[0],-1/3);
  assert(editor.redo());
  assert(!editor.meshTopology('wall').bindings[0].data.wrap);
});

test('vertical wrapping follows top-down pigment UVs and repeats cutout coverage',()=>{
  const pixels=Uint8Array.from(colors.flatMap((rgb,i)=>[...rgb,i===1 ? 0 : 255]));
  const source={id:'vertical-strip',style:'slate',solids:[],tilesets:{
    pattern:{version:1,width:1,height:3,encoding:'rgba8',data:Buffer.from(pixels).toString('base64')}},
    camera:{yaw:0,pitch:0,dist:6,target:[0,0,0],projection:'orthographic',sway:0}};
  const editor=ink.createSceneEditor(source);
  editor.placeTilesetFace({object:'wall',face:'run',selection:ink.pickTilesetRectangle(source,'pattern',{x:0,y:0,width:1,height:3}),
    origin:[-.5,-2,.1],worldSize:[1,4]});
  editor.applyTilesetWrap(request({v:'repeat',repeats:[1,2]}));
  const frame=render(editor), x=Math.floor(view.w/2);
  const column=Array.from({length:frame.h},(_,y)=>Array.from(frame.rgb.slice((y*frame.w+x)*3,(y*frame.w+x)*3+3)));
  assert.deepEqual(runs(column).map(row=>row.color),[0,2,0,2]);
  assert(!column.some(row=>same(row,colors[1])));
  const start=column.findIndex(row=>same(row,colors[0])), end=column.findIndex(row=>same(row,colors[2]));
  assert(column.slice(start,end).some(row=>same(row,[7,8,11])));
});

test('512 repeats use two triangles and a wrapped face survives an atlas swap and a quad split',()=>{
  const editor=fixture(), report=editor.applyTilesetWrap(request(rule('repeat',{repeats:[512,1]})));
  assert.equal(report.meshTriangles,2);
  assert.equal(K.sceneMeshes.layer(editor.build().topologyMeshes.wall.mesh).tileWraps.length,1);
  assert.throws(()=>editor.planTilesetWrap(request(rule('repeat',{repeats:[0,1]}))),/Repeats must be positive/);
  editor.applyTilesetWrap(request(rule('mirror')));
  const before=render(editor).rgb.slice(), document=editor.meshTopology('wall').document;
  editor.transformTilesetCanvas('masonry',{type:'swap',a:crop,b:other});
  assert(Buffer.from(render(editor).rgb).equals(before));
  assert.equal(editor.meshTopology('wall').bindings[0].data.selection.x,other.x);
  assert(editor.undo());
  editor.repairMeshTopology('wall',{revision:K.meshTopology.revision(document),operations:[{kind:'split-quad',faces:['run']}]});
  assert.equal(editor.meshTopology('wall').bindings.filter(row=>row.data.wrap?.u==='mirror').length,2);
  assert(Buffer.from(render(editor).rgb).equals(before));
});

const linearMaterial={lighting:'unlit',alphaMode:'opaque',magFilter:'linear'};
test('linear filtering wraps taps within the crop at the repeat seam',()=>{
  const editor=fixture(linearMaterial);
  editor.applyTilesetWrap(request(rule('repeat')));
  const seam=center(render(editor))[Math.floor(view.w/2)-1];
  assert(seam[0]>colors[2][0]+10 && seam[0]<colors[0][0]-10);
  assert(seam[1]<colors[2][1] && seam[1]>colors[0][1]);
  assert(seam[2]>colors[0][2]+10 && seam[2]<colors[2][2]-10);
});

test('CLI previews, commits and rejects a stale receipt',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-wrap-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
  const scene=fixture().snapshot();
  save('scene.json',scene);
  save('wrap.json',request(rule('mirror')));
  const args=[path.resolve(__dirname,'../cli/ink-studio.js'),'tileset','wrap','wrap.json','--scene','scene.json'];
  const run=(...options)=>JSON.parse(execFileSync(process.execPath,[...args,...options],{cwd:dir,encoding:'utf8'}));
  const report=run();
  assert.equal(report.faceTriangles,2);
  save('preview.json',report);
  run('--expect','preview.json','--out','wrapped.json');
  const output=JSON.parse(fs.readFileSync(path.join(dir,'wrapped.json')));
  assert.equal(output.topologyMeshes.wall.bindings[0].data.wrap.u,'mirror');
  save('scene.json',{...scene,name:'changed'});
  const stale=spawnSync(process.execPath,[...args,'--expect','preview.json','--out','stale.json'],{cwd:dir,encoding:'utf8'});
  assert.notEqual(stale.status,0);
  assert.match(stale.stderr,/preview is stale/);
  assert(!fs.existsSync(path.join(dir,'stale.json')));
});

function browserWorlds({KIT},docs) {
  return Object.fromEntries(Object.entries(docs).map(([key,doc])=>[key,KIT.diorama.build(doc)]));
}

test('WebGL addresses the same crop for clamp, repeat, mirror, and linear seam taps',{skip:!process.env.INK_TEST_CHROME},()=>{
  const documents={};
  for (const mode of ['clamp','repeat','mirror','linear']) {
    const editor=fixture(mode==='linear' ? linearMaterial : undefined);
    editor.applyTilesetWrap(request(rule(mode==='linear'?'repeat':mode)));
    documents[mode]=editor.snapshot();
  }
  const result=require('../cli/look-webgl.js')({},browserWorlds,(kit,build,backend,{documents,view})=>{
    const draw=backend(view.w,view.h,{raw:true,dither:0});
    try {
      return {rows:Object.fromEntries(Object.entries(build(kit,documents)).map(([key,world])=>{
        draw.draw(world);
        const points=Object.fromEntries(Array.from({length:view.w},(_,x)=>[x,[x,Math.floor(view.h/2)]]));
        return [key,Object.values(draw.sample(points))];
      }))};
    } finally { draw.close(); }
  },{documents,view});
  for (const [key,pixels] of Object.entries(result.rows)) {
    const cpu=center(render(ink.createSceneEditor(documents[key])));
    assert(!pixels.some(rgb=>same(rgb,sentinel)));
    assert.deepEqual(runs(pixels).map(row=>row.color),runs(cpu).map(row=>row.color));
    if (key==='linear') {
      const i=Math.floor(view.w/2)-1;
      assert(pixels[i].every((n,k)=>Math.abs(n-cpu[i][k])<=2));
    }
  }
});
