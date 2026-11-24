const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const { KIT: K, makeBuilder } = ink.load();

const rose={id:'rose',color:'#d64c68'}, gold={id:'gold',color:'#fbd28a'};
function tip(angle=0) {
  return {format:'ink-studio/pixel-brush',version:1,width:3,height:2,anchor:[1,1],
    palette:[rose,gold],slots:[null,0,null,1,null,0],
    settings:{size:[3,2],angle,swatch:{mode:'original'}}};
}
const mark=(space,at,pixelSize,angle=0,extra={})=>({kind:'retained',tip:tip(angle),space,at,pixelSize,...extra});
const chart={origin:[-1,-1,.2],u:[2,0,0],v:[.5,2,0]};
const valueOf=swatch=>({swatch:swatch.id,color:swatch.color});

test('a retained chart brush honors its transparent anchor, signed angle and rest tangent',()=>{
  const project=(brush,other=[])=>K.procedural.surfaceState.projection({charts:{face:{...chart,
    stamps:[{channel:'pigment',brush},...other]}}});
  const uv=project(mark('uv',[.5,.5],[.1,.1]));
  const read=(u,v)=>uv([chart.origin[0]+2*u+.5*v,chart.origin[1]+2*v,.2],[0,0,1]).values.pigment;
  assert.deepEqual(read(.4,.5),valueOf(gold));
  assert.deepEqual(read(.5,.6),valueOf(rose));
  assert.equal(read(.5,.5),null);
  const brush=mark('rest',[0,0,.2],[.2,.2],90,{direction:[0,1,.3]});
  const rest=project(brush,[{channel:'roughness',value:.25,brush,strength:.5}]);
  assert.deepEqual(rest([0,.2,.2],[0,0,1]).values.pigment,valueOf(rose));
  assert.deepEqual(rest([0,.2,.2],[0,0,1]).values.roughness,{value:.25,coverage:.5});
  assert.equal(rest([.2,.2,.2],[0,0,1]).values.pigment,null);
  const cleared=project(brush,[{channel:'pigment',mode:'clear',brush,window:{min:[0,.5],max:[1,1]}}]);
  assert.equal(cleared([0,.2,.2],[0,0,1]).values.pigment,null);
  assert.throws(()=>project({...brush,at:[0,0,.6]}),/anchor must lie on the chart/);
  assert.throws(()=>project({...brush,direction:[0,0,1]}),/tangent component/);
});

function plate(stamps=[]) {
  return {id:'paint-plate',style:'slate',
    camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'},
    solids:[{id:'plate',kind:'box',at:[0,0,0],half:[1,1,.2],res:.055,mat:'stone',
      surfaceState:{charts:{face:{...chart,origin:[-1,-1,.2],v:[0,2,0],depth:.05,stamps}}}}]};
}

test('native splat carriers retain brush pigment through repeated deformation',()=>{
  const brush=mark('rest',[0,0,.2],[.18,.18]);
  const world=K.diorama.build(plate([{channel:'pigment',brush}]));
  const wanted=parseInt(rose.color.slice(1),16)+1;
  const rows=Array.from({length:world.count},(_,i)=>i);
  const decorated=rows.filter(i=>world.materialAlbedo?.[i]===wanted);
  assert.ok(decorated.length>4);
  const before=world.data.slice(), rest=K.deform.rest(world,rows);
  const map=([x,y,z])=>[x+.35,y,z+.25*y*y];
  K.deform.apply(world,rows,rest,map);
  for (const i of decorated) {
    const p=i*16;
    assert.ok(Math.abs(world.data[p]-before[p]-.35)<1e-6);
    assert.equal(world.materialAlbedo[i],wanted);
  }
  const after=world.data.slice();
  K.deform.apply(world,rows,rest,map);
  assert.ok(after.every((value,i)=>value===world.data[i]));
});

