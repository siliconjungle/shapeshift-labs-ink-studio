const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const { KIT:K } = ink.load(), api = K.curve.retained;

const near=(a,b,eps=1e-10)=>assert(Math.abs(a-b)<=eps,`${a} versus ${b}`);
const samePoint=(a,b,eps)=>near(K.V.dist(a,b),0,eps);
const mkPoint=(id,position,options)=>({id,position,...options});
const span=(id,from,to)=>({id,from,to});
const create=(splines,attachments=[])=>api.create({format:api.format,version:1,id:'fixture',splines,attachments});
const anchor=(id,spline,segment,t)=>({id,spline,segment,t});

function fixture() {
  return create([{id:'guide',points:[
    mkPoint('a',[-2,-.5,0],{outHandle:[.9,.8,-.4],radius:.04,tilt:.3}),
    mkPoint('b',[.2,.8,.6],{inHandle:[-1.2,.37,.3],outHandle:[.84,-.6,.2],radius:.18,tilt:1.8}),
    mkPoint('c',[2,-.4,-.3],{inHandle:[-.43,.2,.7],radius:.1,tilt:-.2})
  ],segments:[span('reach','a','b'),span('fall','b','c')]}],[
    anchor('sensor','guide','reach',.17),anchor('seam','guide','reach',.41),anchor('bond','guide','reach',.73),
    anchor('existing-start','guide','fall',0),anchor('end','guide','fall',1)
  ]);
}

test('a cubic split keeps its leading ID and exact shape and radius/tilt at the retained anchors',()=>{
  const source=fixture(), profile=api.compile(source), before=api.inspect(source);
  const split={op:'split',segment:'reach',t:.41,point:'mid',rightSegment:'right',
    newSpline:'branch',newStart:'branch-start'};
  const plan=api.plan(source,{revision:before.revision,operations:[split]});
  assert.deepEqual(plan.document.splines.map(row=>row.segments.map(x=>x.id)),[['reach'],['right','fall']]);
  assert.deepEqual(plan.document.attachments.map(({id,spline,segment})=>[id,spline,segment]),[
    ['sensor','guide','reach'],['seam','guide','reach'],['bond','branch','right'],
    ['existing-start','branch','fall'],['end','branch','fall']
  ]);
  assert.equal(plan.document.attachments[1].t,1);
  for (const row of plan.report.attachments) {
    near(row.positionDelta,0);
    near(row.before.radius,row.after.radius);
    near(row.before.tilt,row.after.tilt);
  }
  for (let i=0;i<=100;i++) {
    const t=i/100, original=profile.anchor('reach',t);
    const transferred=plan.mapStation('guide',original.station);
    samePoint(original.p,transferred.p);
  }
  assert.deepEqual(api.inspect(fixture()),before);
  assert.throws(()=>api.plan(plan.document,{revision:before.revision,operations:[split]}),/different revision/);
});

test('reversed joins retain segment IDs and report the welded point while routing both input paths',()=>{
  const source=create([
    {id:'west',points:[mkPoint('a',[0,0,0],{inHandle:[0,-.4,0],tilt:.7}),mkPoint('b',[-2,0,0],{outHandle:[.5,0,0]})],
      segments:[span('west-segment','a','b')]},
    {id:'east',points:[mkPoint('c',[2,1,0]),mkPoint('d',[0,0,0],{inHandle:[.25,.5,0],tilt:.7})],
      segments:[span('east-segment','c','d')]}
  ],[anchor('a-attach','west','west-segment',.24),anchor('b-attach','east','east-segment',.37)]);
  const plan=api.plan(source,{operations:[{op:'join',first:'west',second:'east',firstEnd:0,secondEnd:1}]});
  const [row]=plan.report.operations;
  assert(row.reverseFirst && row.reverseSecond);
  assert.equal(row.weld.removedPoint,'d');
  assert.deepEqual(plan.document.splines[0].points.map(row=>row.id),['b','a','c']);
  assert.deepEqual(plan.document.splines[0].segments,[span('west-segment','b','a'),span('east-segment','a','c')]);
  assert.deepEqual(plan.document.splines[0].points[1].outHandle,[.25,.5,0]);
  for (const {before,after,positionDelta} of plan.report.attachments) {
    near(after.t,1-before.t);
    near(positionDelta,0);
    near(after.tilt,-before.tilt);
  }
  assert.equal(plan.mapStation('east',0).spline,'west');
  assert.equal(plan.mapStation('east',0).station,1);
});

