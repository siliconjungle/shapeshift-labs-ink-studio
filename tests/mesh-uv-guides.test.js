'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const Pixels = require('../cli/pixel-art.js'), PNG = require('../cli/png.js');
const cli = path.join(__dirname,'../cli/ink-studio.js'), atlas = [17,13];

function fixture() {
  const vertices = Array.from({length:8},(_,i)=>({id:'v'+i,position:[Math.floor(i/2),i%2,0]}));
  const panel = (id,n,l,t,r,b)=>({id,material:'enamel',corners:[[l,b],[r,b],[r,t],[l,t]].map(([x,y],i)=>({
    id:id+'/'+i,vertex:'v'+(n*2+[0,2,3,1][i]),uv:[x/16,y/12],attributes:{'uv/1':[x/16,(y+2)/12]}
  }))});
  return T.create({id:'uv-panels',vertices,uvBindings:{normal:1},faces:[
    panel('left',0,1,1,5,7),panel('middle',1,5,1,9,7),panel('return',2,12,3,15,8)
  ]});
}

function sample(document,layer,x,y) {
  const stamp = Pixels.stamp(Pixels.compile(document,undefined,undefined,layer),layer), slot = stamp.slots[y*stamp.width+x];
  return slot===null ? null : stamp.swatchIds[slot];
}

test('trace both sides of UV cuts and skip continuous edges unless face outlines are requested',()=>{
  const doc = fixture(), {document,report} = UV.guide(doc,{atlas});
  assert.equal(report.revision,T.revision(doc));
  assert.deepEqual(report.islands,['left','return']);
  assert.deepEqual(report.faces,['left','middle','return']);
  assert.equal(report.segments,10);
  assert.equal(document.version,2);
  assert.deepEqual(document.layers.map(row=>row.id),['uv-outline']);
  const at = (x,y)=>sample(document,'uv-outline',x,y);
  assert.equal(at(1,4),'uv-ink');
  assert.equal(at(5,4),null);
  assert.equal(at(9,4),'uv-ink');
  assert.equal(at(12,4),'uv-ink');
  assert.equal(at(10,4),null);
  assert.equal(at(15,8),'uv-ink');

  const wire = UV.guide(doc,{atlas,outline:{mode:'faces'}}).document;
  assert.equal(sample(wire,'uv-outline',5,4),'uv-ink');
  assert.equal(sample(wire,'uv-outline',3,4),null);
  const select = UV.select(doc,{domain:'faces',ids:['middle']});
  const single = UV.guide(doc,{atlas,selection:select}).document;
  assert.equal(sample(single,'uv-outline',5,4),'uv-ink');
  assert.equal(sample(single,'uv-outline',1,4),null);
});

test('fill selected geometry with atlas-aligned swatches that remain editable on a separate layer',()=>{
  const doc = fixture(), palette = {sea:'#337785',glass:'#579498',marker:'#f0bb79'};
  const saved = UV.select(doc,{domain:'islands',ids:['left']});
  const {document,report} = UV.guide(doc,{atlas,palette,selection:saved,
    fill:{mode:'checker',size:2,swatches:['sea','glass']},outline:{swatch:'marker'}});
  assert.deepEqual(report.layers,[{id:'uv-fill',pixels:63},{id:'uv-outline',pixels:28}]);
  assert.deepEqual(document.palette,palette);
  const fill = (x,y)=>sample(document,'uv-fill',x,y);
  assert.equal(fill(2,2),'sea');
  assert.equal(fill(4,2),'glass');
  assert.equal(fill(5,2),'glass');
  assert.equal(fill(6,2),'sea');
  assert.equal(fill(0,2),null);
  assert.equal(fill(13,4),null);
  assert.equal(sample(document,undefined,1,4),'marker');

  const editor = ink.createPixelEditor(document);
  editor.apply({id:'paint-guide',frame:'guide',revision:editor.describe().revision,
    operation:{tool:'pencil',layer:'uv-fill',swatch:'marker',points:[[2,2]]}});
  assert.equal(sample(editor.snapshot(),'uv-fill',2,2),'marker');
  assert.equal(sample(editor.snapshot(),'uv-outline',2,2),null);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),document);

  const solid = UV.guide(doc,{atlas,ids:['return'],outline:false,fill:{mode:'solid',swatch:'sea'},palette});
  assert.deepEqual(solid.report.layers,[{id:'uv-fill',pixels:24}]);
  assert.equal(sample(solid.document,'uv-fill',13,4),'sea');
  assert.equal(sample(solid.document,'uv-fill',5,4),null);
});