function meshFixture({KIT:kit,makeBuilder:builder}) {
  const object='placket', material='coat', positions=[-1,-1,0,1,-1,0,-1,1,0,1,1,0];
  const mesh=kit.sceneMeshes.create({id:object,positions,uvs:[0,1,1,1,0,0,1,0],
    indices:[0,1,2,1,3,2],materials:[{id:material,color:0x415766}]});
  const world=builder(0,[0,0xffffff]).finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true},
    fog:{c:0,start:1,max:0},dither:0});
  world.meshes=[mesh];
  const raw={format:'ink-studio/pixel-brush',version:1,width:3,height:2,anchor:[1,1],
    palette:[{id:'rose',color:'#d64c68'},{id:'gold',color:'#fbd28a'}],slots:[null,0,null,1,null,0],
    settings:{size:[3,2],angle:0,swatch:{mode:'original'}}};
  const stamp=kit.surfaceDecals.fromBrush({id:'patch',tip:raw,anchor:{object,material,uv:[.5,.5]},pixelSize:[.13,.13]});
  const document={format:'ink-studio/surface-decals',version:1,decals:[stamp]};
  const binding=kit.surfaceDecals.bind(world,document,{receivers:[{object,representation:'mesh',mesh}]});
  return {world,mesh,binding,document,object,stamp};
}

const settings={w:100,h:80,px:1,raw:true};
const rgbaAt=(image,i)=>Array.from(image.rgb.subarray(i*3,i*3+3));
const colorCount=(image,color)=>Array.from({length:image.w*image.h},(_,i)=>i)
  .filter(i=>rgbaAt(image,i).every((n,k)=>n===color[k])).length;

test('UV brush triangles are clipped to the receiver and keep their barycentrics through mesh skinning',()=>{
  const {world,mesh,binding,document,object,stamp}=meshFixture(ink.load());
  assert.deepEqual(K.surfaceDecals.create(JSON.parse(JSON.stringify(document))),binding.document);
  const original=binding.sample(0);
  assert.ok(original.report[0].triangles>2);
  const layer=original.layers[0], vertices=layer.vertices.slice(), originalFrame=ink.render(world,settings);
  const pink=[214,76,104], ochre=[251,210,138];
  assert.ok(colorCount(originalFrame,pink)>20 && colorCount(originalFrame,ochre)>10);
  assert.deepEqual(rgbaAt(originalFrame,40*100+50),[65,87,102]);
  // Two independent bones stretch and tilt the receiver in one pose.
  const skin=K.sceneMeshes.skin(mesh,[0,1,0,1]);
  skin.pose([1,0,0,0,1,0,0,0,1,-.1,0,0, 1,0,0,0,1,0,0,0,1,.4,0,.3]);
  assert.equal(binding.sample(.5).layers[0],layer);
  assert.deepEqual(layer.vertices.filter((_,i)=>i%5>=3),vertices.filter((_,i)=>i%5>=3));
  assert.ok(layer.vertices.some((n,i)=>i%5===2&&n>vertices[i]+.08));
  const posedFrame=ink.render(world,settings);
  assert.ok(colorCount(posedFrame,pink)>20 && colorCount(posedFrame,ochre)>10);
  binding.invalidate(object,undefined,'mesh');
  assert.equal(binding.sample(.5).layers[0],layer);
  const edge=K.surfaceDecals.fromBrush({id:'edge',tip:tip(),anchor:{object,uv:[0,.35]},pixelSize:[.1,.1]});
  assert.ok(edge.anchor.uv.min[0]<0);
  const clipped=K.sceneMeshes.clipUV(mesh,edge.anchor.uv);
  assert.ok(clipped.points.length>0&&clipped.points.every((n,i)=>i%3!==0||n>=-1));
  assert.ok(stamp.image.pixels.some((n,i)=>i%4===3&&n===0));
});

test('a rest-projected brush keeps its tip offset when the SDF is updated',()=>{
  const object='plate', world=makeBuilder(0,[0,0xffffff]).finish();
  const stamp=K.surfaceDecals.fromBrush({id:'badge',tip:tip(),anchor:{object,at:[0,0,.2],normal:[0,0,1]},
    pixelSize:[.12,.12],grid:[4,5]});
  assert.ok(Math.abs(stamp.anchor.at[1]-.06)<1e-10);
  let field={distance:(_x,_y,z)=>z-.2};
  const binding=K.surfaceDecals.bind(world,{format:K.surfaceDecals.format,version:1,decals:[stamp]},
    {receivers:[{object,representation:'sdf',field:{current:()=>field}}]});
  const original=binding.sample(0).layers[0], depth=original.vertices[2];
  field={distance:(_x,_y,z)=>z-.25};
  const next=binding.sample(1);
  assert.equal(next.layers[0],original);
  assert.ok(Math.abs(next.layers[0].vertices[2]-depth-.05)<1e-5);
});

