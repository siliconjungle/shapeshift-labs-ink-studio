/* The Vesper Guard. Native-mesh relighting with editable, object-local texels. */
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');

const tau = 2*Math.PI;
const turn = (angle, pivot) => {
  const c=Math.cos(angle),s=Math.sin(angle),[x, ,z]=pivot;
  return [c,0,s,0,1,0,-s,0,c,x-c*x-s*z,0,z+s*x-c*z];
};

function shell(rings, sectors, cut = () => false) {
  const points=[], triangles=[];
  for (const [y,rx,rz,z] of rings) for (let i=0;i<sectors;i++) {
    const a=tau*i/sectors;
    points.push(Math.sin(a)*rx,y,Math.cos(a)*rz+z);
  }
  for (let j=0;j<rings.length-1;j++) for (let i=0;i<sectors;i++) {
    const a=j*sectors+i,b=j*sectors+(i+1)%sectors,c=a+sectors,d=b+sectors;
    if (!cut(j,i)) triangles.push(a,b,c,b,d,c);
  }
  return {points,triangles};
}

function shieldGeometry() {
  const points=[],triangles=[],sectors=24;
  const center=[-.69,1.70,.77];
  const rings=[[0,.015],[.10,.072],[.77,0],[.90,-.045],[1,-.12],[1,-.18],[0,-.084]];
  for (const [blend,z] of rings) for (let i=0;i<sectors;i++) {
    const a=tau*i/sectors, x=Math.sin(a), y=Math.cos(a), diamond=Math.abs(x)+Math.abs(y);
    const outerX=x*(.71+.11*y)*(y<-.35 ? 1.05+.64*y : 1);
    const outerY=y*(y<0?1.04:.64), innerX=x*.22/diamond,innerY=y*.29/diamond+.19;
    points.push(center[0]+innerX+(outerX-innerX)*blend,center[1]+innerY+(outerY-innerY)*blend,
      center[2]+z-.09*Math.abs(x)*blend);
  }
  for (let j=0;j<rings.length;j++) for (let i=0;i<sectors;i++) {
    const a=j*sectors+i,b=j*sectors+(i+1)%sectors,c=((j+1)%rings.length)*sectors+i,
      d=((j+1)%rings.length)*sectors+(i+1)%sectors;
    triangles.push(a,b,c,b,d,c);
  }
  return {points,triangles,center};
}

