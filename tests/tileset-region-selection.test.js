'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const view = {w:120,h:80,px:1,ortho:true,yaw:0,pitch:0,target:[0,0,0],zoom:1.14,lockCamera:true};
const marquee = {type:'marquee',rect:[54,34,12,12]};
const brush = {type:'brush',points:[[24.5,40.5],[95.5,40.5]],radius:2};
const source = {id:'tile-regions',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:8},
  camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,projection:'orthographic',sway:0},
  tilesets:{paint:ink.createBlankTileset({width:8,height:8,background:'#4c8969'})}};
const selection = ink.pickTilesetRectangle(source,'paint',{x:0,y:0,width:8,height:8});
const api = ink.load().KIT.meshTopology;

function draft() {
  const editor = ink.createSceneEditor(source);
  for (const [object,face,x,z,right,worldSize] of [
    ['wall','left',-1.7,0],['wall','middle',-.5,0],['wall','right',1.7,0,[-1,0,0]],
    ['cover','shutter',-.55,.8,[1,0,0],[1.1,1]]
  ]) editor.placeTilesetFace({object,face,selection,origin:[x,-.5,z],right,worldSize});
  editor.editMeshTopology('wall',{vertices:[[4,-.5,0],[5,-.5,0],[5,.5,0],[4,.5,0]].map((position,i)=>({id:'native-v'+i,position})),
    faces:[{id:'plain',corners:[0,1,2,3].map(i=>({id:'native-c'+i,vertex:'native-v'+i}))}]});
  return editor;
}

const options = visibility=>({visibility});
const visible = {visibility:'visible'}, through = {visibility:'through'};
const query = settings=>({object:'wall',domain:'tiles',query:settings});
const capture = (editor,region)=>ink.captureMeshTopologyVisibility(editor.build(),'wall',view,{region,participation:true}).visibility;

test('marquee and swept brush use the native view with independent occlusion and winding',()=>{
  const editor = draft();
  const boxView = capture(editor,marquee), brushView = capture(editor,brush);
  const pick = (region,filter,evidence)=>editor.selectTilesetComponents(query({region,filter}),options(evidence)).ids;
  assert.deepEqual(pick(marquee,undefined,boxView),[]);
  assert.deepEqual(pick(marquee,through,boxView),['middle']);
  assert.deepEqual(pick(marquee,through,{...boxView,regional:{...boxView.regional,query:{rect:marquee.rect,type:'marquee'}}}),['middle']);
  assert.deepEqual(pick(brush,visible,brushView),['left','right']);
  assert.deepEqual(pick(brush,through,brushView),['left','middle','right']);
  assert.deepEqual(pick(brush,{...through,backfaces:'exclude'},brushView),['left','middle']);
  assert.deepEqual(pick(brush,{...visible,backfaces:'exclude'},brushView),['left']);
  assert.throws(()=>pick(marquee,visible,brushView),/this selection region/);
  assert.throws(()=>capture(editor,{type:'marquee',rect:[120,0,1,1]}),/must fit/);
  assert.throws(()=>capture(editor,{type:'brush',points:[[10,10]],radius:0}),/positive radius/);
  assert.throws(()=>pick(marquee,{visibility:'hidden'},boxView),/needs visible or through/);
});

