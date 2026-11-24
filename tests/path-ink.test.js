const assert = require('node:assert/strict');
const test = require('node:test');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');

const {KIT,makeBuilder,makeSculpt}=ink.load();
const rt={width:60,height:52,samples:24,bounces:0,seed:18};
const wall={r:[1],albedo:'#d0bab2',materialId:'ceramic'};
const pane={r:[1],glass:true,a:.2,albedo:'#ffffff',materialId:'pane',
  optical:{reflection:.02,absorption:.06}};
const line={color:'#113031',width:.72,features:['silhouette','seam']};
function scene(build,cam) {
  const B=makeBuilder(4,[0x141f31,0xb79982,0x85e8ec,0x334b57]), S=makeSculpt(B);
  S.keepReferenceSdf=true;
  build(S);
  S.bake();
  return B.finish({cam:{target:[0,.66,0],dist:5.8,yaw:0,pitch:0,sway:0,ortho:true,...cam},
    radius:5,liveSun:{direction:KIT.V.norm([-.20,.35,.9]),ambient:.12,intensity:.9,shadows:true}});
}
const at=(frame,p)=>Array.from(frame.rgb.subarray(p*3,p*3+3));

test('transmission paints the refracted receiver and leaves unrelated interfaces and occluders untouched',()=>{
  const world=scene(S=>{
    S.box([-.47,.64,-.37],[.43,.52,.10],wall,{objectId:'signal',res:.23});
    S.box([-.47,.65,-.245],[.40,.027,.022],{r:[2],em:.55,materialId:'visor'},
      {objectId:'signal',res:.065});
    S.ball([-.53,.62,.33],[.51,.58,.18],pane,{objectId:'lens',res:.23});
    S.ball([.55,.68,.31],[.30,.38,.12],pane,{objectId:'other-lens',res:.23});
    S.box([-.70,.62,.63],[.046,.39,.032],{r:[3],materialId:'iron'}, {objectId:'bar',res:.08});
  });
  const rule={id:'view',via:'transmission',interface:{object:'lens'},select:{object:'signal'},
    palette:['#385f75'],ink:line};
  const photo=ink.renderPathInk(world,{pathInk:{rules:[]}},rt);
  const styled=ink.renderPathInk(world,{pathInk:{rules:[rule]}},rt);
  assert(styled.stats.inkTransmissionPixels>60);
  assert(styled.stats.inkLinePixels>20);
  assert.equal(styled.stats.inkReflectionPixels,0);
  assert(styled.inkCoverage.transmission.some((value,p)=>value>220 && styled.inkCoverage.lines[p]>100 &&
    at(styled,p).some((channel,i)=>Math.abs(channel-at(photo,p)[i])>8)));
  for (let y=18;y<34;y++) {
    for (const x of [20,21,36,37,38]) {
      const p=y*rt.width+x;
      if (!styled.inkCoverage.transmission[p]) assert.deepEqual(at(styled,p),at(photo,p));
    }
  }
  assert.deepEqual(styled.rgb,ink.renderPathInk(world,{pathInk:{rules:[rule]}},rt).rgb);
});

test('a lens rim does not get a silhouette line from a constant surface behind it',()=>{
  const world=scene(S=>{
    S.box([0,.66,-.55],[2.6,2.5,.09],wall,{objectId:'field',res:.6});
    S.ball([0,.66,.32],[.46,.52,.11],pane,{objectId:'lens',res:.23});
  });
  const f=ink.renderPathInk(world,{pathInk:{rules:[{id:'field',via:'transmission',interface:{object:'lens'},
    select:{object:'field'},palette:['#789ba4'],ink:{...line,features:['silhouette']}}]}},rt);
  assert(f.stats.inkTransmissionPixels>80);
  assert.equal(f.stats.inkLinePixels,0);
});

test('rough opaque reflectors transport the drawing and their tint changes only specular energy',()=>{
  const world=scene(S=>{
    S.box([-.10,.55,-.22],[.28,.42,.12],wall,{objectId:'signal',res:.20});
    S.box([-.10,.75,-.073],[.22,.033,.02],{r:[2],em:.55,materialId:'visor'},
      {objectId:'signal',res:.062});
    S.box([0,-.042,1.20],[1.82,.048,1.72],{r:[3]},{objectId:'wet',res:.33});
  },{pitch:.48,target:[0,.33,.48]});
  const rule={id:'wet-view',via:'reflection',interface:{object:'wet'},select:{object:'signal'},
    palette:['#c8e5ec'],ink:line};
  const draw=tint=>ink.renderPathInk(world,{pathInk:{rules:[rule],
    reflectors:[{select:{object:'wet'},reflectance:1,roughness:.012,tint}]}},rt);
  const white=draw('#ffffff'), blue=draw('#648ae3');
  assert(white.stats.inkReflectionPixels>36);
  assert(white.stats.inkLinePixels>12);
  assert.equal(white.stats.inkTransmissionPixels,0);
  assert.deepEqual(white.inkCoverage.reflection,blue.inkCoverage.reflection);
  assert.deepEqual(white.inkCoverage.lines,blue.inkCoverage.lines);
  assert(white.inkCoverage.reflection.some((v,p)=>v>240 && white.rgb[3*p]>blue.rgb[3*p]+20));
});

test('the delivery command writes native still and animated PNG output from a retained scene',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-path-ink-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const source='examples/path-ink/relay-pool.js', root=path.resolve(__dirname,'..');
  function run(name,...options) {
    const out=path.join(directory,name+'.png');
    execFileSync(process.execPath,['cli/ink-studio.js','path-ink',source,'--w','40','--h','32','--samples','4',
      '--bounces','0','--out',out,...options],{cwd:root,stdio:'pipe'});
    const png=fs.readFileSync(out);
    assert.equal(png.readUInt32BE(16),40);
    assert.equal(png.readUInt32BE(20),32);
    return {png,report:JSON.parse(fs.readFileSync(path.join(directory,name+'.path-ink.json'),'utf8'))};
  }
  const still=run('still','--t','.1');
  assert(still.report.frames[0].inkReflectionPixels>0 && still.report.frames[0].inkTransmissionPixels>0);
  const moving=run('clip','--from','0','--to','.25','--fps','8','--camera-orbit','4');
  assert(moving.png.includes(Buffer.from('acTL')));
  assert.equal(moving.report.frames.length,2);
});
