const fs = require('node:fs');
const path = require('node:path');
const { document } = require('../../cli/glb-file.js');
const { runBakeJob } = require('../../cli/bake-jobs.js');
const { readTexture } = require('../../cli/texture-files.js');
const PNG = require('../../cli/png.js');

const root = path.resolve(process.argv[2] ?? 'studio/out/meridian-relay');
const at = name => path.join(root, name);
const size = 256, segments = 96;
const clamp = n => Math.max(0, Math.min(1, n));

const alloys = [
  ['Midnight enamel', 421, [.041,.095,.144], .40, .25],
  ['Sea glass', 806, [.025,.29,.29], .25, .30],
  ['Honey brass', 309, [.57,.30,.073], .38, .80],
  ['Graphite', 512, [.107,.133,.139], .72, .30],
  ['Porcelain', 659, [.70,.52,.31], .30, .05]
];

function scene() {
  const doc = document(), { gltf } = doc, pieces = [];
  const rings = [
    [.001,.56],[.046,.55],[.135,.45],[.153,.40],[.172,.36],[.193,.31],[.198,.22],
    [.284,.22],[.295,.36],[.320,.37],[.348,.24],[.360,.22],[.413,.20],[.444,.07],[.460,0]
  ];
  function point([r,z], index) {
    const angle = (index % segments) * 2 * Math.PI / segments;
    const x = Math.cos(angle), y = Math.sin(angle);
    const octagon = 1 / Math.max(Math.abs(x),Math.abs(y),.718*(Math.abs(x)+Math.abs(y)));
    const t = clamp((r-.287)/.135);
    const planar = r * (1 + (octagon-1)*t);
    return [planar*x,planar*y,z];
  }
  function sector(from, to, material, partId, partLabel, start=0, end=segments) {
    const positions = [], uv = [], indices = [];
    for (let i = start; i <= end; i++) for (const level of [from,to]) {
      const [x,y,z] = point(rings[level],i);
      positions.push(x*10,y*10,z);
      uv.push(x+.5,.5-y);
    }
    for (let i=start; i<end; i++) {
      const a=(i-start)*2;
      indices.push(a,a+1,a+3,a,a+3,a+2);
    }
    add(positions,uv,indices,material,partId,partLabel);
  }
  function add(positions,uv,indices,material,partId,partLabel) {
    pieces.push({ material, extras:{inkStudio:{partId,partLabel}},
      attributes:{
        POSITION:doc.accessor(Float32Array.from(positions),'VEC3',{bounds:true}),
        TEXCOORD_0:doc.accessor(Float32Array.from(uv),'VEC2')
      },
      indices:doc.accessor(Uint16Array.from(indices),'SCALAR') });
  }
  function cap() {
    const positions=[0,0,.56], uv=[.5,.5], indices=[];
    for (let i=0;i<segments;i++) {
      const [x,y,z]=point(rings[0],i);
      positions.push(x*10,y*10,z);
      uv.push(.5+x,.5-y);
      indices.push(0,i+1,1+(i+1)%segments);
    }
    add(positions,uv,indices,1,21,'Lens center');
  }
  cap();
  sector(0,1,1,205,'Lens crown'); sector(1,2,1,1380,'Lens dome'); sector(2,3,1,218,'Lens chamfer');
  sector(3,4,2,444,'Lens collar'); sector(4,5,2,506,'Retaining ring'); sector(5,6,3,191,'Recess');
  for (let i=0;i<4;i++) sector(6,7,(i&1)?0:1,617+i,'Shutter '+(i+1),i*24,(i+1)*24);
  sector(7,8,3,700,'Track wall');
  for (let i=0;i<16;i++) {
    sector(8,9,i%4===0?4:0,301+i, i%4===0?'Cardinal index':'Index track',i*6,i*6+2);
    sector(8,9,0,761+i,'Recessed track',i*6+2,(i+1)*6);
  }
  sector(9,10,2,905,'Dial shoulder'); sector(10,11,4,702,'Inlay rim');
  sector(11,12,0,603,'Outer enamel'); sector(12,13,2,658,'Housing bevel'); sector(13,14,3,203,'Housing lip');
  gltf.meshes=[{name:'Relay plate',primitives:pieces}];
  gltf.materials=alloys.map(([name,materialId,color,roughnessFactor,metallicFactor])=>({
    name,extras:{inkStudio:{materialId}},pbrMetallicRoughness:{baseColorFactor:[...color,1],roughnessFactor,metallicFactor}
  }));
  gltf.nodes=[
    {name:'Station turntable',translation:[4,7,-2],rotation:[0,0,.382683432365,.923879532511],children:[1]},
    {name:'Station mount',mesh:0,translation:[1,-2,2],rotation:[.1564344650402,0,0,.9876883405951]},
    {name:'Assembly bench',mesh:0,translation:[-4,-2,.5]}
  ];
  gltf.scenes[0].nodes=[0,2];
  fs.writeFileSync(at('relay.glb'),doc.finish());
}

