const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..');

function fixture({KIT:K,makeBuilder}) {
  const P=K.procedural, box=(x,y,z,hx,hy,hz)=> {
    const a=Math.abs(x)-hx,b=Math.abs(y)-hy,c=Math.abs(z)-hz;
    return Math.hypot(Math.max(0,a),Math.max(0,b),Math.max(0,c))+Math.min(0,Math.max(a,b,c));
  };
  const bricks=P.sparseBricks.create({cell:.14,brickSize:5,base:(x,y,z)=>box(x-.034,y+.033,z,1.87,1.23,.41)});
  const options={bricks,bounds:{min:[-2.1,-1.58,-.63],max:[2.1,1.47,.68]},objectId:'gate',
    materials:[{id:'earth',color:0x866358},{id:'trim',color:0x548f7b},{id:'cut',color:0xdca072}],
    materialAt:(x,y)=>y>.84?'trim':'earth'};
  const cut={operation:'subtract',bounds:{min:[-.79,-.79,-.68],max:[.79,.79,.68]},
    sdf:(x,y,z)=>box(x,y,z,.49,.52,1.04),material:'cut'};
  const surface=P.brickMeshes.create(options);
  const world=makeBuilder(9,[0x121c2c,0x866358,0x548f7b,0xdca072]).finish({brickMeshes:[surface],
    cam:{target:[0,0,0],dist:6.7,yaw:0,pitch:0,ortho:true},dither:0,
    fog:{c:0,start:1,max:0}});
  return {world,surface,options,cut,P};
}

function welded(snapshot) {
  const edges=new Map();
  for(const chunk of snapshot.chunks) for(let i=0;i<chunk.indices.length;i+=3) {
    const vertices=chunk.indices.slice(i,i+3).map(index=>chunk.positions.slice(index*3,index*3+3).join(','));
    for(let j=0;j<3;j++) {
      const id=[vertices[j],vertices[(j+1)%3]].sort().join(':');
      edges.set(id,(edges.get(id)??0)+1);
    }
  }
  return edges;
}

test('local CSG edits reuse other chunks and agree with a full fresh bake across seams',()=>{
  const {surface,options,cut,P}=fixture(ink.load()), before=surface.current();
  const after=surface.edit(cut), full=P.brickMeshes.create({...options,bricks:after.bricks}).current();
  assert(after.work.rebuilt.length<after.chunks.length);
  assert(after.work.reused.length>after.work.changed.length);
  assert(after.work.samples<full.work.samples);
  assert(after.bricks.distance(0,0,0)>0);
  assert(before.bricks.distance(0,0,0)<0);
  for(const [i,chunk] of after.chunks.entries()) {
    if(!after.work.rebuilt.includes(chunk.key))assert.equal(chunk,before.chunks[i]);
    for(const key of ['positions','indices','faceMaterials']) assert.deepEqual(chunk[key],full.chunks[i][key]);
  }
  for(const snapshot of [before,after]) {
    const unwelded=[...welded(snapshot).values()].filter(value=>value!==2);
    assert.deepEqual(unwelded,[]);
  }
  const slots=new Set(after.chunks.flatMap(chunk=>chunk.faceMaterials));
  assert.deepEqual([...slots].sort(),[0,1,2]);
  const corners=after.chunks.flatMap(chunk=>chunk.positions.reduce((rows,value,i)=>i%3===0 ?
    rows.concat([chunk.positions.slice(i,i+3)]) : rows, []));
  assert(corners.some(([x,y,z])=>Math.abs(x-1.904)<.014&&Math.abs(y-1.197)<.014&&Math.abs(z-.41)<.014));
});

test('paint and field swaps publish atomically, including material-only updates and failed edits',()=>{
  const {surface,options}=fixture(ink.load()), before=surface.current();
  const paint={bounds:{min:[.63,-.49,.22],max:[1.1,.45,.55]},material:'cut'};
  const painted=surface.edit(paint);
  assert(painted.work.changed.length>0);
  assert.equal(painted.work.triangles,before.work.triangles);
  for(const [i,chunk] of painted.chunks.entries()) assert.deepEqual(chunk.positions,before.chunks[i].positions);
  const medium=surface.edit({bounds:paint.bounds,medium:'water'});
  assert.deepEqual(medium.work.rebuilt,[]);
  assert(medium.chunks.every((chunk,i)=>chunk===painted.chunks[i]));
  assert.throws(()=>surface.edit({...paint,material:'unregistered'}),/Unknown/);
  assert.equal(surface.current(),medium);
  const other=ink.load().KIT.procedural.sparseBricks.create({cell:.14,brickSize:5});
  assert.throws(()=>surface.update(other),/original sparse field/);
  assert.equal(surface.current(),medium);
  const redo=surface.update(options.bricks);
  assert.deepEqual(redo.chunks.map(row=>row.faceMaterials),before.chunks.map(row=>row.faceMaterials));
  const added=surface.edit({operation:'union',material:'cut',
    bounds:{min:[1.47,-.36,-.36],max:[2.1,.36,.36]},
    sdf:(x,y,z)=>Math.hypot(x-1.83,y,z)-.22});
  assert(added.bricks.distance(1.98,0,0)<0 && before.bricks.distance(1.98,0,0)>0);
  assert(added.work.changed.length>0&&added.work.rebuilt.length<added.chunks.length);
});

test('headless scene draws the updated opening, retains material IDs, and can trace a selected close-up',()=>{
  const {world,surface,cut}=fixture(ink.load());
  const w=116,h=80,opts={w,h,px:1,raw:true,passes:['opaque-surface']};
  const p=40*w+58;
  const before=ink.render(world,opts).passes;
  surface.edit(cut);
  const after=ink.render(world,opts).passes;
  const trace=ink.render(world,{...opts,sdfAssist:{steps:224,rules:[{
    select:{object:'gate'},bounds:{min:[-1.3,-1.2,-.6],max:[.6,1.3,.6]}
  }]}}).passes;
  assert.equal(before.surfaceKind[p],1);
  assert.equal(after.depth[p],Infinity);
  assert.equal(trace.depth[p],Infinity);
  assert(after.materialId.includes(after.materials.indexOf('cut')));
  assert(trace.materialId.includes(trace.materials.indexOf('cut')));
  assert.deepEqual(trace.materials,before.materials);
  assert(trace.surfaceKind.includes(1)&&trace.surfaceKind.includes(2));
  const traced=trace.surfaceKind.indexOf(2), hit=ink.pickSurface(trace,traced%w,Math.floor(traced/w));
  assert.equal(hit.object,'gate');
  assert(['earth','trim','cut'].includes(hit.material));
  assert(Math.abs(hit.geometricNormal[2])>.9);
});

test('native WebGL draws the same editable brick handles and reflects a local hole in picking',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const result=require('../cli/look-webgl.js')({},fixture,(kit,make,backend)=>{
      const {world,surface,cut}=make(kit), view=backend(116,80,{raw:true});
      const spots={opening:[58,40],wall:[83,39]}, ray={origin:[0,0,6.5],direction:[0,0,-1]};
      try {
        view.draw(world);
        const before=view.sample(spots), hit=view.pick(world,ray).solid;
        surface.edit(cut);
        view.draw(world);
        return {before,after:view.sample(spots),hit,next:view.pick(world,ray).solid};
      } finally {view.close();}
    });
    assert.deepEqual(result.before.opening,[134,99,88]);
    assert.deepEqual(result.after.opening,[18,28,44]);
    assert.deepEqual(result.before.wall,result.after.wall);
    assert.equal(result.hit.target.object,'gate');
    assert.equal(result.next,null);
  });
