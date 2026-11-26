/* Cinder Dial. Review the same painted enamel on a curved, registered metal face. */
const path = require('node:path');
const Ink = require('..');
const { writeReview } = require('../cli/paint-lighting-review.js');

const size = 224, center = size / 2, radius = 104, tau = 2 * Math.PI;
const saturate = n => Math.max(0, Math.min(n, 1));
const byte = n => Math.round(saturate(n) * 255);
const inside = (x,y,points) => {
  let on = false;
  for (let i=0,j=points.length-1; i<points.length; j=i++) {
    const [a,b]=points[i], [c,d]=points[j];
    if ((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a) on=!on;
  }
  return on;
};
function segment(x,y,a,b,c,d) {
  const u=c-a, v=d-b, t=saturate(((x-a)*u+(y-b)*v)/(u*u+v*v));
  return Math.hypot(x-a-t*u, y-b-t*v);
}
const bronze = [0x382123,0x6a392e,0x9b603c,0xc4834e,0xe5b070,0xf7d595];
const enamel = [0x162733,0x1c3641,0x234a50,0x306361,0x428278,0x70a399];
const fire = [0x662e30,0xa44435,0xd26640,0xf0a34d,0xffcb6c,0xffe7a6];
const letters = {
  N:['10001','11001','11101','10111','10011','10001','10001'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  S:['01111','10000','10000','01110','00001','00001','11110'],
  W:['10001','10001','10001','10101','10101','11011','10001']
};
const flame = [[0,43],[-21,36],[-30,20],[-29,2],[-20,-13],[-18,3],[-9,-2],[-6,-20],[8,-38],
  [13,-54],[27,-35],[30,-22],[24,-8],[37,-17],[43,1],[37,21],[22,33]];
const core = [[1,34],[-12,26],[-15,14],[-9,5],[-5,15],[1,4],[10,-12],[19,-20],[20,-6],
  [16,9],[26,3],[27,17],[17,28]];
const spark = [[-4,24],[1,16],[7,16],[14,5],[17,15],[13,25],[5,30]];
const horizon = [[-48,28,-32,33],[-27,41,-12,43],[16,43,32,37],[37,33,48,27]];
const screws = Array.from({length:6},(_,i)=>[Math.sin((i+.5)*tau/6)*96, -Math.cos((i+.5)*tau/6)*96]);
const cardinal = [['N',0,-55],['E',58,0],['S',0,55],['W',-58,0]];

function plateTexel(x,y) {
  const r=Math.hypot(x,y), a=Math.atan2(x,-y), sector=Math.round(a/tau*60);
  const slice=Math.abs(a/tau*60-sector), phase=Math.sin(a*13)*.45+Math.sin(a*23+.4)*.25;
  const grain=Math.sin(x*.423+y*.399)*Math.cos(y*.315-x*.161);
  if (r>90) {
    const band=r>102 ? 0 : r>100 ? 2 : r>97.8 ? 3 : r>93.8 ? 2 : r>92.2 ? 4 : 1;
    const tint=Math.max(0,Math.min(5,band+Math.round(phase + .24*grain + .37*(x+y<0))));
    for (const [u,v] of screws) {
      const d=Math.hypot(x-u,y-v);
      if(d<4.8) return [bronze[d>3.8?0:Math.abs(y-v+.25*(x-u))<.65?1:5],.32+Math.max(0,1-d/4.8)*.79,.27,.76];
    }
    return [bronze[tint],.20 + .52*Math.sin(Math.PI*saturate((r-90)/14)),.26 + .13*grain,.78];
  }
  if(r>85) return [bronze[r>88.5?0:r>87.2?4:2],.31+(r-85)*.038,.38,.72];
  if(r>79) return [enamel[r>84?0:grain>.5?2:1],.22+.065*Math.cos(a*16),.65,.09];
  if(r>77) return [bronze[r>78?3:1],.34,.34,.70];
  if (r>67 && slice<.15 && (sector%5===0 || r>73))
    return [bronze[sector%5===0?5:3],.37,sector%5===0?.27:.49,.61];
  if (r>63 && r<64) return [enamel[3],.23,.69,.08];
  for (const [ch,u,v] of cardinal) {
    const i=Math.floor((x-u+5)/2), j=Math.floor((y-v+7)/2);
    if(i>=0&&i<5&&j>=0&&j<7&&letters[ch][j][i]==='1') return [bronze[5],.42,.39,.50];
  }
  const constellation = [[-44,-20],[-37,-29],[44,-27],[48,15],[-50,16],[-36,-44],[36,39],[-25,41]];
  if(constellation.some(([u,v],i)=>Math.abs(u-x)+Math.abs(v-y)<1.6+(i%3===0))) return [bronze[4],.30,.40,.45];
  if (inside(x,y,flame)) {
    const shadow=2 + Math.round(1.2 * Math.sin(x*.085-y*.055) + grain*.27);
    let slot = Math.max(1,Math.min(4,shadow)), height=.56;
    if (inside(x,y,core)) { slot=3+(x-y>2); height=.76; }
    if (inside(x,y,spark)) { slot=5; height=.89; }
    return [fire[slot],height,.26+.14*saturate((y+34)/62),.38];
  }
  if (horizon.some(row=>segment(x,y,...row)<.8)) return [enamel[4],.33,.57,.26];
  const drift=Math.sin(x*.116+y*.04)*Math.cos(y*.122)+.24*grain;
  const tone=1+(r<58)+(drift>.49)+(drift>.91);
  return [enamel[tone],.19+.013*grain+.035*(drift>.70),.72+.04*grain,.06];
}

function material(K) {
  const count=size*size, rgba=new Uint8Array(count*4), rough=new Uint8Array(count), metal=new Uint8Array(count);
  const elevation=new Float32Array(count);
  for(let y=0,p=0;y<size;y++) for(let x=0;x<size;x++,p++) {
    const [color,height,roughness,metalness]=plateTexel(x-center+.5,y-center+.5);
    rgba.set([color>>16,color>>8&255,color&255,255],p*4);
    elevation[p]=height;
    rough[p]=byte(roughness);
    metal[p]=byte(metalness);
  }
  const P=K.procedural;
  const declare=(data,channels,descriptor)=>P.graphImages.declare({width:size,height:size,channels,data},descriptor);
  const source=P.materialChannels.pack({
    baseColor:declare(rgba,4,{intent:'color'}),
    height:declare(elevation,1,{intent:'height',units:'mm'}),
    roughness:declare(rough,1,{intent:'data'}),
    metalness:declare(metal,1,{intent:'data'})
  });
  const uv=points=>points.map(([x,y])=>[(center+x)/size,(center+y)/size]);
  const stroke=(points,brush,value)=>({space:'uv',samples:uv(points),brush,value});
  const paint={format:'ink-studio/material-paint',version:1,layers:[
    {id:'verde-glaze',channel:'baseColor',opacity:.53,strokes:[
      stroke([[-30,-65],[-45,-54],[-58,-39],[-63,-22]],{radius:4,hardness:.48},[.35,.62,.52])
    ]},
    {id:'polished-arc',channel:'roughness',strokes:[
      stroke([[20,-13],[23,-5],[22,8],[17,22],[6,31]],{radius:15,hardness:.24},.16),
      stroke([[-69,-43],[-58,-54],[-43,-66],[-23,-74],[-2,-76]],{radius:6,hardness:.27},.20)
    ]},
    {id:'incised-border',channel:'height',strokes:[
      stroke([[-62,31],[-56,37],[-52,44],[-43,50]],{radius:1.8,hardness:.62},.28),
      stroke([[43,50],[52,44],[56,37],[62,31]],{radius:1.8,hardness:.62},.28)
    ]}
  ]};
  const ref=(node,port='value')=>({node,port});
  const graph=P.graph.create({inputs:{source:'materialChannels',session:'record'},nodes:{
    paint:{op:'material.paint',inputs:{source:{input:'source'},session:{input:'session'}}},
    height:{op:'material.image',inputs:{source:ref('paint'),name:'height'}},
    normal:{op:'image.heightToNormal',inputs:{source:ref('height'),options:{spacing:[.24,.24],strength:.68}}},
    roughness:{op:'material.image',inputs:{source:ref('paint'),name:'roughness'}},
    color:{op:'material.image',inputs:{source:ref('paint'),name:'baseColor'}}
  },outputs:{normal:ref('normal'),roughness:ref('roughness'),color:ref('color')}});
  const {normal, roughness, color}=graph.evaluate({source,session:paint}).outputs;
  const normals=new Uint8Array(count*4);
  const data=normal.raster.data;
  for(let p=0;p<count;p++) normals.set([byte(.5+.5*data[p*3]),byte(.5+.5*data[p*3+1]),byte(.5+.5*data[p*3+2]),255],p*4);
  return {id:'cinder-enamel',texture:{width:size,height:size,pixels:color.raster.data},normal:normals,roughness:roughness.raster.data,
    metalness:metal,mipmaps:{variance:.18}};
}

function dial(K) {
  const tex=material(K), positions=[0,0,.22], uvs=[.5,.5], indices=[], sectors=96;
  for(const [r,z] of [[.16,.216],[.40,.187],[.66,.149],[.82,.09],[.873,.105],[.925,.137],[.97,.095],[1,.04],[.996,-.06],[.956,-.157]]) {
    for(let i=0;i<sectors;i++){
      const a=-i/sectors*tau, x=Math.cos(a), y=Math.sin(a);
      const edge=(r>.97 ? 1+.003*Math.cos(a*12) : 1);
      positions.push(r*x*1.19*edge,r*y*1.19*edge,z);
      uvs.push(.5+r*x*radius/size,.5-r*y*radius/size);
    }
  }
  for(let i=0;i<sectors;i++)indices.push(0,1+(i+1)%sectors,1+i);
  for(let j=0;j<9;j++)for(let i=0;i<sectors;i++){
    const a=1+j*sectors+i,b=1+j*sectors+(i+1)%sectors,c=a+sectors,d=b+sectors;
    indices.push(a,b,c,b,d,c);
  }
  return K.sceneMeshes.create({id:'cinder-dial',positions,uvs,indices,materials:[tex]});
}

function build() {
  const {KIT,makeBuilder}=Ink.load(), mesh=dial(KIT);
  const B=makeBuilder(641,[0x1b262b,0x352536,0x72504a,0xbd875c]);
  const cam={target:[0,0,.035],dist:5.15,yaw:-.20,pitch:.16,fov: .66,sway:0};
  const pbrMaterials={default:'enamel',materials:{enamel:{}},
    environment:{sky:'#e8dfe6',ground:'#6a483b',horizon:'#d2b5a1',intensity:.40},
    lights:[{direction:[-.5,.45,.74],color:'#ffdeb0',intensity:2.55},
      {direction:[.9,.16,.2],color:'#acdfdb',intensity:.80}]};
  return B.finish({id:'cinder-dial',cam,meshes:[mesh],pbrMaterials,dither:0});
}

if(require.main===module) {
  const directory=path.resolve(process.argv[2]??'studio/out/cinder-dial');
  const review=Ink.reviewPaintLighting(build(),{view:{w:316,h:216,raw:true,transparent:true},
    subject:{object:'cinder-dial'},steps:9,ranges:[.74,1,1.56]});
  console.log(writeReview(directory,review));
}
module.exports={build};
