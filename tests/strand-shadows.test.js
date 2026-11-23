const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const {KIT:K,makeBuilder}=ink.load();

const palette=[0x121c2a,0xeeeeee,0xedaf7f];
const image={w:120,h:88,px:1,raw:true,edges:false,renderStats:true};
const sun={direction:[1,0,1],ambient:.16,intensity:1,mapSize:96,bias:.002,filter:0};
const receive = (B,x,z) => {
  const first=B.count();
  B.disc(x,0,z,[0,0,1],1.15,.005,B.P[1],2.6,{nd:true});
  B.describeAlbedo(first,B.count(),'#eeeeee');
};
const finish = (B,x=0,z=0) => B.finish({id:'strand-shadow-test',radius:6,dither:0,
  cam:{target:[x,0,z],dist:7,yaw:0,pitch:0,ortho:true},fog:{c:0,start:1,max:0},liveSun:sun});
const red = (frame,x=60,y=44) => frame.rgb[(y*120+x)*3];

function layered({layers=3,receiver=0,transmittance=.6,splits=24,budget}={}) {
  const B=makeBuilder(2,palette);
  receive(B,receiver,receiver);
  for (const [i,z] of [.5,1,1.5].slice(0,layers).entries()) {
    K.curveSplats.draw(B,Array.from({length:splits+1},(_,j)=>[z,-1+j*2/splits,z]),{
      object:'fibre-'+i,edge:'hard',width:.16,opacity:.88,color:'#edaf7f',
      shadow:{cast:true,transmittance}
    });
  }
  return ink.render(finish(B,receiver,receiver),{...image,liveSun:{strandShadows:budget}});
}

test('thin fibre light transmission multiplies with depth and ignores subdivision joins',()=>{
  const clear=layered({layers:0}), one=layered({layers:1}), two=layered({layers:2}), three=layered();
  const base=238*sun.ambient, direct=red(clear)-base;
  for (const [i,frame] of [one,two,three].entries()) {
    assert(Math.abs(red(frame)-(base+direct*.6**(i+1)))<2);
    assert.equal(frame.renderStats.strandShadows.peakLayers,i+1);
  }
  const inBetween=layered({receiver:.76});
  assert(Math.abs(red(inBetween)-(base+direct*.6**2))<2);
  assert.equal(red(layered({splits:1})),red(three));
  const bounded=layered({budget:{maxLayers:2}});
  assert.equal(red(bounded),red(three));
  assert.equal(bounded.renderStats.strandShadows.peakLayers,2);
  assert(bounded.renderStats.strandShadows.compactedLayers>0);
  assert.equal(red(layered({transmittance:1})),red(clear));
  assert(Math.abs(red(layered({transmittance:0}))-base)<2);
});

function groupedWorld({edge='hard',wide=false,pose=false}={}) {
  const B=makeBuilder(5,palette);
  receive(B,0,0);
  const source={kind:'textile',plan:{threads:[-1,0,1].map((side,i)=>({id:'fibre-'+i,
    path:{points:Array.from({length:33},(_,j)=>[.73+side*(wide ? .32 : .009),-1+2*j/32,.73])}
  }))}};
  const style={object:'bundle',material:'hemp',target:{part:'rope'},width:.086,edge,opacity:.81,
    color:'#edaf7f',shadow:{cast:true,group:{samples:6,maxError:3},transmittance:.45}};
  const binding=pose && K.curveSplats.bind(B,source,({points})=>points.map(([x,y,z])=>[x+.25,y,z]),style);
  if (!pose) K.curveSplats.draw(B,source,style);
  const world=finish(B);
  if (binding) binding.pose(world);
  return world;
}

test('strand shadow targets use light-space proxies while color keeps all strands and wide groups retain detail',()=>{
  const world=groupedWorld(), saved=world.data.slice();
  const full=ink.render(world,image);
  const reduced=ink.render(world,{...image,liveSun:{strandShadows:{maxSpans:6}}});
  assert.deepEqual(world.data,saved);
  const clear=ink.render(world,{...image,liveSun:{shadows:false}});
  const counters=reduced.renderStats.strandShadows;
  assert.equal(full.renderStats.curveSegments,reduced.renderStats.curveSegments);
  assert.equal(counters.detailSpans,96);
  assert.equal(counters.submittedSpans,6);
  assert.equal(counters.grouped,1);
  assert.equal(counters.overTarget,0);
  assert(counters.rayTests<full.renderStats.strandShadows.rayTests/4);
  assert(red(reduced)<red(clear)-20);
  for (const extras of [{wide:true},{edge:'beta'},{pose:true}]) {
    const frame=ink.render(groupedWorld(extras),{...image,liveSun:{strandShadows:{maxSpans:6}}});
    assert.equal(frame.renderStats.strandShadows.submittedSpans,extras.wide ? 96 : 6,JSON.stringify(extras));
  }
  const masked=ink.render(world,{...image,liveSun:{strandShadows:{maxSpans:6}},
    shadowArt:{cast:{exclude:[{surface:'fibre-1'}]}}});
  assert.equal(masked.renderStats.strandShadows.grouped,0);
  assert.equal(masked.renderStats.strandShadows.overTarget,58);
  const provenance=ink.load().SplatProvenance;
  const {cam,radius,dither,fog,liveSun}=world, prefix=provenance.subset(world,[0]);
  const joined=provenance.join([prefix,world],{cam,radius,dither,fog,liveSun});
  const joinedFrame=ink.render(joined,{...image,liveSun:{strandShadows:{maxSpans:6}}});
  assert.deepEqual(joinedFrame.renderStats.strandShadows,counters);
  const partial=provenance.subset(world,Array.from({length:world.count},(_,i)=>i).filter(i=>i!==1));
  const partialFrame=ink.render(partial,{...image,liveSun:{strandShadows:{maxSpans:6}}});
  assert.equal(partialFrame.renderStats.strandShadows.submittedSpans,95);
});

test('a card handoff and camera scale leave the light-space strand budget unchanged',()=>{
  const world=groupedWorld(), api=K.sprite.reconstruction;
  const {atlas}=ink.bakeCurves(world,{object:'bundle',part:'rope',directions:1,ribbon:false});
  assert.equal(atlas.metadata.curveBake.sourceSpans,96);
  api.bindParts(world,[{object:'bundle',material:'hemp',part:'rope',representation:'curves',
    sprite:{asset:api.asset({atlas}),at:atlas.metadata.pivot,lighting:false}}]);
  const settings={...image,liveSun:{strandShadows:{maxSpans:6}},curveLod:false};
  const detail=ink.render(world,{...settings,spriteReconstruction:'geometry'});
  const cards=ink.render(world,{...settings,spriteReconstruction:'sprite'});
  const zoom=ink.render(world,{...settings,spriteReconstruction:'sprite',dist:12});
  assert.equal(cards.renderStats.curveSegments,0);
  assert.equal(detail.renderStats.curveSegments,96);
  assert.equal(red(cards),red(detail));
  assert.deepEqual(cards.renderStats.strandShadows,detail.renderStats.strandShadows);
  assert.deepEqual(zoom.renderStats.strandShadows,detail.renderStats.strandShadows);
});