test('WebGL draws the retained UV colors again after a skinned pose', {skip:!process.env.INK_TEST_CHROME},()=>{
  const result=require('../cli/look-webgl.js')({},meshFixture,(kit,build,backend,{w,h})=>{
    const {world,mesh}=build(kit);
    const view=backend(w,h,{raw:true,outline:false,dither:0});
    try {
      view.draw(world,{time:0});
      const baseline=view.image();
      const skin=kit.KIT.sceneMeshes.skin(mesh,[0,1,0,1]);
      skin.pose([1,0,0,0,1,0,0,0,1,-.1,0,0, 1,0,0,0,1,0,0,0,1,.4,0,.3]);
      view.draw(world,{time:.5});
      const posed=view.image();
      return {baseline,posed};
    } finally {view.close();}
  },settings);
  assert.notEqual(result.baseline,result.posed);
  for (const encoded of Object.values({baseline:result.baseline,posed:result.posed})) {
    const rgb=Buffer.from(encoded,'base64');
    assert.ok(rgb.some((n,i)=>i%3===0&&n===214&&rgb[i+1]===76&&rgb[i+2]===104));
    assert.ok(rgb.some((n,i)=>i%3===0&&n===251&&rgb[i+1]===210&&rgb[i+2]===138));
  }
});

test('a captured pixel tip commits through the CLI as one retained, editable source stamp',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-retained-brush-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const cli=(...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],{
    cwd:path.resolve(__dirname,'..'),encoding:'utf8',stdio:['ignore','pipe','pipe']
  });
  const doc={format:'ink-studio/pixel-art',version:2,width:48,height:32,pixelAspect:[1,1],
    palette:{rose:rose.color,gold:gold.color},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:file('plate.json'),frame:'front',object:'plate'}],
    destinations:[{id:'pigment',kind:'surface-channel',binding:'plate',chart:'face',channel:'pigment'}]};
  save('design.json',doc);
  save('plate.json',plate());
  const observed=JSON.parse(cli('targets',file('design.json'),'--scene',file('plate.json'),'--destination','pigment'));
  const brushTip=tip(), captured=K.pixelBrushes.capture({width:3,height:2,rect:[0,0,3,2],anchor:[1,1],
    read:(x,y)=>brushTip.palette[brushTip.slots[y*3+x]]??null});
  const edit={id:'badge',frame:'front',destination:'pigment',revision:observed.documentRevision,
    sourceRevision:observed.sourceRevision,operation:{stamp:{brush:{...mark('uv',[.5,.5],[.1,.1]),tip:captured}}}};
  save('edit.json',edit);
  const applied=JSON.parse(cli('edit',file('design.json'),file('edit.json'),'--scene',file('plate.json'),'--out',file('painted.json')));
  assert.equal(applied.status,'applied');
  assert.deepEqual(read('painted.json').solids[0].surfaceState.charts.face.stamps[0],
    {...edit.operation.stamp,channel:'pigment'});
  save('plate.json',read('painted.json'));
  const sample=uv=>JSON.parse(cli('sample',file('design.json'),'--uv',uv,'--mode','source',
    '--destination','pigment','--scene',file('plate.json'))).value;
  assert.deepEqual(sample('.4,.5'),valueOf(gold));
  assert.equal(sample('.5,.5'),null);
  const bad=structuredClone(edit);
  delete bad.sourceRevision;
  bad.operation.stamp.brush.tip.palette[0].color='#ff0000';
  save('wrong-swatch.json',bad);
  assert.throws(()=>cli('edit',file('design.json'),file('wrong-swatch.json'),'--scene',file('plate.json'),
    '--out',file('wrong.json')), /swatch from the pixel document palette/);
});
