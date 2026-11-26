'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const atlas = [48,32], cli = path.join(__dirname,'../cli/ink-studio.js');
const groups = [{id:'panel-and-badge',islands:['badge','panel']}];
const request = (settings={})=>({operations:[{op:'pack-charts',ids:['anchor','panel','badge','trim'],
  atlas,pool:[0,0,32,24],gutter:1,groups,...settings}]});
const evidence = plan=>plan.report.operations[0].evidence;
const chartMap = plan=>new Map(evidence(plan).charts.map(row=>[row.id,row]));
const face = (id,vertices,rect,pin=false)=>({
  id,material:'metal',corners:[[rect[0],rect[3]],[rect[2],rect[3]],[rect[2],rect[1]],[rect[0],rect[1]]].map((p,i)=>{
    const uv = p.map((n,k)=>n/atlas[k]);
    return {id:id+'/'+i,vertex:vertices[i],uv,attributes:{'uv/1':uv},...(pin && i===0 && {uvPinned:true})};
  })
});

function fixture() {
  const vertices = [], faces = [];
  function add(id,index,rect,pin) {
    const ids = [[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>'v'+(index+x)+'/'+y);
    for (const [i,key] of ids.entries()) if (!vertices.some(row=>row.id===key))
      vertices.push({id:key,position:[index+Number(i===1||i===2),Number(i>1),0]});
    faces.push(face(id,ids,rect,pin));
  }
  add('panel',0,[6,21,13,27]);
  add('return',1,[13,21,20,27]);
  add('badge',4,[25,24,29,28]);
  add('trim',6,[37,18,42,22]);
  add('anchor',8,[0,0,6,6],true);
  add('unselected',10,[20,0,25,4]);
  return T.create({id:'pack-fixture',vertices,faces,uvBindings:{normal:1}});
}

const close = (a,b)=>assert(Math.abs(a-b)<1e-10,JSON.stringify({a,b}));
const noOverlap = (a,b,gutter=0)=>a[2]+gutter<=b[0] || b[2]+gutter<=a[0] || a[3]+gutter<=b[1] || b[3]+gutter<=a[1];

test('pack whole connected islands and authored chart groups by integer offsets without UV scaling',()=>{
  const doc = fixture();
  const selected = UV.select(doc,{domain:'faces',ids:['anchor','return','badge','trim']});
  const req = request({ids:undefined,selection:selected});
  const plan = UV.plan(doc,req);
  assert(plan.report.canCommit,JSON.stringify(plan.report.operations));
  assert.deepEqual(plan.document.vertices,doc.vertices);
  assert.deepEqual(UV.inspect(plan.document).islands.map(row=>[row.id,row.faces]),
    UV.inspect(doc).islands.map(row=>[row.id,row.faces]));
  assert.deepEqual(plan.report.seams,[]);
  const charts = chartMap(plan);
  assert.deepEqual(charts.get('panel').faces,['panel','return']);
  assert.deepEqual(charts.get('panel').translation,charts.get('badge').translation);
  assert(charts.get('panel').translation.some(Boolean));
  assert.equal(charts.get('anchor').status,'held');
  assert.deepEqual(charts.get('anchor').destination,[0,0,6,6]);
  assert(noOverlap(evidence(plan).groups[0].destination,charts.get('trim').destination,2));
  for (const row of charts.values()) {
    assert(row.translation.every(Number.isSafeInteger));
    if (row.status==='packed') {
      assert(row.destination[0]>=1 && row.destination[1]>=1);
      assert(row.destination[2]<=31 && row.destination[3]<=23);
      assert(noOverlap(row.destination,[0,0,6,6],2));
      assert(noOverlap(row.destination,[20,0,25,4],2));
    }
  }
  for (const {face,id,before,after} of plan.report.corners) {
    const row = [...charts.values()].find(row=>row.faces.includes(face));
    after.forEach((n,i)=>close((n-before[i])*atlas[i],row.translation[i]));
    const original = doc.faces.find(row=>row.id===face).corners.find(row=>row.id===id);
    const edited = plan.document.faces.find(row=>row.id===face).corners.find(row=>row.id===id);
    assert.deepEqual(edited.attributes,original.attributes);
  }
  assert.deepEqual(plan.document.faces.filter(row=>['anchor','unselected'].includes(row.id)),
    doc.faces.filter(row=>['anchor','unselected'].includes(row.id)));
  assert.deepEqual(T.edit(doc,plan.patch),plan.document);
  assert.deepEqual(UV.plan(doc,request({ids:['trim','badge','panel','anchor']})).document,plan.document);
  assert.deepEqual(UV.plan(plan.document,request()).patch,{});
  assert.throws(()=>UV.plan(plan.document,req),/mesh revision/);
});

test('report every oversize or obstructed chart and retain atomicity',()=>{
  const doc = fixture();
  const small = UV.plan(doc,request({pool:[30,0,10,8]}));
  assert(!small.report.canCommit);
  assert.deepEqual(evidence(small).unpacked,['badge','panel']);
  assert.equal(chartMap(small).get('trim').status,'packed');
  assert.deepEqual(small.report.operations[0].conflicts,[{
    code:'chart-exceeds-pool',islands:['badge','panel'],required:[25,9],group:'panel-and-badge'
  }]);
  assert.deepEqual(small.patch,{});
  assert.equal(small.document,doc);
  const blocked = UV.plan(doc,request({pool:[0,0,12,12]}));
  assert.deepEqual(evidence(blocked).unpacked,['badge','panel','trim']);
  assert.equal(chartMap(blocked).get('trim').reason,'chart-no-free-rectangle');
  const held = UV.plan(doc,{...request(),protect:{painted:[{id:'approved-badge',faces:['badge']}]}});
  assert(held.report.canCommit);
  assert.deepEqual(evidence(held).groups.map(row=>[row.id,row.status,row.translation]),[
    ['panel-and-badge','held',[0,0]]
  ]);
  assert(!held.report.corners.some(row=>['panel','return','badge'].includes(row.face)));
  assert.throws(()=>UV.plan(doc,request({ids:['trim']})),/selected UV islands/);
});

test('preserve an inferred seam when separately packed charts meet on the zero-gutter grid',()=>{
  const base = fixture();
  const doc = T.create({id:'touching-charts',uvBindings:base.uvBindings,
    vertices:base.vertices.filter(row=>Number(row.id.split('/')[0].slice(1))<=2),
    faces:[face('panel',['v0/0','v1/0','v1/1','v0/1'],[24,0,32,8]),face('return',['v1/0','v2/0','v2/1','v1/1'],[36,0,44,8])]});
  const set = 'normal', cut = UV.inspect(doc,set).edges.find(row=>row.kind==='seam').id;
  const plan = UV.plan(doc,{uvSet:set,...request({ids:['panel','return'],groups:[],gutter:0,pool:[0,0,16,8]})});
  assert(plan.report.canCommit);
  assert.deepEqual(evidence(plan).retainedCuts,[cut]);
  assert.equal(plan.report.islandsAfter,2);
  assert.deepEqual(plan.report.seams,[{id:cut,uvSeam:true}]);
  assert.equal(UV.inspect(plan.document).edges.find(row=>row.id===cut).authored,false);
  assert.equal(UV.inspect(plan.document,set).edges.find(row=>row.id===cut).authored,true);
  assert.deepEqual(plan.document.faces.map(row=>row.corners.map(c=>c.uv)),doc.faces.map(row=>row.corners.map(c=>c.uv)));
});

test('infer the scene atlas and preview, commit and undo through the existing edit paths',t=>{
  const document = fixture(), scene = {id:'pack-scene',style:'slate',solids:[],
    camera:{target:[5.5,.5,0],dist:20,projection:'orthographic'},
    tilesets:{metal:ink.createBlankTileset({width:atlas[0],height:atlas[1],background:'#4f7078'})},
    topologyMeshes:{workpiece:{document,materials:[{id:'metal',texture:{tileset:'metal'}}],
      bakes:[{id:'finish',material:'metal',maps:{roughness:.6}}]}}};
  const editor = ink.createSceneEditor(scene), start = editor.snapshot(), req = request({atlas:undefined});
  const plan = editor.planMeshUV('workpiece',req);
  assert(plan.report.canCommit);
  assert.deepEqual(evidence(plan).atlas,atlas);
  assert.deepEqual(editor.editMeshUV('workpiece',req).uv,plan.report);
  assert.deepEqual(editor.meshTopology('workpiece').bakes[0].invalidated.faces,['badge','panel','return','trim']);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),start);

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-uv-pack-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const write = (file,value)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(value));
  const args = [cli,'mesh-uv','edit','scene.json','request.json','--object','workpiece'];
  write('scene.json',scene);
  write('request.json',req);
  const preview = JSON.parse(execFileSync(process.execPath,args.concat('--preview','review'),{cwd,encoding:'utf8'}));
  assert.deepEqual(preview.operations,plan.report.operations);
  assert(fs.existsSync(path.join(cwd,'review/comparison.png')));
  const output = JSON.parse(execFileSync(process.execPath,args.concat('--out','packed.json'),{cwd,encoding:'utf8'}));
  assert.equal(output.outputRevision,plan.report.outputRevision);
  write('request.json',request({pool:[30,0,10,8]}));
  const rejected = spawnSync(process.execPath,args.concat('--out','blocked.json','--report','overflow.json'),{cwd,encoding:'utf8'});
  assert.equal(rejected.status,1,rejected.stderr);
  assert(!fs.existsSync(path.join(cwd,'blocked.json')));
  const receipt = JSON.parse(fs.readFileSync(path.join(cwd,'overflow.json'),'utf8'));
  assert.deepEqual(receipt.operations[0].evidence.unpacked,['badge','panel']);
});
