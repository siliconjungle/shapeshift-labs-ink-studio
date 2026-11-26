const fs = require('node:fs');
const path = require('node:path');
const { document } = require('../../cli/glb-file.js');
const { runBakeJob } = require('../../cli/bake-jobs.js');
const PNG = require('../../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/vesper-gate');
const at = name => path.join(out, name);
const colors = {
  receiver:'#355359', deep:'#162d33', enamel:'#23575a', glass:'#438485', flare:'#73b6a5',
  shadow:'#422f2b', copper:'#946045', bronze:'#bc8b5b', gold:'#ecc27a', ivory:'#f4d996',
  ruby:'#983d49', error:'#df7584', patina:'#4a825e'
};
const linear = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
const profiles = Object.entries(colors).map(([name, hex]) => ({
  name, pbrMetallicRoughness:{baseColorFactor:[...hex.slice(1).match(/../g).map(n => linear(parseInt(n, 16) / 255)),1],
    metallicFactor:['shadow','copper','bronze','gold'].includes(name) ? .76 : .14, roughnessFactor:name==='glass'?.28:.42}
}));
const material = name => profiles.findIndex(profile => profile.name===name);
const tau = 2 * Math.PI;

function collector() {
  const streams = new Map();
  function triangles(polygon, paint, indices) {
    if (!streams.has(paint)) streams.set(paint,{points:[], indices:[]});
    const row=streams.get(paint), first=row.points.length;
    row.points.push(...polygon);
    row.indices.push(...indices.map(i => i + first));
  }
  function face(polygon, paint, flip=false) {
    const indices=[];
    for(let i=1;i+1<polygon.length;i++) indices.push(0,...(flip?[i+1,i]:[i,i+1]));
    triangles(polygon,paint,indices);
  }
  function band(outer, inner, paint, closed=true) {
    const count=closed?outer.length:outer.length-1, shades=Array.isArray(paint)?paint:[paint];
    for(let i=0;i<count;i++) {
      const j=(i+1)%outer.length;
      face([outer[i],outer[j],inner[j],inner[i]],shades[Math.floor(i*shades.length/count)]);
    }
  }
  return {streams,face,band};
}

const pent = (x,y,w,h,c,z) => [[-w+c,-h],[w-c,-h],[w,-h+c],[w,h-c],[w-c,h],[-w+c,h],[-w,h-c],[-w,-h+c]]
  .map(([u,v])=>[x+u,y+v,z]);
function arc(x,y,r,z,start=0,angle=tau,n=64,closed=true) {
  return Array.from({length:n+Number(!closed)},(_,i)=>{
    const a=start+angle*i/n;
    return [x+r*Math.cos(a),y+r*Math.sin(a),z];
  });
}
function strip(shape,x,y,outer,inner,z,start,span,paint,n=34) {
  shape.band(arc(x,y,outer,z,start,span,n,false),arc(x,y,inner,z+.004,start,span,n,false),paint,false);
}
function bevel(shape, x,y,w,h,c,z,paint,border,step=.016) {
  shape.band(pent(x,y,w,h,c,z-step),pent(x,y,w-step,h-step,Math.max(.006,c-step/2),z),border);
  shape.face(pent(x,y,w-step,h-step,Math.max(.006,c-step/2),z),paint);
}
function bolt(shape,x,y,r) {
  shape.band(arc(x,y,r,.082,0,tau,18),arc(x,y,r*.74,.104,0,tau,18),['shadow','copper','gold','bronze']);
  shape.face(arc(x,y,r*.74,.104,0,tau,18),'bronze');
  bevel(shape,x,y,r*.53,r*.155,.008,.108,'shadow','copper',.004);
}
function write(name, groups) {
  const doc = document(), { gltf } = doc;
  gltf.materials=profiles;
  gltf.meshes=groups.map(({name,shape,receiver,cage})=>({name,primitives:Array.from(shape.streams,([paint,row])=>{
    const coords = row.points.flatMap(([x,y,z]) => cage ? [x+.07+.04*y,y,z+.255] : [x,y,z]);
    const attributes={POSITION:doc.accessor(Float32Array.from(coords),'VEC3',{bounds:true})};
    if(receiver)attributes.TEXCOORD_0=doc.accessor(Float32Array.from(row.points.flatMap(([x,y])=>[(x+1.07)/2.14,(1.07-y)/2.14])),'VEC2');
    return {attributes,material:material(paint),indices:doc.accessor(Uint32Array.from(row.indices),'SCALAR')};
  })}));
  gltf.nodes=groups.map((_,mesh)=>({mesh}));
  gltf.scenes[0].nodes=gltf.nodes.map((_,i)=>i);
  fs.writeFileSync(at(name),doc.finish());
}