test('loop cuts, gap bridges and point edits work as atomic operations with frame and radius consumers',()=>{
  const loop=create([{id:'loop',closed:true,points:[
    mkPoint('i',[0,0,0]),mkPoint('j',[1,0,0]),mkPoint('k',[1,1,0]),mkPoint('l',[0,1,0])
  ],segments:[span('bottom','i','j'),span('right','j','k'),span('top','k','l'),span('left','l','i')]}],
  [anchor('back','loop','right',1),anchor('next','loop','top',0)]);
  const cut=api.plan(loop,{operations:[{op:'cut',point:'k',newStart:'other-end'}]});
  assert.equal(api.compile(cut.document).closed,false);
  assert.deepEqual(cut.document.splines[0].segments.map(row=>row.id),['top','left','bottom','right']);
  assert.deepEqual(cut.report.attachments.map(r=>r.after.station),[1,0]);
  assert.deepEqual(cut.report.attachments.map(r=>r.positionDelta),[0,0]);

  const source=fixture(), split=api.plan(source,{operations:[{op:'cut',point:'b',newSpline:'east',newStart:'east-start'}]});
  const moved=api.plan(split.document,{operations:[{op:'set-point',point:'east-start',position:[.45,1,.6]}]});
  assert.throws(()=>api.plan(moved.document,{operations:[{op:'join',first:'guide',second:'east'}]}),/tolerance/);
  const joined=api.plan(moved.document,{operations:[{op:'join',first:'guide',second:'east',firstEnd:1,secondEnd:0,
    tolerance:.4,bridge:'brace'}]});
  assert.deepEqual(joined.document.splines[0].segments.map(row=>row.id),['reach','brace','fall']);
  assert(joined.report.attachments.every(row=>row.positionDelta<1e-10));

  const flat=api.plan(source,{operations:[{op:'set-point',point:'b',tilt:0},{op:'set-point',point:'a',tilt:0}]}).document;
  const changed=api.plan(flat,{operations:[{op:'set-point',point:'b',radius:.36,tilt:Math.PI/2},
    {op:'set-point',point:'a',tilt:Math.PI/2}]});
  const rail=K.curve.create(changed.document), unrolled=api.compile(flat), at=rail.anchor('reach',.5);
  near(rail.radiusAt(at.station*rail.length),at.radius);
  near(K.V.dot(rail.frame(at.station*rail.length).N,unrolled.frame(at.station*unrolled.length).B),1);
  assert.deepEqual(rail.at(0),unrolled.at(0));
  assert(rail.curvature(rail.length*.25).value>0);
  assert.equal(rail.closest(at.p).parameter<.5,true);
  const recipe=document=>({ format:K.curveSplats.format,version:1,id:'test',strands:[{
    source:{kind:'retained-spline',document},section:'elliptical',aspect:.3,edge:'hard'
  }]});
  const a=K.curveSplats.world(recipe(flat)), b=K.curveSplats.world(recipe(changed.document));
  assert.equal(a.count,b.count);
  assert.notDeepEqual(a.data,b.data);
  assert.throws(()=>api.plan(flat,{operations:[{op:'set-point',point:'b',outHandle:[0,0,1]},
    {op:'set-point',point:'bad',radius:.2}]}),/unknown control point/);
  assert.deepEqual(flat.splines[0].points[1].outHandle,[.84,-.6,.2]);
});

test('the CLI previews and saves the same revision and can sample a selected path',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-retained-splines-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const at=name=>path.join(root,name), cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'curve',...args],{encoding:'utf8'}));
  const source=fixture(), request={revision:api.revision(source),operations:[
    {op:'split',segment:'reach',t:.41,point:'mid',rightSegment:'right',newSpline:'branch',newStart:'branch-start'}
  ]};
  fs.writeFileSync(at('source.json'),JSON.stringify(source));
  fs.writeFileSync(at('request.json'),JSON.stringify(request));
  const inspect=run('topology','inspect',at('source.json'));
  assert.equal(inspect.revision,request.revision);
  const receipt=run('topology','edit',at('source.json'),at('request.json'));
  assert(!fs.existsSync(at('edited.json')));
  assert.deepEqual(run('topology','edit',at('source.json'),at('request.json'),
    '--out',at('edited.json'),'--report',at('report.json')),receipt);
  assert.deepEqual(JSON.parse(fs.readFileSync(at('report.json'))),receipt);
  assert.equal(run(at('edited.json'),'--spline','branch','--station','0').anchor.segment,'right');
});