function appearance(color, positions, coverage) {
  const rgba = new Uint8Array(size*size*4);
  const z = i => positions.data[i*3+2];
  for (let y=1;y<size-1;y++) for (let x=1;x<size-1;x++) {
    const i = y*size+x;
    if (!coverage.data[i]) continue;
    const dx = coverage.data[i-1]&&coverage.data[i+1] ? (z(i+1)-z(i-1))*size/20 : 0;
    const dy = coverage.data[i-size]&&coverage.data[i+size] ? (z(i+size)-z(i-size))*size/20 : 0;
    const n = Math.hypot(dx,dy,1), spec = Math.max(0,(1+dx*.5+dy*.39)/(n*1.19))**14;
    const exposure = .54 + .57 * Math.max(.05,(.75+dx*.49+dy*.44)/n);
    const a=(x+.5)/size-.5,b=(y+.5)/size-.5,r=Math.hypot(a,b);
    const angle=Math.atan2(b,a), arc=(angle+Math.PI*2)%(Math.PI*2);
    const sweep=.97+.047*Math.sin(x*1.3+y*.92)*Math.cos(y*1.24-x*.41);
    const groove=Math.abs(Math.sin(30*(arc+Math.PI/2)));
    let marking=0;
    if(r>.225&&r<.273&&groove<.19)marking=.68;
    if(r>.36&&r<.393&&((x+y)%8<2)&&Math.abs(a-b)>.13)marking=.09;
    const emblem=Math.abs(a)+Math.abs(b)*.73;
    const lensMark=(emblem<.058&&emblem>.045)||(Math.abs(a)<.0035||Math.abs(b)<.0035)&&r<.039;
    if(lensMark)marking=.8;
    const gleam=clamp(1-Math.abs(r-.138)/.004) * clamp((Math.cos(arc+2.3)-.56)*1.8);
    const highlight=[.22,.19,.12];
    for(let c=0;c<3;c++) {
      const pigment=color.data[i*color.channels+c]/255;
      rgba[i*4+c] = Math.round(255*clamp(pigment*exposure*sweep + (spec+gleam*.8)*highlight[c] +
        marking*([.97,.79,.54][c]-pigment)));
    }
    rgba[i*4+3]=255;
  }
  return PNG.encode(size,size,rgba,4,{srgb:true});
}

async function main() {
  fs.mkdirSync(root,{recursive:true});
  scene();
  const save = (name,json) => fs.writeFileSync(at(name),JSON.stringify(json,null,2)+'\n');
  const maps=['position-object','position-world','position-normalized','vertex-id','material-id','part-id','coverage','pigment'];
  for(const [mode,node] of [['station','Station mount'],['bench','Assembly bench']]) {
    const enabled = mode==='station' ? maps : ['position-world'];
    save(mode+'.preset.json',{format:'ink-studio/bake-preset',version:1,label:node,
      defaults:{size,padding:2},maps:enabled.map(id=>({id}))});
    save(mode+'.bake.json',{format:'ink-studio/bake-job',version:1,label:'Meridian Relay',source:'relay.glb',
      preset:mode+'.preset.json',targets:[{id:'relay',mesh:'Relay plate',positionNode:node}]});
  }
  const artifacts = {}, review = {}, textures = {};
  for (const mode of ['station','bench']) {
    const result = await runBakeJob(at(mode+'.bake.json'),{directory:at(mode)});
    const base=mode+'/revisions/'+result.revision+'/';
    review[mode]=base+'index.html';
    for (const row of result.report.maps) {
      const file=base+row.file, key=mode==='bench'?'bench-world':row.map;
      const image=readTexture(at(file));
      textures[key]=image;
      const {data,channels}=image, samples=Buffer.alloc(data.length*4);
      for(const [i,value] of data.entries())samples.writeFloatLE(value,i*4);
      artifacts[key]={file,preview:base+(row.previewFile??row.file),output:row.output,channels,
        ...(row.output&&{samples:samples.toString('base64')})};
    }
  }
  fs.writeFileSync(at('enamel.png'),appearance(textures.pigment,textures['position-object'],textures.coverage));
  artifacts.enamel={file:'enamel.png',preview:'enamel.png'};
  fs.writeFileSync(at('data.js'),'const demo = '+JSON.stringify({size,artifacts,review})+';\n');
  fs.copyFileSync(path.join(__dirname,'gallery.html'),at('index.html'));
  console.log(at('index.html'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
