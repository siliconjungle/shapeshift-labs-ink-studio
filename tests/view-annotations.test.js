const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = studio.load(), K = kit.KIT;

function fixture({ makeBuilder }) {
  const world = makeBuilder(1,[0x121c28]).finish({ radius: 3, cam:{ target:[0,0,0],dist:5,yaw:0,pitch:0,ortho:true } });
  const annotations = {
    density:[{ distance:0,maxLabels:5 },{ distance:8,maxLabels:1 }],
    legends:[{ id:'key', at:[8,8], title:'KEY', items:[{ text:'STATION',color:'#74dab1',symbol:'dot' }] }],
    labels:[
      { id:'main', text:'MAIN', at:[0,0,0], priority:10, offset:[14,-14], leader:'elbow', style:{ background:'#1b9675' } },
      { id:'second', text:'ALT', at:[-.65,-.65,0], offset:[-13,13], style:{ background:'#802a6b' } }
    ]
  };
  world.look = { composite:{ world:{ resolution:[45,30] },layers:[{annotations}] } };
  return world;
}

test('priority and stable IDs keep crowded labels apart and leave room for a fixed legend', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs');
  const world = fixture(kit), width=280, height=170;
  const settings = {
    legends:[{ id:'legend', corner:'top-right', items:[{ text:'STATIONS',color:'#86dbff' }] }],
    labels:Array.from({ length:7 },(_,i) => ({ id:'tag-'+i,text:'TAG '+i,at:[0,0,0],leader:'elbow',priority:i===3?2:0 })),
    density:[{ distance:0,maxLabels:7,gap:5 },{ distance:8,maxLabels:2,gap:10 }]
  };
  const layout = (input,dist) => K.annotations.layout(K.annotations.prepare(input),{
    width,height,world,camera:makeCamera(world,{ camera:{dist} },width,height)
  });
  const near = layout(settings,5), far = layout(settings,9);
  assert.equal(near.labels[0].id,'tag-3');
  assert(near.labels.length >= 4);
  assert.deepEqual(far.labels.map(label=>label.id),['tag-3','tag-0']);
  assert.deepEqual(near.legends,far.legends);
  assert.equal(far.distance,9);
  assert(far.skipped.some(item=>item.reason==='density'));
  assert.deepEqual(layout({ ...settings, labels:[...settings.labels].reverse() },5).labels,near.labels);
  for (const [i,{box,route,point}] of near.labels.entries()) {
    assert.deepEqual(route[0],point);
    assert.equal(route.length,3);
    for (const other of [...near.labels.slice(0,i),...near.legends]) {
      const [x,y,w,h] = other.box;
      assert(box[0]+box[2]+5<=x || x+w+5<=box[0] || box[1]+box[3]+5<=y || y+h+5<=box[1]);
    }
  }
});

test('view range, clipping, screen anchors and reserved rectangles have distinct outcomes', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs');
  const width=160,height=100,world=fixture(kit),camera=makeCamera(world,{ camera:{ortho:false} },width,height);
  const settings=K.annotations.prepare({ density:[{distance:0,maxLabels:1}], avoid:[[0,0,12,100]],
    labels:[
      { id:'range',text:'RANGE',at:[0,0,0],maxDistance:3 },
      { id:'behind',text:'BEHIND',at:[0,0,6] },
      { id:'offscreen',text:'OFF',at:[30,0,0] },
      { id:'screen',text:'SCREEN',at:[55,55],space:'screen',leader:false },
      { id:'world',text:'WORLD',at:[0,0,0] },
      { id:'missing',text:'MISSING',at:{ mark:'unavailable' } }
    ]
  });
  const layout=K.annotations.layout(settings,{width,height,world,camera});
  assert.deepEqual(layout.labels.map(row=>row.id),['screen','world']);
  assert.deepEqual(Object.fromEntries(layout.skipped.map(row=>[row.id,row.reason])),
    { range:'distance', behind:'clipped', offscreen:'offscreen', missing:'unresolved' });
  const crowded = K.annotations.layout(K.annotations.prepare({ avoid:[[0,0,width,height]],labels:[{id:'full',text:'FULL',at:[0,0,0]}] }),
    {width,height,camera,world});
  assert.deepEqual(crowded.skipped,[{ id:'full',reason:'collision' }]);
});

