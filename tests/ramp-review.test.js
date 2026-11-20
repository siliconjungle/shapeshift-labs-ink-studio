const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { KIT:K, makeBuilder, makeSculpt, ColorSpace } = ink.load();

const palette = [0x111b29,0x272c42,0x59617a,0xb7bccd];
const review = K.palette.reviewRamp;
const options = {w:120,h:64,px:1,ortho:true,dither:0};
const flags = (report,kind) => report.flags.filter(row=>row.kind===kind);

test('ramp review reports uneven steps, reversals, missing midtones and resolved collapses', () => {
  const report=review({stops:['#151925','#333640','#292c39','#e2cdb6'],
    resolved:[null,'#303030','#303030','#e2cdb6']});
  assert.equal(report.direction,'ascending');
  assert.deepEqual(flags(report,'reversal').map(row=>row.indices),[[1,2]]);
  assert.deepEqual(flags(report,'uneven-step').map(row=>row.indices),[[0,1],[2,3]]);
  const [gap]=flags(report,'missing-midtones');
  assert.deepEqual(gap.indices,[1,3]);
  assert(gap.midpoint>gap.lightness[0] && gap.midpoint<gap.lightness[1]);
  assert.deepEqual(flags(report,'resolved-collapse'),[{kind:'resolved-collapse',indices:[1,2],color:'#303030',authoredDuplicate:false}]);
  assert.equal(report.steps[1].resolvedDelta,0);
  assert.equal(report.stops[0].resolvedLightness,null);
});

test('spacing follows authored positions and accepts naturally descending ramps', () => {
  const gray=[153,119,85,26];
  const lightness=gray.map(byte=>ColorSpace.toOKLab(Array(3).fill(byte/255))[0]);
  const positions=lightness.map(n=>(n-lightness[0])/(lightness.at(-1)-lightness[0]));
  const stops=gray.map((n,i)=>[positions[i],Array(3).fill(n/255)]);
  const report=review({stops,maxGap:1});
  assert.equal(report.direction,'descending');
  assert.deepEqual(report.flags,[]);
  assert(report.steps.every(step=>step.deviation<1e-12));
  const flat=review({stops:['#333333','#333333'],resolved:['#222222','#222222']});
  assert.equal(flat.direction,'flat');
  assert.equal(flags(flat,'duplicate-stop').length,1);
  assert.equal(flags(flat,'resolved-collapse')[0].authoredDuplicate,true);
  assert.throws(()=>review({stops:[0,1],positions:[.5,.5]}),/positions/);
  assert.throws(()=>review({stops,positions}),/position, color/);
});

function world() {
  const b=makeBuilder(32,palette), s=K.sculpt(makeSculpt(b));
  for (const [i,x] of [[1,-1.2],[2,0],[3,1.2]]) {
    s.box([x,0,0],[.48,.57,.12],{r:[i],em:true,materialId:'panel'},{res:.05,rd:.035,objectId:'stop-'+i});
  }
  s.bake();
  return b.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0},dither:0,paletteRoles:{stone:[1,2,3]},
    look:{splatCoverage:'continuous',paletteRemap:{rules:[
      {from:'stone.1',to:'#6e7b84'},{from:'stone.2',to:'#6e7b84'}
    ]}}});
}

test('automatic shot review resolves ordered scene slots through the actual indexed grade', () => {
  const scene=world();
  for (const view of [options,{...options,colored:true}]) {
    const report=ink.reviewRampShot(scene,{...view,role:'stone'});
    assert.equal(report.shot.method,'scene-palette');
    assert.deepEqual(report.shot.samples.map(row=>row.slot),[1,2,3]);
    assert.deepEqual(report.stops.map(row=>row.resolved),['#272c42','#6e7b84','#6e7b84']);
    assert(report.shot.samples[2].visiblePixels>10);
    assert.deepEqual(flags(report,'resolved-collapse').map(row=>row.indices),[[1,2]]);
  }
  const ungraded=ink.reviewRampShot(scene,{...options,role:'stone',paletteRemap:false});
  assert.deepEqual(flags(ungraded,'resolved-collapse'),[]);
});

test('pixel probes measure the final export after a scoped palette stage', () => {
  const scene=world();
  scene.look.coverageAware=true;
  scene.look.renderStages=[{stage:'palette',select:{material:'panel'},palette:{palette:['#926f64']}}];
  const frame=ink.render(scene,{...options,passes:['objectId']});
  const pixel = label => {
    const id=frame.passes.objects.indexOf(label), p=frame.passes.objectId.indexOf(id);
    assert(id>0 && p>=0);
    return [p%frame.w,Math.floor(p/frame.w)];
  };
  const pixels=[null,pixel('stop-2'),pixel('stop-3')];
  const report=ink.reviewRampShot(scene,{...options,role:'stone',pixels});
  assert.equal(report.shot.method,'export-pixels');
  assert.deepEqual(report.shot.samples.map(row=>row.pixel),pixels);
  assert.deepEqual(report.stops.map(row=>row.resolved),[null,'#926f64','#926f64']);
  assert.deepEqual(flags(report,'resolved-collapse').map(row=>row.indices),[[1,2]]);
  assert.equal(ink.reviewRampShot(scene,{...options,role:'stone'}).shot.method,'unavailable');
  assert.throws(()=>ink.reviewRampShot(scene,{...options,role:'stone',pixels:[null,[0,0],[999,0]]}),/outside/);
});

test('the CLI reviews ramp files and scene roles at the requested art resolution', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-ramp-review-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js'), file=path.join(dir,'ramp.json');
  const source=path.resolve(__dirname,'../examples/palette-remap.json');
  const outfile=path.join(dir,'reports','shot.json');
  const run = (...args)=>execFileSync(process.execPath,[cli,'palette','ramp-review',...args],{encoding:'utf8'});
  fs.writeFileSync(file,'{"stops":["#151925","#333640","#292c39","#e2cdb6"]}');
  assert.equal(flags(JSON.parse(run(file)),'reversal').length,1);
  run('--scene',source,'--role','stone','--w','96','--h','60','--px','2','--t','.75','--out',outfile);
  const {shot,stops}=JSON.parse(fs.readFileSync(outfile,'utf8'));
  assert.deepEqual([shot.width,shot.height,shot.time,shot.role,shot.method],[48,30,.75,'stone','scene-palette']);
  assert.equal(stops[0].resolved,'#16152e');
});
