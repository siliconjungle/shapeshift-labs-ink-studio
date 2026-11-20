const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, TexturedSurface } = require('..').load();
const P=K.procedural, { shell, stack }=P.fabrication;
const plane={sample:([u,v])=>({ p:[2*u-1,0,2*v-1], n:[0,1,0] })};
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} differs from ${b}`);

function topology(solid) {
  const {points,triangles}=solid.indexed(), uses=new Map(), fans=new Map();
  for(let i=0;i<triangles.length;i+=3) {
    const ids=Array.from(triangles.subarray(i,i+3));
    assert.equal(new Set(ids).size,3);
    for(let j=0;j<3;j++) {
      const a=ids[j],b=ids[(j+1)%3],c=ids[(j+2)%3], key=a<b?a+'/'+b:b+'/'+a;
      const counts=uses.get(key)??[0,0];
      counts[Number(a>b)]++;
      uses.set(key,counts);
      if(!fans.has(a))fans.set(a,new Map());
      fans.get(a).set(b,c);
    }
  }
  for (const count of uses.values()) assert.deepEqual(count,[1,1]);
  for(const links of fans.values()) {
    let node=links.keys().next().value, count=0;
    while (links.has(node)) {
      const next=links.get(node);
      links.delete(node);
      node=next;
      count++;
    }
    assert.ok(count>=3);
    assert.equal(links.size,0);
  }
  return points.length/3-uses.size+triangles.length/3;
}

test('thickness and field-level ribs move the physical surfaces with outward winding',()=>{
  const part=shell({carrier:plane,field:u=>u,thickness:value=>.2+.2*value,segments:[8,6],
    ribs:[{level:.5,width:.14,height:.12}]});
  assert.equal(topology(part),2);
  const {points}=part.indexed();
  const section=[];
  for(let i=0;i<points.length;i+=3) if(points[i]===0&&points[i+2]===0)section.push(points[i+1]);
  near(Math.min(...section),-.15);
  near(Math.max(...section),.27);
  assert.equal(K.mesh.info(part.mesh()).open,0);
  assert.match(K.mesh.toObj(part.mesh()),/usemtl wall/);
  for(const name of ['outer','inner','wall']) TexturedSurface.validate(part.surface(name));
  for(const [name,sign] of [['outer',1],['inner',-1]]) {
    const {points}=part.surface(name);
    const [a,b,c]=[0,3,6].map(i=>Array.from(points.subarray(i,i+3)));
    assert.ok(K.V.cross(K.V.sub(b,a),K.V.sub(c,a))[1]*sign>0);
  }
});

test('a cut creates a through-hole with a closed wall and keeps both scalar sides selectable',()=>{
  const field=(u,v)=>Math.hypot(2*u-1,2*v-1)-.42;
  const config={carrier:plane,field,segments:[31,30],thickness:.18};
  const ring=shell({...config,cut:{level:0,keep:'above'}});
  assert.equal(topology(ring),0);
  const wall=ring.surface('wall').points;
  assert.ok(Array.from({length:wall.length/3},(_,i)=>Math.hypot(wall[i*3],wall[i*3+2]))
    .some(r=>nearRadius(r,.42)));
  const core=shell({...config,cut:{level:0}});
  assert.equal(topology(core),2);
  near(core.bounds.max[0],.42,.005);
  const empty=shell({...config,cut:{level:-2}});
  assert.equal(empty.bounds,null);
  assert.equal(empty.indexed().triangles.length,0);
});
const nearRadius=(a,b)=>Math.abs(a-b)<.003;

test('periodic carrier welds the seam while preserving local UVs on both sides',()=>{
  const carrier=P.surface.cylinder({id:'tube',origin:[0,0,0],height:1.7,radius:1});
  const config={carrier,thickness:.13,segments:[24,12]};
  const cylinder=shell(config), wall=cylinder.surface('wall');
  assert.equal(topology(cylinder),0);
  assert.equal(cylinder.parts.wall.count,4*24);
  for(let i=1;i<wall.points.length;i+=3)
    assert.ok(Math.min(Math.abs(wall.points[i]),Math.abs(wall.points[i]-1.7))<1e-6);
  const outer=cylinder.surface('outer');
  assert.ok(outer.uvs.includes(1));
  const punched=shell({...config,field:(u,v)=>Math.cos(2*Math.PI*u)*Math.sin(Math.PI*v),cut:{level:.58}});
  assert.equal(topology(punched),-2);
  assert.ok(punched.parts.wall.count>cylinder.parts.wall.count);
});

test('stack converts an authored profile and offsets into separate closed solids',()=>{
  const shape=P.construct.profile([
    [[-1,-1],[1,-1],[1,1],[-1,1]],
    [[-.28,-.24],[.30,-.24],[.30,.25],[-.28,.25]]
  ]);
  const input={field:shape.sd,bounds:{min:[-1.4,-1.4],max:[1.4,1.4]},segments:[40,39],layers:[
    {id:'base',low:.2,high:.4,cut:{level:.13}},
    {id:'cap',low:.4,high:.49,cut:{level:-.1}},
    {id:'inlay',low:.5,high:.68,cut:{level:.06},field:(x,z)=>x*x+z*z}
  ]};
  const sections=stack(input);
  assert.deepEqual(sections.map(s=>s.id),['base','cap','inlay']);
  assert.deepEqual(sections.map(topology),[0,0,2]);
  near(sections[0].bounds.max[0],1.13,.005);
  near(sections[1].bounds.max[0],.90,.006);
  near(sections[1].bounds.min[1],.4);
  near(sections[1].bounds.max[1],.49);
  assert.throws(()=>stack({...input,layers:[input.layers[0],{...input.layers[1],low:.39}]}),/non-overlapping/);
});

test('exact-level saddles and boundary vertices do not weld separate pieces at a point',()=>{
  const part=shell({carrier:plane,segments:[4,4],field:(u,v)=>(u-.5)*(v-.5),cut:{level:0}});
  assert.equal(topology(part),4);
});

test('invalid dimensions, fields, orientation or folded offsets are caught during fabrication',()=>{
  assert.throws(()=>shell({carrier:plane,thickness:()=>0}),/positive and finite/);
  assert.throws(()=>shell({carrier:plane,field:()=>NaN}),/field samples/);
  assert.throws(()=>shell({carrier:{...plane,periodicU:true}}),/agree at the seam/);
  assert.throws(()=>shell({carrier:P.surface.mobius()}),/orientable seam/);
  const tube=P.surface.cylinder({id:'tube',origin:[0,0,0],height:1.7,radius:1});
  assert.throws(()=>shell({carrier:tube,thickness:3}),/fold the offset geometry/);
});
