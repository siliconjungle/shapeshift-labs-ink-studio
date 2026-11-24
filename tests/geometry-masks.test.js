'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');

function coupon(roof = .58) {
  const points = [[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1],
    [-1,.4,-1],[1,.4,-1],[1,.4,1],[-1,.4,1],
    [-.9,roof,-.9],[.9,roof,-.9],[.9,roof,.9],[-.9,roof,.9]];
  const faces = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0],[8,9,10,11]];
  const uvs = faces.map((_f,i) => {
    const u = .04+(i%4)*.24, v = .05+Math.floor(i/4)*.44;
    return [[u,v],[u+.17,v],[u+.17,v+.28],[u,v+.28]];
  });
  return { name:'coupon',points,faces,uvs,normals:points.map(() => [1,0,0]) };
}

const options = { samples:16,cavityRadius:.5,exposureDistance:.9,thicknessScale:1 };
const names = ['slope','cavity','exposure','thickness','thickness-valid'];
function output(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-geometry-masks-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function bake(dir, name, model, geometryMasks, rebakeFrom) {
  const folder = path.join(dir,name);
  const {materialBake} = ink.exportGlb(model,{ out:path.join(dir,name+'.glb'),bakeDir:folder,
    textureSize:256,geometryMasks,rebakeFrom });
  const report = JSON.parse(fs.readFileSync(materialBake,'utf8')), row = report.meshes[0];
  function sample(channel, face, s = .5, t = .5) {
    const [a,b,,d] = model.uvs[face], u = a[0]+(b[0]-a[0])*s, v = a[1]+(d[1]-a[1])*t;
    const raster = PNG.raster(path.join(folder,row.masks[channel].file));
    return raster.data[(Math.floor(v*raster.h)*raster.w+Math.floor(u*raster.w))*4];
  }
  return { materialBake,report,row,sample };
}

test('one registered pass writes independent geometry masks with physical thickness and open-surface evidence',t => {
  const dir = output(t), mesh = coupon();
  const run = bake(dir,'first',mesh,options);
  assert.deepEqual(Object.keys(run.row.masks),names);
  assert.equal(run.sample('slope',1),0);
  assert.equal(run.sample('slope',2),255);
  assert(run.sample('cavity',1)>75);
  assert(run.sample('exposure',1)<44);
  assert.equal(run.sample('exposure',0),255);
  assert.equal(run.sample('thickness',1),102);
  assert.equal(run.sample('thickness-valid',1),255);
  assert.equal(run.sample('thickness',6),0);
  assert.equal(run.sample('thickness-valid',6),0);
  assert.deepEqual(run.row.geometryMasks.shells,{closed:1,open:1});
  assert.equal(run.row.geometryMasks.texels,run.row.chartReport.sampledTexels);
  assert.equal(run.row.geometryMasks.texels,run.row.chartReport.geometryMaskTexels);
  assert(run.row.geometryMasks.thickness.unknown>0);
  assert(run.row.mipmaps.levels.every(level => names.every(name=>level.masks[name])));
  const again = bake(dir,'again',mesh,options);
  assert.deepEqual(again.row.masks,run.row.masks);
  assert.deepEqual(again.row.geometryMasks,run.row.geometryMasks);
});

test('rebakes inherit geometry settings and invalidate nonlocal occlusion when a different chart moves',t => {
  const dir = output(t), first = bake(dir,'first',coupon(),options);
  const unchanged = bake(dir,'kept',coupon(),undefined,first.materialBake);
  assert.equal(unchanged.row.chartReport.geometryMaskTexels,0);
  assert.deepEqual(unchanged.row.masks,first.row.masks);
  const painted = coupon();
  painted.materials = [{color:[.22,.18,.38]}];
  const materialOnly = bake(dir,'painted',painted,undefined,first.materialBake);
  assert(materialOnly.row.chartReport.sampledTexels>0);
  assert.equal(materialOnly.row.chartReport.geometryMaskTexels,0);
  assert.deepEqual(materialOnly.row.masks,first.row.masks);
  const changed = bake(dir,'lifted',coupon(1.8),undefined,first.materialBake);
  assert.equal(changed.sample('cavity',1),0);
  assert.equal(changed.sample('exposure',1),255);
  assert.equal(changed.sample('thickness',1),102);
  assert.equal(changed.row.uvLayout,first.row.uvLayout);
  assert(changed.row.chartReport.geometryMaskTexels>0);
  assert.notEqual(changed.row.masks.exposure.sha256,first.row.masks.exposure.sha256);
  const off = bake(dir,'plain',coupon(),false,first.materialBake);
  assert.deepEqual(off.row.masks,{});
  assert.equal(off.row.geometryMasks,undefined);
  const on = bake(dir,'enabled',coupon(),options,off.materialBake);
  assert.deepEqual(on.row.masks,first.row.masks);
});

test('export-glb accepts a geometry settings file and guards existing material mask names',t => {
  const dir = output(t), mesh = coupon(), fixture = path.join(dir,'coupon.js'), settings = path.join(dir,'settings.json');
  fs.writeFileSync(fixture,'module.exports=()=>({id:"coupon",model:()=>('+JSON.stringify(mesh)+')});');
  fs.writeFileSync(settings,JSON.stringify(options));
  const target = path.join(dir,'bake');
  execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'export-glb',fixture,'--texture-size','256',
    '--out',path.join(dir,'fixture.glb'),'--bake-dir',target,'--geometry-masks',settings],{stdio:'pipe'});
  const asset = JSON.parse(fs.readFileSync(path.join(target,'material-bake.json'),'utf8'));
  assert.equal(asset.geometryMasks.samples,16);
  assert(asset.meshes[0].masks['thickness-valid']);
  mesh.materials=[{name:'authored',masks:{exposure:.4}}];
  assert.throws(() => bake(dir,'collision',mesh,true),/already authored: exposure/);
  assert.throws(() => ink.exportGlb(mesh,{out:path.join(dir,'no-atlas.glb'),geometryMasks:true}),/registered bake directory/);
});