test('named annotations resolve moving dataset marks, simulation sockets and retained splats', async () => {
  const { makeCamera } = await import('../src/webgl/view.mjs');
  const source = { id:'labels-moving', camera:{ target:[0,0,0], dist:5, yaw:0, pitch:0 },
    dataInputs:{ rows:{ kind:'table', columns:{ at:{type:'vec3',units:'world'} },data:[{at:[0,0,0]}] } },
    dataMarks:{ marks:{ source:{ dataset:'rows' },channels:{ position:{column:'at'},motion:[.3,0,0] } } }
  };
  const world=K.diorama.build(source), settings=K.annotations.prepare({ labels:[
    { id:'a',text:'READING',at:{mark:'marks/row/0'} },
    { id:'b',text:'SPLAT',at:{splat:0,offset:[-.4,-.2,0]} }
  ] });
  const width=200,height=140,camera=makeCamera(world,{},width,height);
  world.anim.update(0,0);
  const a=K.annotations.layout(settings,{width,height,camera,world});
  world.anim.update(.05,1);
  const b=K.annotations.layout(settings,{width,height,camera,world,time:1});
  assert.equal(a.labels.length,2);
  assert.equal(b.labels.length,2);
  assert(b.labels.every(row=>row.point[0]>a.labels.find(other=>other.id===row.id).point[0]));
  const marker = { id:'beacon', position:[1,.4,0], sockets:{ antenna:[0,.5,0] } };
  const run=K.world.runtime.create({ entities:{ beacon:marker } });
  const view=K.world.visual(kit,run.view(),run.query());
  assert.deepEqual(K.annotations.anchor({entity:'beacon',socket:'antenna',offset:[0,0,.2]},{ world:view,time:0 }),[1,.9,.2]);
});

test('the annotation schema rejects ambiguous inputs and invalid density bands', () => {
  assert.throws(()=>K.annotations.prepare({labels:[{id:'x',text:'X',at:{part:0,entity:'x'}}]}),/one source/);
  assert.throws(()=>K.annotations.prepare({density:[{distance:1,maxLabels:5}]}),/begin at zero/);
  assert.throws(()=>K.annotations.prepare({density:[{distance:0,maxLabels:1},{distance:0,maxLabels:2}]}),/strictly increasing/);
  assert.throws(()=>K.annotations.prepare({legends:[{id:'x',at:[2,3],corner:'top-left',items:[{text:'X'}]}]}),/position or corner/);
});

test('the CLI renders serialized legends and camera-dependent labels through the normal view', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-view-labels-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const world=fixture(kit), source=path.join(dir,'source.json'), output=path.join(dir,'frame.png');
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const { ortho, ...camera }=world.cam;
  fs.writeFileSync(source,JSON.stringify({id:'labels-cli',camera:{...camera,projection:'orthographic'}, solids:[],
    finish:{look:world.look} }));
  const render = zoom => {
    execFileSync(process.execPath,[cli,'render',source,'--zoom',String(zoom),'--raw','--w','180','--h','120','--out',output],{stdio:'pipe'});
    return fs.readFileSync(output);
  };
  assert(!render(1).equals(render(.5)));
});

test('CPU and WebGL share label layout and fixed legends in mixed resolution and graph passes', { skip:!process.env.INK_TEST_CHROME }, () => {
  const width=180,height=120;
  const result=runWebGL({},fixture,(kit,fixture,backend)=>{
    const world=fixture(kit), draw=backend(180,120,{raw:true,offscreen:true});
    try {
      draw.draw(world,{camera:{dist:5}});
      const near=draw.image();
      draw.draw(world,{camera:{dist:10}});
      const far=draw.image();
      world.look.renderGraph={passes:[{id:'labels',type:'composite',layer:world.look.composite.layers[0]}]};
      draw.draw(world,{camera:{dist:5},composite:{world:{resolution:[45,30]},layers:[]}});
      return { near,far,graph:draw.image() };
    } finally { draw.close(); }
  });
  const world=fixture(kit), render=(dist,options={})=>studio.render(world,{w:width,h:height,raw:true,dist,...options}).rgb;
  const near=render(5), far=render(10);
  const read=kind=>Buffer.from(result[kind],'base64');
  const same=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<=1);
  assert(same(near,read('near')));
  assert(same(far,read('far')));
  assert(!Buffer.from(near).equals(Buffer.from(far)));
  world.look.renderGraph={passes:[{id:'labels',type:'composite',layer:world.look.composite.layers[0]}]};
  assert(same(render(5,{composite:{world:{resolution:[45,30]},layers:[]}}),read('graph')));
});
