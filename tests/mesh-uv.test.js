const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const studio=require('..');
const {KIT:K,makeBuilder,makeSculpt}=studio.load();
const {inspect,area2}=require('../src/mesh-uv.js');

function islandFixture() {
  const points=[],triangles=[],uvs=[];
  for (const [i,uv] of [
    [[.05,.10],[.35,.10],[.05,.30]],
    [[.19,.13],[.45,.13],[.19,.27]],
    [[.455,.13],[.70,.13],[.455,.27]],
    [[.76,.52],[.98,.52],[.76,.56]]
  ].entries()) {
    points.push([i*3,0,0],[i*3+1,0,0],[i*3,1,0]);
    triangles.push([i*3,i*3+1,i*3+2]);
    uvs.push(uv);
  }
  return {points,triangles,uvs};
}

test('inspection separates overlap from edge contact and measures stretch, density and sub-texel gutters',()=>{
  const data=islandFixture();
  const report=inspect(data,{size:[100,100],padding:4});
  assert.equal(report.summary.charts,4);
  assert.equal(report.overlap.count,1);
  assert.deepEqual(report.overlap.pairs,[[0,1]]);
  assert.equal(report.faces[0].stretch,1.5);
  assert.equal(report.faces[0].density,Math.sqrt(600));
  assert.equal(report.charts[1].neighborPadding,0);
  assert.equal(report.charts[2].neighborPadding,.5);
  assert.equal(report.charts[3].borderPadding,2);
  assert.equal(inspect(data,{padding:4,maxChecks:1}).padding.complete,false);
  const unit={points:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],triangles:[[0,1,2],[0,2,3]],
    uvs:[[[.1,.1],[.9,.1],[.9,.9]],[[.1,.1],[.9,.9],[.1,.9]]]};
  assert.equal(inspect(unit).overlap.count,0);
  assert.equal(inspect(unit).summary.charts,1);
  assert.throws(()=>inspect(data,{protectedSeams:[[0,11]]}),/not a triangle edge/);
});

function sheetFixture() {
  const points=[],triangles=[],uvs=[],protectedSeams=[];
  const n=6, stride=n+1;
  for (let side=0;side<2;side++) {
    const base=points.length;
    for(let y=0;y<=n;y++)for(let x=0;x<=n;x++) points.push([side+x/n,y/n,.015*Math.sin(x*Math.PI/n)*Math.sin(y*Math.PI/n)]);
    const uv=i=>{
      const p=i-base;
      return [.03+.50*side+p%stride*.43/n,.07+Math.floor(p/stride)*.62/n];
    };
    for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
      const a=base+y*stride+x,b=a+1,d=a+stride,c=d+1;
      for(const face of [[a,b,c],[a,c,d]]) {
        triangles.push(face);
        uvs.push(face.map(uv));
      }
    }
    if (!side) for(let y=0;y<n;y++)protectedSeams.push([y*stride+3,(y+1)*stride+3]);
  }
  return {points,triangles,uvs,protectedSeams};
}

test('QEM preserves both split sides of a UV seam, authored edges, and triangle UV winding',()=>{
  const source=sheetFixture();
  const original=inspect(source), reduced=K.procedural.geometry.simplifyQEM(source,{ratio:.42,preserveBoundary:false});
  const after=inspect(reduced);
  assert(reduced.triangles.length<source.triangles.length*.63,JSON.stringify(reduced.work));
  assert.equal(after.summary.uvSeams,original.summary.uvSeams);
  assert.equal(after.summary.protectedSeams,source.protectedSeams.length);
  assert.equal(after.summary.degenerate,0);
  for(const {position,uses,kind,protected:locked} of original.seams) {
    if(kind!=='seam'&&!locked)continue;
    assert(after.seams.some(row=>JSON.stringify(row.position)===JSON.stringify(position) ||
      JSON.stringify(row.position.slice().reverse())===JSON.stringify(position)));
    for(const {face,vertices,uv} of uses){
      const mapped=reduced.sourceFaces.indexOf(face);
      assert(mapped>=0);
      for(const [index,vertex] of vertices.entries()) {
        const mappedVertex=reduced.pointMap[vertex], j=reduced.triangles[mapped].indexOf(mappedVertex);
        assert.deepEqual(reduced.points[mappedVertex],source.points[vertex]);
        assert.deepEqual(reduced.uvs[mapped][j],uv[index]);
      }
    }
  }
  assert(reduced.uvs.every((uv,i)=>Math.sign(area2(...uv))===Math.sign(area2(...source.uvs[reduced.sourceFaces[i]]))));
  assert.deepEqual(reduced.mesh().uv,Float32Array.from(reduced.uvs.flat(2)));
});