function authorMesh() {
  const low=collector(), high=collector(), neighbor=collector();
  low.face(pent(0,0,.92,.92,.09,0),'receiver');
  low.band(pent(0,0,1,1,.14,-.078),pent(0,0,.92,.92,.09,0),'receiver');

  high.band(pent(0,0,1.035,1.035,.16,-.045),pent(0,0,.92,.92,.09,.037),['shadow','copper','gold','bronze']);
  high.band(pent(0,0,.925,.925,.09,.038),pent(0,0,.885,.885,.08,.046),['copper','bronze','gold','bronze']);
  high.band(pent(0,0,.887,.887,.08,.037),pent(0,0,.85,.85,.075,.017),'deep');
  high.face(pent(0,0,.856,.856,.075,.017),'enamel');
  high.band(pent(0,0,.793,.793,.081,.025),pent(0,0,.776,.776,.077,.031),['deep','glass','flare','glass']);
  high.band(pent(0,0,.749,.749,.071,.023),pent(0,0,.743,.743,.068,.024),'copper');

  high.band(arc(0,.055,.602,.04),arc(0,.055,.548,.099),['shadow','bronze','gold','copper']);
  high.band(arc(0,.055,.55,.1),arc(0,.055,.513,.113),['bronze','gold','ivory','gold']);
  high.band(arc(0,.055,.515,.078),arc(0,.055,.484,.039),'shadow');
  high.face(arc(0,.055,.488,.048),'deep');
  strip(high,0,.055,.444,.429,.069,.18,Math.PI*1.79,'glass',68);
  strip(high,0,.055,.409,.401,.073,Math.PI*.06,Math.PI*.70,'bronze',25);
  strip(high,0,.055,.409,.4,.074,Math.PI*1.27,Math.PI*.58,'flare',25);
  for(let i=0;i<19;i++) {
    const a=.12+i*(tau-.25)/19;
    strip(high,0,.055,.433,i%3? .401:.383,.080,a,.029,i%3?'bronze':'gold',2);
  }
  const sun=[.06,.157];
  high.band(arc(...sun,.177,.079,0,tau,42),arc(...sun,.144,.107,0,tau,42),['copper','bronze','ivory','gold']);
  high.face(arc(...sun,.145,.107,0,tau,42),'gold');
  const flag=[[.018,-.142,.154],[.158,.27,.154],[.13,-.162,.154],[.067,-.109,.154]];
  high.face(flag,'ivory',true);
  high.face(arc(.069,-.072,.045,.162,0,tau,20),'copper');
  high.face(arc(.069,-.072,.026,.169,0,tau,20),'gold');
  for(const x of [-.698,.698])for(const y of [-.68,.68]) bolt(high,x,y,.069);
  for(const x of [-.64,.64]) {
    bevel(high,x,.025,.048,.182,.026,.066,'deep','bronze');
    for(const [i, y] of [-.07, .025, .12].entries()) bevel(high,x,y,.025,.025,.009,.082,i?'glass':'flare','glass',.006);
  }
  bevel(high,0,-.663,.34,.09,.05,.073,'shadow','bronze');
  for(let i=0;i<7;i++) {
    const x=-.225+i*.075;
    bevel(high,x,-.663,.017,i%3?.024:.043,.007,.088,i%3?'bronze':'gold','copper',.004);
  }
  // This inward-facing lid and the adjacent indicator bracket are diagnostic obstacles.
  high.face(pent(.375,.38,.162,.1,.031,.181),'patina',true);
  bevel(neighbor,.552,.47,.48,.128,.042,.206,'error','ruby',.024);
  return {low,high,neighbor};
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  const { low,high,neighbor }=authorMesh();
  write('low.glb',[{name:'Vesper_low',shape:low,receiver:true}]);
  write('detail.glb',[{name:'Vesper_high',shape:high},{name:'Adjacent_high',shape:neighbor}]);
  write('cage.glb',[{name:'Vesper cage',shape:low,cage:true}]);
  const n=192, pixels=new Uint8Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
    const band=Math.abs(y/n-.36), side=Math.abs(x/n-.5);
    pixels[x+y*n]=Math.round(255*Math.max(0,Math.min(1,1-(band*.72+side*.25)*2.5)));
  }
  fs.writeFileSync(at('skew.png'),PNG.encodeGray(n,n,pixels));
  const common={mode:'project',high:'detail',match:'name',lowSuffix:'_low',highSuffix:'_high',front:.235,back:.06,
    units:'scene',normals:'face',backfaces:'ignore'};
  const variants=[
    ['matched','Match by suffix',common],
    ['all','All high meshes',{mode:'project',high:'detail',front:.235,back:.06,normals:'face'}],
    ['self','Self-bake',{mode:'self'}],
    ['average','Average normals',{...common,normals:'average'}],
    ['clipped','Short reach',{...common,front:.025,back:0}],
    ['bounds','Low bounding box',{...common,units:'bounds',front:.1175,back:.03}],
    ['blocked','Block on backface',{...common,backfaces:'block'}],
    ['accepted','Accept backface',{...common,backfaces:'accept'}],
    ['skew','Painted skew',{...common,skew:'rim-ramp'}],
    ['inverted','Inverted skew',{...common,skew:'rim-ramp',invertSkew:true}],
    ['cage','Explicit cage',{...common,cage:{source:'cage'}}]
  ];
  const targets=variants.map(([id,,projection])=>({id,mesh:'Vesper_low',tiles:[1001],projection}));
  const preset={format:'ink-studio/bake-preset',version:1,label:'Vesper projection review',defaults:{size:256,padding:2},
    maps:['pigment','normal','cage-hit','cage-miss','cage-backface','cage-distance','cage-relief'].map(id=>({id}))};
  const save=(file,value)=>fs.writeFileSync(at(file),JSON.stringify(value,null,2)+'\n');
  save('vesper.preset.json',preset);
  save('vesper.bake.json',{format:'ink-studio/bake-job',version:1,label:'Vesper Gate',source:'low.glb',
    projectionSources:{detail:'detail.glb',cage:'cage.glb'},skewMaps:{'rim-ramp':'skew.png'},
    preset:'vesper.preset.json',targets});
  const result=await runBakeJob(at('vesper.bake.json'),{directory:at('review')});
  const revision='review/revisions/'+result.revision+'/';
  fs.writeFileSync(at('gallery-data.js'),'const review = '+JSON.stringify({revision,
    variants:variants.map(([id,label])=>[id,label]),maps:result.report.maps.map(({target,map,file,projection})=>({target,map,file,
      hits:projection.hits,backfaces:projection.backfaces,misses:projection.misses}))})+';\n');
  fs.copyFileSync(path.join(__dirname,'gallery.html'),at('index.html'));
  console.log(at('index.html'));
}

main().catch(error=>{ console.error(error);process.exitCode=1; });