async function build() {
  const {bakeObjectTexels,editObjectTexels}=await import('../webgl.mjs');
  const {KIT:K,makeBuilder}=ink.load(), S=K.sceneMeshes;
  const palette=[0x101624,0x182738,0x233545,0x314e59,0x4b726d,0x85a698,
    0xc0c7a1,0xe8d5a4,0xffe4b6,0x492a32,0x75414c,0xa75359,
    0x4e322c,0x704630,0xa17349,0xc4955b,0xe4bc73,0xf9e6ba,0x75d7bd,0xaefcda];
  const builder=makeBuilder(251,palette);
  const helm=shell([[2.05,.51,.41,.03],[2.17,.59,.47,.02],[2.39,.62,.53,.05],
    [2.54,.61,.55,.05],[2.67,.65,.55,.04],[2.79,.67,.56,.02],[3.03,.60,.50,0],
    [3.28,.47,.39,-.02],[3.47,.24,.23,-.03],[3.56,.025,.027,-.035]],32,
    (j,i)=>(j===2||j===3)&&(i===0||i===1||i===30||i===31));
  const shield=shieldGeometry();
  const brass=[0x614530,0x976a43,0xb38451,0xdca974,0xd9bb86];
  const steel=[0x354f55,0x456565,0x5d7773,0x7b9180,0x9aab91];
  const noise=(x,y,z)=>((Math.imul(x,194803)^Math.imul(y,196613)^Math.imul(z,21211))>>>0)%29;
  const material=(sampler,mesh,origin,resolution)=>bakeObjectTexels(mesh,{origin,resolution,
    material:sampler,fallback:(triangle,normal,cell)=>sampler({...cell,normal})});
  const crown=material(({point:[x,y,z],normal})=>{
    const a=Math.atan2(x,z), sector=Math.floor((a+Math.PI)*31), row=Math.floor(y*44);
    const n=noise(sector,row,5), visor=z>.45 && y<2.85,
      brim=y>2.73&&y<2.83, crest=Math.abs(x)<.083&&y>2.83&&z>-.32,
      rivet=(Math.floor((a+Math.PI)*23)%7===0)&&(y>2.80&&y<2.89||y>2.12&&y<2.19);
    const alloy=brim||crest||rivet;
    const swatches=alloy?brass:steel;
    const band=Math.min(4,(n%11===0?3:n%3)+Number(crest||rivet));
    const grain=(n/28-.5)*(alloy?.11:.19);
    return {pigment:visor&&!alloy ? [0x4b605b,0x4f6965,0x65746b][n%3] : swatches[band],
      normal:[normal[0]+grain,normal[1]+(n%7-3)*.018,normal[2]],
      roughness:alloy ? rivet?.18:.28 : n%5===0?.38:.53};
  },helm,[.013,2.885,.025],17);
  const plate=material(({point:[x,y,z],normal})=>{
    const u=x-shield.center[0],v=y-shield.center[1],near=shield.center[2]-z;
    const angle=Math.atan2(u,v), n=noise(Math.floor(x*69),Math.floor(y*68),21);
    const edge=near>.056, rim=near<-.020, diamond=Math.abs(u)/.22+Math.abs(v-.19)/.29;
    const rune=!edge&&v<.12&&v>-.55&&Math.abs(Math.abs(u)-(.245+.10*v))<.032&&
      Math.floor((v+.62)*19)%3!==0;
    const border=edge||rim||diamond<1.36;
    const leaf=Math.sin(angle*11+v*18)*Math.sin(v*31);
    const shade=Math.min(4,Math.max(0,Math.floor((leaf+1)*1.18)+Number(n%4===0)));
    return {pigment:rune ? 0x4d8976 : (border?brass:steel)[shade],
      normal:[normal[0]+.06*leaf,normal[1]+.04*(n%7-3),normal[2]],
      roughness:border?.26:.47};
  },shield,[shield.center[0]+.335,shield.center[1]-.068,.697],18);
  // Paint the same cell IDs on every pose. Cyan pigment also emits weakly.
  const trims=plate.cells.filter(cell=>cell && !cell.fallback && cell.point[2]>.68 &&
    cell.point[1]>.99 && cell.point[1]<1.67 &&
    Math.abs(Math.abs(cell.point[0]-shield.center[0])-.26)<.048 && cell.y%3!==0);
  const gilt=editObjectTexels(plate,trims.map(({id})=>({id,pigment:0x457769,emission:0x21876a,roughness:.35})));
  const head=S.fromObjectTexels(crown,{id:'helmet',objectId:'vesper',partId:'helmet',materialId:'patinated-steel',
    lighting:{specular:.91}});
  const guard=S.fromObjectTexels(plate,{id:'pierced-shield',objectId:'vesper',partId:'shield',materialId:'bronze-enamel',
    lighting:{specular:.66},emissionStrength:.9});
  S.updateObjectTexels(guard,gilt);
  const headRig=S.skin(head,Array(head.vertices).fill(0)), shieldRig=S.skin(guard,Array(guard.vertices).fill(0));
  const jacket=shell([[.69,.77,.38,0],[.81,.96,.43,0],[1.17,.88,.44,0],[1.56,.84,.47,0],
    [1.80,1.06,.46,0],[1.99,.91,.40,0],[2.16,.66,.35,0],[2.25,.37,.30,0]],32);
  const cloth=material(({point:[x,y,z],normal})=>{
    const a=Math.atan2(x,z), n=noise(Math.floor(a*70),Math.floor(y*51),9);
    const streak=Math.sin(a*27+y*4)+Math.sin(a*13-y*3);
    const trim=y>1.91&&y<2.12;
    return {pigment:trim ? brass[1+n%3] : (streak>.5?0x75414a:streak<-.9?0x442b34:0x61353e),
      normal:[normal[0]+.08*streak,normal[1],normal[2]],roughness:trim?.46:.91};
  },jacket,[.023,1.50,.014],15);
  const torso=S.fromObjectTexels(cloth,{id:'mantle',objectId:'vesper',partId:'mantle',lighting:{specular:.27}});
  const plinth=shell([[.02,1.18,.73,0],[.14,1.24,.77,0],[.26,1.24,.77,0],[.28,1.15,.69,0],
    [.43,1.11,.65,0],[.48,1.24,.77,0],[.56,1.24,.77,0],[.65,1.16,.71,0],[.68,.02,.012,0]],24);
  const base=material(({point:[x,y,z],normal})=>{
    const n=noise(Math.floor(x*26),Math.floor(y*40),Math.floor(z*31)), trim=y>.47&&y<.56;
    return {pigment:trim ? [0x504032,0x6e573a,0x8e7047][n%3] :
      [0x243542,0x2a3d47,0x34464b,0x3a4c50][n%4],normal,roughness:trim?.57:.88};
  },plinth,[.004,.323,.012],12);
  const pedestal=S.fromObjectTexels(base,{id:'plinth',lighting:{specular:.2}});
  // A dark backing floats behind the actual eye opening, with two inset lamps.
  const visor=S.create({id:'visor-back',objectId:'vesper',partId:'helmet',
    positions:[-.34,2.38,.445,.34,2.38,.445,.34,2.70,.445,-.34,2.70,.445],
    uvs:[0,1,1,1,1,0,0,0],indices:[0,1,2,0,2,3],materials:[{id:'dark-lining',color:0x101b21}]});
  const eye=S.create({id:'visor-light',objectId:'vesper',partId:'helmet',
    positions:[-.168,2.53,.448,-.085,2.53,.448,-.085,2.563,.448,-.168,2.563,.448,
      .085,2.53,.448,.168,2.53,.448,.168,2.563,.448,.085,2.563,.448],
    uvs:Array(16).fill(0),indices:[0,1,2,0,2,3,4,5,6,4,6,7],
    materials:[{id:'pilots',color:0x31513d,emission:Uint8Array.from([148,241,190]),emissionStrength:.65}]});
  const linerRig=S.skin(visor,Array(visor.vertices).fill(0)), eyeRig=S.skin(eye,Array(eye.vertices).fill(0));
  const world=builder.finish({id:'vesper-guard',meshes:[pedestal,torso,head,guard,visor,eye],radius:8,dither:0,
    cam:{target:[0,1.79,0],dist:7.7,yaw:.3,pitch:.08,fov:.53},fog:{c:0,start:1,max:0}});
  function frame(t) {
    const phase=tau*t, sweep=Math.sin(phase-.68);
    const headPose=turn(.18*Math.sin(phase-.35),[0,0,.02]);
    const shieldPose=turn(-.20+.61*Math.sin(phase),shield.center);
    headRig.pose(headPose); linerRig.pose(headPose); eyeRig.pose(headPose);
    shieldRig.pose(shieldPose);
    return ink.render(world,{w:264,h:208,px:1,raw:true,transparent:true,t,
      yaw:.18+.55*Math.sin(phase-.43),pitch:.10+.039*Math.cos(phase),target:[-.23+.15*Math.sin(phase),1.78,0],
      liveSun:{direction:[sweep*1.1,.38+.25*Math.cos(phase),.29+.77*Math.cos(phase+.20)],
        ambient:.16,intensity:1.08,shadows:false},
      passes:['emission','emissionDepth']});
  }
  return {frame,crown,plate,editedShieldCells:trims.length};
}