test('guard revisions and guide settings, including alternate UV layouts',()=>{
  const doc = fixture(), selection = UV.select(doc,{domain:'faces',ids:['left']});
  assert.throws(()=>UV.guide(doc,{atlas,revision:'stale'}),/different topology revision/);
  assert.throws(()=>UV.guide(doc,{atlas,selection,uvSet:'normal'}),/selection/);
  assert.throws(()=>UV.guide(doc,{atlas,material:'unknown'}),/requested material/);
  assert.throws(()=>UV.guide(doc,{atlas:[513,16]}),/1 to 512/);
  assert.throws(()=>UV.guide(doc,{atlas,outline:false}),/solid fill/);
  assert.throws(()=>UV.guide(doc,{atlas,fill:{mode:'checker',size:0}}),/positive size/);
  assert.throws(()=>UV.guide(doc,{atlas,outline:{swatch:'missing'}}),/Unknown UV guide swatch/);
  const guide = UV.guide(doc,{atlas,ids:['left'],uvSet:'normal'});
  assert.equal(guide.report.uvSet,1);
  assert.equal(sample(guide.document,'uv-outline',1,1),null);
  assert.equal(sample(guide.document,'uv-outline',1,3),'uv-ink');
});

test('infer a scene material atlas and export an exact transparent guide PNG and editable document',t=>{
  const document = fixture(), scene = {id:'guide-panels',style:'slate',solids:[],
    tilesets:{paint:ink.createBlankTileset({width:17,height:13,background:'#526879'})},
    topologyMeshes:{panel:{document,materials:[{id:'enamel',texture:{tileset:'paint'}}]}}};
  const request = {revision:T.revision(document),material:'enamel',fill:{mode:'solid',swatch:'sea'},palette:{sea:'#337785'}};
  const editor = ink.createSceneEditor(scene), expected = editor.guideMeshUV('panel',request);
  assert.deepEqual(expected.report.atlas,atlas);
  assert.deepEqual(editor.snapshot(),scene);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-uv-guides-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const write = (file,data)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(data)+'\n');
  const read = file=>JSON.parse(fs.readFileSync(path.join(cwd,file),'utf8'));
  const args = [cli,'mesh-uv','guide','scene.json','request.json','--object','panel','--out','guide'];
  write('scene.json',scene);
  write('request.json',request);
  const run = ()=>JSON.parse(execFileSync(process.execPath,args,{cwd,encoding:'utf8'}));
  assert.deepEqual(run(),{...expected.report,files:{document:'guide.json',png:'guide.png',report:'report.json'}});
  assert.deepEqual(read('guide/guide.json'),expected.document);
  const png = path.join(cwd,'guide/guide.png'), image = PNG.raster(png);
  const rgba = (x,y)=>[...image.data.subarray((y*17+x)*4,(y*17+x)*4+4)];
  assert.deepEqual([image.w,image.h],atlas);
  assert.deepEqual(rgba(3,4),[51,119,133,255]);
  assert.deepEqual(rgba(1,4),[244,219,172,255]);
  assert.equal(rgba(0,0)[3],0);
  assert.equal(sample(ink.pixelDocumentFromPNG(png),'image',3,4),'sea');
  assert.deepEqual(run(),read('guide/report.json'));

  const revised = read('guide/guide.json');
  revised.layers[0].label = 'Keep this edit';
  write('guide/guide.json',revised);
  const blocked = spawnSync(process.execPath,args,{cwd,encoding:'utf8'});
  assert.notEqual(blocked.status,0);
  assert.match(blocked.stderr,/different editable UV guide/);
  assert.deepEqual(read('guide/guide.json'),revised);
  assert.deepEqual(read('scene.json'),scene);
});
