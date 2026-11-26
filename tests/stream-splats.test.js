'use strict';

const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const {chunkId}=require('../cli/gaussian-pack-files.js');

test('indexed chunk edits keep moved addresses and avoid reading unrelated payloads',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-stream-edits-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=name=>path.join(root,name), read=name=>JSON.parse(fs.readFileSync(file(name)));
  const json=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const run=(...args)=>spawnSync(process.execPath,[cli,'stream-splats',...args],{encoding:'utf8'});
  const good=(...args)=>{
    const result=run(...args);
    assert.equal(result.status,0,result.stderr);
    return result.stdout;
  };
  const {writeGaussianPack}=await import('../scripts/pack-gaussian-chunks.mjs');
  const world={count:6,data:new Float32Array(96),bg:[19,30,42],radius:8,cam:{target:[.2,.2,.2],yaw:.3,pitch:.2,dist:7}};
  [.11,.18,1.2,1.33,3.11,3.28].forEach((x,i)=>world.data.set([x,.2,.2,1,.012,0,0,0x0102ff,.023,0,.013],16*i));
  const source=await writeGaussianPack(world,root,{cellSize:1,voxelSizes:[.4,.2,0],encoding:'irc1'});
  delete source.packing;
  json('manifest.json',source);
  const main=file('manifest.json'), patch=file('patch.json'), summary=file('receipt.json');
  good('index',main,'--cell-size','1','--voxels','.4,.2,0','--encoding','irc1');
  const a=chunkId('main',[0,0,0]), b=chunkId('main',[1,0,0]), untouched=source.chunks.find(row=>row.cell[0]===3);
  const unavailable=untouched.levels.at(-1).file;
  fs.renameSync(file(unavailable),file('parked.irc'));
  const id=a+'/1', removed=a+'/0';
  function make(edits, seed=read('manifest.json')){
    json('patch.json',{format:'ink-studio/stream-splat-patch',version:1,asset:seed.edit.asset,epoch:seed.epoch,edits});
  }
  const initial=read('manifest.json');
  make([{id,position:[1.6,.2,.2],orientation:[0,0,Math.SQRT1_2,Math.SQRT1_2]},{id:removed,remove:true}]);
  good('edit',main,patch,'--previous',file('previous.json'),'--out',summary);
  const result=read('receipt.json'), newManifest=read('manifest.json');
  assert.deepEqual(result.read.chunks,[a,b]);
  assert.deepEqual(result.untouched,[untouched.id]);
  assert.equal(result.rebuilt.find(row=>row.id===a).status,'emptied');
  assert.deepEqual(newManifest.edit.redirects,[[id,b]]);
  assert.deepEqual(newManifest.edit.retired,[removed]);
  assert.deepEqual(newManifest.chunks.find(row=>row.id===untouched.id),untouched);
  assert.deepEqual(read('previous.json'),initial);

  const rejected=run('edit',main,patch);
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/current epoch/);
  assert.deepEqual(read('manifest.json'),newManifest);
  make([{id,pigment:0x83cfab}]);
  good('edit',main,patch,'--out',summary);
  assert.deepEqual(read('receipt.json').read.chunks,[b]);
  const {chunk}=JSON.parse(good('inspect',main,'--chunk',b,'--start','2','--limit','1'));
  assert.equal(chunk.rows[0].id,id);
  assert.equal(chunk.rows[0].pigment,0x83cfab);
  assert.equal(chunk.rows[0].locked,true);
  assert(Math.abs(chunk.rows[0].covariance[0]-.023)<.001);
  make([{id:removed,pigment:0xff00ff}]);
  assert.match(run('edit',main,patch).stderr,/retired/);
  fs.renameSync(file('parked.irc'),file(unavailable));
});