test('adds, subtracts, inverts and converts the retained face set on the same revision',()=>{
  const editor = draft(), doc = editor.meshTopology('wall').document;
  const left = editor.selectTilesetComponents(query({ids:['left']})).selection;
  const boxView = capture(editor,marquee);
  const add = editor.selectTilesetComponents(query({from:left,region:marquee,operation:'add',filter:through}),options(boxView));
  assert.deepEqual(add.ids,['left','middle']);
  const subtract = editor.selectTilesetComponents(query({from:add.selection,region:marquee,operation:'subtract',filter:through}),options(boxView));
  assert.deepEqual(subtract.ids,left.ids);
  const inverted = editor.selectTilesetComponents(query({from:subtract.selection,operation:'invert'}));
  assert.deepEqual(inverted.ids,['middle','right']);
  const visibleInverted = editor.selectTilesetComponents(query({from:left,operation:'invert',filter:visible}),options(boxView));
  assert.deepEqual(visibleInverted.ids,['right']);
  for (const domain of ['edges','vertices']) {
    const result = editor.selectTilesetComponents(query({from:left,operation:'invert',convert:domain}));
    assert.equal(result.domain,domain);
    assert.equal(result.sourceDomain,'tiles');
    assert.deepEqual(result.selection,api.select(doc,{from:inverted.selection,convert:domain}));
    const native = editor.selectMeshTopology('wall',{domain:'faces',region:marquee,filter:through,convert:domain},options(boxView));
    assert.equal(native.ids.length,4);
    assert(native.ids.every(id=>id.includes('middle')));
  }
  assert.throws(()=>editor.selectTilesetComponents({...query({from:left,convert:'edges'}),edit:'reskin'}),/disabled/);
  editor.transformMeshTopology('wall',{selection:left,operation:{kind:'move',offset:[0,0,.08]}});
  assert.throws(()=>editor.selectTilesetComponents(query({from:left,operation:'invert'})),/same topology revision/);
});

test('through regions hit projected authored edges and vertices near a native pixel',()=>{
  const doc = api.create({id:'quad',vertices:[[-1,-1,-2],[1,-1,-2],[1,1,-2],[-1,1,-2]].map((position,i)=>({id:'v'+i,position})),
    faces:[{id:'panel',corners:[0,1,2,3].map(i=>({id:'c'+i,vertex:'v'+i}))}]});
  const mesh = api.toSceneMesh(doc), w=40, h=40;
  const frame = {w,h,passes:{sourceSurface:new Int32Array(w*h).fill(-1),sourceTriangle:new Int32Array(w*h),surfaceSources:[]}};
  const camera = {view:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],focal:8,ortho:true,clipNear:1,clipFar:8};
  const region = {type:'brush',points:[[12.5,12.5]],radius:.25};
  const evidence = api.captureVisibility(mesh,frame,camera,{participation:true,region});
  const pick = domain=>api.select(doc,{domain,region,filter:through},options(evidence)).ids;
  assert.deepEqual(pick('vertices'),['v3']);
  assert.deepEqual(pick('edges'),doc.edges.filter(edge=>edge.vertices.includes('v3')).map(edge=>edge.id).sort());
  assert.deepEqual(pick('faces'),['panel']);
});

test('CLI composes saved picks and exports native conversions from live and saved regions',t=>{
  const editor = draft(), cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-region-selection-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value)=>fs.writeFileSync(path.join(cwd,name+'.json'),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(cwd,name+'.json'),'utf8'));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  write('scene',editor.snapshot());
  write('view',view);
  write('left',query({ids:['left']}));
  write('add',query({operation:'add',region:marquee,filter:through}));
  write('convert',query({convert:'vertices'}));
  write('evidence',capture(editor,marquee));
  const select = (file,...args)=>run('tileset','select',file+'.json','--scene','scene.json',...args);
  select('left','--topology-out','left-pick.json');
  const live = select('add','--from','left-pick.json','--view','view.json','--topology-out','both.json');
  assert.deepEqual(live,select('add','--from','left-pick.json','--visibility','evidence.json'));
  assert.deepEqual(live.ids,['left','middle']);
  const vertices = select('convert','--from','both.json','--topology-out','corners.json');
  assert.equal(vertices.ids.length,8);
  assert.deepEqual(read('corners'),vertices.selection);
  write('native',{domain:'faces',region:marquee,filter:through,convert:'edges'});
  assert.equal(run('mesh-topology','select','scene.json','native.json','--object','wall','--view','view.json').ids.length,4);
});
