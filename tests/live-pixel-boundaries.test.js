const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');

test('live boundaries group selected splats across materials and validate their pixel budget', () => {
  const {makeBuilder,KIT:{livePixelBoundaries:api}}=ink.load();
  const b=makeBuilder(8,[0x111824,0x65a6ad,0xf9d977]);
  for (const [i,object,part,material] of [[0,'helmet','visor','paint'],[1,'helmet','visor','trim'],
    [2,'helmet','shell','trim'],[3,'shoulder','shell','trim']]) {
    b.dab(i,0,0,[0,0,1],[1,0,0],.2,.2,.04,b.P[1],1);
    b.describeSplats(i,i+1,{object,material,target:{part}});
  }
  const plan=api.prepare({features:[{id:'visor',select:{object:'helmet',part:'visor'}}],bounds:[2,3,40,31]});
  const rows=api.memberships(b.finish({}),plan);
  assert.deepEqual(Array.from(rows.groups),[1,1,-2,-3]);
  assert.deepEqual(Array.from(rows.selected),[2]);
  assert.deepEqual(api.region(plan,80,60),[2,26,40,31]);
  assert.throws(()=>api.region(plan,200,400),/at most/);
  assert.throws(()=>api.prepare({features:[{id:'rim',select:{object:'a'}},{id:'rim',select:{object:'b'}}]}),/distinct/);
});

function fixture({makeBuilder,KIT}) {
  const B=makeBuilder(1,[0x0a1119,0x314453,0x70c4c9,0xfac976]);
  const dab=(at,extent,index,object,part)=>{
    const start=B.count();
    B.dab(...at,[0,0,1],[1,0,0],...extent,.02,B.P[index],1);
    B.describeSplats(start,start+1,{object,material:part,target:{part}});
    B.describeFootprint(start,start+1,{shape:'square',softness:0});
    return start;
  };
  dab([0,0,-.25],[1.05,.72],1,'wall','recess');
  const moving=dab([-.3,.05,.44],[.48,.53],2,'mechanism','visor');
  const trim=dab([-.3,.48,.46],[.48,.10],3,'mechanism','visor');
  const world=B.finish({radius:4,cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true,fov:.56},
    fog:{start:1,max:0},look:{pixel:1}});
  function pose(x,z=.44) {
    world.data[moving*16]=world.data[trim*16]=x;
    world.data[moving*16+2]=z;
    world.data[trim*16+2]=z+.02;
  }
  return {world,pose,w:80,h:64};
}

test('WebGL live boundary history changes ambiguous ownership, accepts a real reveal and resets at cuts',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const result=require('../cli/look-webgl')({hardware:true},fixture,(kit,build,backend)=>{
      const {world,pose,w,h}=build(kit);
      const r=backend(w,h,{offscreen:true,colored:false,dither:0,outline:false,damp:false});
      const native=backend(w,h,{offscreen:true,colored:false,dither:0,outline:false,damp:false});
      const bounds=[4,6,w-8,h-12], features=[{id:'visor',select:{object:'mechanism',part:'visor'}}];
      let report, depth;
      const draw=(time,x,z,extra={})=>{
        pose(x,z);
        r.draw(world,{time,changedRows:[0],livePixelBoundaries:{features,bounds,spatial:0,temporal:1.4},
          livePixelBoundaryFrame:value=>{report=value;},hybridDepthFrame:value=>{depth=value.depth;},...extra});
        native.draw(world,{time,changedRows:[0],colored:extra.colored??false,protectedPixels:extra.protectedPixels});
        const a=atob(r.image()), b=atob(native.image()), differences=[];
        for (let p=0;p<w*h;p++) if (a.slice(3*p,3*p+3)!==b.slice(3*p,3*p+3)) differences.push(p);
        const outside=differences.filter(p=>p%w<4||p%w>=w-4||Math.floor(p/w)<6||Math.floor(p/w)>=h-6);
        return {counts:report.counts,reset:report.reset,skipped:report.skipped,difference:differences.length,outside:outside.length,
          center:r.sample({c:[40,32]}).c,depth:depth[32*w+40],feature:report.resolvedFeature?.[32*w+40]};
      };
      try {
        const first=draw(0,0);
        let temporal=0,different=0,outside=0;
        for (let i=1;i<=24;i++) {
          const r=draw(i/60,.043*Math.sin(i*.7)-.017);
          temporal+=r.counts.temporal;
          different+=r.difference;
          outside+=r.outside;
        }
        const behind=draw(.425,0,-.65);
        const cut=draw(.44,0,.44,{resetLivePixelBoundaries:true});
        const rewind=draw(.1,0);
        const colored=draw(.12,.01,.44,{colored:true});
        const pin=draw(.14,0,.44,{protectedPixels:{marks:[{id:'etched-pixel',at:[0,0,1],color:3}]}});
        const unmatched=draw(.16,0,.44,{livePixelBoundaries:{features:[{id:'missing',select:{part:'missing'}}]}});
        return {first,behind,cut,rewind,colored,pin,unmatched,temporal,different,outside};
      } finally {r.close();native.close();}
    });
    assert.equal(result.first.reset,'first');
    assert.equal(result.first.counts.temporal,0);
    assert.equal(result.cut.reset,'cut');
    assert.equal(result.rewind.reset,'time');
    assert(result.temporal>0,JSON.stringify(result));
    assert(result.different>0);
    assert.equal(result.outside,0);
    assert.equal(result.colored.outside,0,JSON.stringify(result.colored));
    assert.equal(result.unmatched.skipped,'no-matching-features');
    assert.equal(result.unmatched.difference,0);
    assert.deepEqual(result.pin.center,[250,201,118]);
    assert.equal(result.first.feature,1);
    assert.equal(result.behind.feature,0);
    assert.deepEqual(result.first.center,[112,196,201]);
    assert.deepEqual(result.behind.center,[49,68,83]);
    assert(result.behind.depth>result.first.depth+.4,JSON.stringify(result));
    assert.deepEqual(result.cut.center,result.first.center);
  });
