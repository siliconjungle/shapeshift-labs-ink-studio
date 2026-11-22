const { test } = require('node:test');
const assert = require('node:assert/strict');

test('coverage groups are keyed by object and material and use explicit palette slots', async () => {
  const { prepareCoverageVote } = await import('../src/webgl/coverage-vote.mjs');
  const world={ count:4, renderMetadata:{
    objectIds:Uint32Array.of(8,8,10,8), materialIds:Uint32Array.of(1,1,1,2),
    materials:[null,'enamel','copper']
  } };
  const { memberships, swatches }=prepareCoverageVote(world,{ramps:{enamel:[2,4],copper:[3]}},5);
  assert.deepEqual([...memberships],[1,1,1,1,2,1,3,2]);
  assert.deepEqual(swatches,[[2,4],[3]]);
  assert.throws(()=>prepareCoverageVote(world,{ramps:{enamel:[5]}},5),/palette indices/);
});

test('WebGL chooses the winner ramp at a solid seam before quantizing edge color',
  { skip:!process.env.INK_TEST_CHROME }, () => {
    const result = require('../cli/look-webgl.js')({}, () => {}, (kit, fixture, backend) => {
      const palette=[0x0d1b27,0x4588ae,0xd49b51,0x8e8b7f];
      const B=kit.makeBuilder(1,palette);
      B.disc(0,0,0,[0,0,1],.8,.025,B.P[1],3);
      B.describeSplats(0,1,{object:'tile',material:'enamel'});
      B.disc(.05,.03,.14,[0,0,1],.28,.025,B.P[2],3);
      B.describeSplats(1,2,{object:'riveted plate',material:'copper'});
      const world=B.finish({ radius:2,dither:0,cam:{target:[0,0,0],dist:4.5,yaw:0,pitch:0,ortho:true},
        look:{coverageVote:{ramps:{enamel:[1],copper:[2]}}} });
      const renderer=backend(101,83,{offscreen:true});
      const frame={width:101,height:83,colored:false,dither:0};
      const results=[];
      const bytes=()=>atob(renderer.image());
      const id=(image,i)=>image.charCodeAt(i)<<16|image.charCodeAt(i+1)<<8|image.charCodeAt(i+2);
      for(const dx of [-.019,0,.021]){
        frame.camera={...world.cam,target:[dx,0,0]};
        renderer.draw(world,{...frame,coverageVote:false});
        const original=bytes();
        renderer.draw(world,frame);
        const voted=bytes();
        let removed=0, illegal=0, modified=0;
        for(let i=0;i<original.length;i+=3){
          const a=id(original,i), b=id(voted,i);
          if(a===b)continue;
          modified++;
          if(a===palette[3])removed++;
          if(b!==palette[1]&&b!==palette[2])illegal++;
        }
        const center=(41*101+50)*3;
        results.push({removed,illegal,modified,unchangedCenter:id(original,center)===id(voted,center)});
      }
      renderer.close();
      return {results};
    }, {});
    assert(result.results.every(r=>r.illegal===0&&r.unchangedCenter),JSON.stringify(result.results));
    assert(result.results.every(r=>r.modified>0&&r.removed>0),JSON.stringify(result.results));
  });