function backdrop(frame) {
  const {w,h,rgb,alpha}=frame, result=new Uint8Array(rgb.length);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const p=y*w+x, a=alpha[p]/255;
    const u=(x-w*.46)/w,v=(y-h*.42)/h;
    const light=Math.max(0,1-Math.hypot(u*1.61,v*1.54));
    const floor=Math.max(0,1-Math.abs(y/h-.92)*18)*Math.max(0,1-5*Math.abs(u));
    const dither=((x&1)*2+(y&1)-1.5)*.83;
    const step=Math.floor(light*9+dither)/9;
    const bg=[8+19*step-8*floor,12+27*step-14*floor,22+29*step-16*floor];
    for (let c=0;c<3;c++) result[p*3+c]=Math.round(Math.max(0,bg[c])*(1-a)+rgb[p*3+c]*a);
  }
  return result;
}

async function run(directory) {
  const out=path.resolve(directory), frames=path.join(out,'frames'), {frame,crown,plate,editedShieldCells}=await build();
  fs.mkdirSync(frames,{recursive:true});
  const count=84;
  for (let i=0;i<count;i++) {
    const image=frame(i/count), rgb=backdrop(image);
    PNG.write(path.join(frames,String(i).padStart(3,'0')+'.png'),image.w,image.h,rgb);
    if (i===17) PNG.write(path.join(out,'vesper-guard.png'),image.w,image.h,rgb);
  }
  fs.writeFileSync(path.join(out,'render.json'),JSON.stringify({frames:count,fps:18,native:[264,208],
    helmetCells:crown.cells.filter(Boolean).length,shieldCells:plate.cells.filter(Boolean).length,editedShieldCells},null,2)+'\n');
}
if (require.main===module) run(process.argv[2]??'vesper-guard').catch(error=>{console.error(error);process.exitCode=1;});
module.exports={build,backdrop};