test('authored model topology can opt into reduction without dropping bake UVs',()=>{
  const {triangles,...data}=sheetFixture(), B=makeBuilder(1), S=K.sculpt(makeSculpt(B));
  S.box([1,.5,-.12],[1.1,.6,.15],{r:[1,2,3]});
  const topology={...data,faces:triangles};
  const before=K.model.fromSculpt(S,{topology,targetTriangles:80,fur:false});
  const after=K.model.fromSculpt(S,{topology,simplifyTopology:true,targetTriangles:80,fur:false});
  assert.equal(before.faces.length,triangles.length);
  assert(after.faces.length<before.faces.length);
  assert(after.bakeUVs);
  assert.equal(inspect({...after,triangles:after.faces}).summary.protectedSeams,data.protectedSeams.length);
});

test('scene mesh inspection uses the material texture dimensions and the resting shape',()=>{
  const positions=[0,0,0,1,0,0,0,1,0], uvs=[.1,.1,.9,.1,.1,.9];
  const mesh=K.sceneMeshes.create({id:'native-uv',positions,uvs,indices:[0,1,2],materials:[{
    id:'atlas',texture:{width:32,height:16,pixels:new Uint8Array(32*16*4).fill(255)}
  }]});
  const before=K.sceneMeshes.inspectUV(mesh);
  K.sceneMeshes.pose(mesh,positions.map(n=>n*2));
  assert.deepEqual(K.sceneMeshes.inspectUV(mesh),before);
  assert.deepEqual([before.width,before.height],[32,16]);
  assert(Math.abs(before.faces[0].stretch-2)<1e-6);
});

test('CLI round-trips OBJ corner UVs, GLB UVs, reports and protected-edge geometry',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-uv-inspect-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const source=path.join(dir,'panel.obj'), review=path.join(dir,'review'), after=path.join(dir,'reduced.json');
  fs.writeFileSync(source,'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt .1 .9\nvt .9 .9\nvt .9 .1\nvt .1 .1\nf 1/1 2/2 3/3\nf 1/1 3/3 4/4\n');
  const seams=path.join(dir,'seams.json');fs.writeFileSync(seams,'[[0,2]]');
  const run=(...args)=>execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'mesh-uv',...args],{stdio:'pipe'});
  run('inspect',source,'--atlas','128,64','--protected-seams',seams,'--out',review);
  const report=JSON.parse(fs.readFileSync(path.join(review,'report.json')));
  assert.equal(report.width,128);assert.equal(report.height,64);
  assert.equal(report.summary.protectedSeams,1);
  assert.match(fs.readFileSync(path.join(review,'atlas.svg'),'utf8'),/Texel density/);
  assert.match(fs.readFileSync(path.join(review,'seams.svg'),'utf8'),/Protected edge/);
  run('simplify',source,'--triangles','0','--protected-seams',seams,'--boundaries','off','--out',after);
  const reduced=JSON.parse(fs.readFileSync(after));
  assert.equal(reduced.status,'constrained');
  assert.deepEqual(reduced.protectedSeams,[[0,2]]);
  const model=K.model.fromMesh(studio.readMesh(source,{attributes:true})), glb=path.join(dir,'panel.glb');
  studio.exportGlb(model,{out:glb,textureSize:0});
  const imported=studio.readMesh(glb,{attributes:true});
  assert.equal(imported.uvs.length,2);
  assert(imported.uvs[0].flat().every((value,i)=>Math.abs(value-model.uvs[0].flat()[i])<1e-6));
  run('inspect',glb,'--out',path.join(dir,'glb-review'));
  const {gltf,bin}=require('../cli/glb-file.js').readGlb(fs.readFileSync(glb));
  for(const {primitives} of gltf.meshes)for(const {attributes} of primitives) {
    attributes.TEXCOORD_1=attributes.TEXCOORD_0;
    delete attributes.TEXCOORD_0;
  }
  gltf.buffers[0].uri='panel.bin';
  fs.writeFileSync(path.join(dir,'panel.bin'),bin);
  const interchange=path.join(dir,'panel.gltf');
  fs.writeFileSync(interchange,JSON.stringify(gltf));
  assert.deepEqual(studio.readMesh(interchange,{attributes:true,uvSet:1}).uvs,imported.uvs);
  run('inspect',interchange,'--uv-set','1','--out',path.join(dir,'gltf-review'));
});
