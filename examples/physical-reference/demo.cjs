const path=require('node:path');
const Ink=require('../..');
const PNG=require('../../cli/png.js');
const files=require('../../cli/asset-files.js');

const directory=path.resolve(process.argv[2]??'studio/out/physical-reference');
const samples=Number(process.argv[3]??64), width=Number(process.argv[4]??336);
const at=name=>path.join(directory,name);
const tau=2*Math.PI;
const { KIT }=Ink.load(), P=KIT.procedural;
const clamp=n=>Math.max(0,Math.min(1,n));
const mix=(a,b,t)=>a.map((n,i)=>Math.round(n+(b[i]-n)*clamp(t)));

function lathe(name,profile,sides=80,shade=true) {
  const vertices=[],uv=[],normals=[],faces=[];
  for(const [j,[y,r]] of profile.entries()) {
    const [y0,r0]=profile[Math.max(0,j-1)], [y1,r1]=profile[Math.min(profile.length-1,j+1)];
    for(let i=0;i<=sides;i++) {
      const u=i/sides, angle=u*tau;
      const x=Math.sin(angle),z=Math.cos(angle);
      vertices.push('v '+[r*x,y,r*z].map(n=>n.toFixed(7)).join(' '));
      uv.push('vt '+(u)+' '+(y/profile.at(-1)[0]));
      normals.push('vn '+[x*(y1-y0),r0-r1,z*(y1-y0)].map(n=>n.toFixed(7)).join(' '));
    }
  }
  const at=(j,i)=>1+j*(sides+1)+i;
  for(let j=1;j<profile.length;j++) for(let i=0;i<sides;i++) {
    const a=at(j-1,i), b=a+1,d=at(j,i),c=d+1;
    const token=n=>shade?n+'/'+n+'/'+n:n+'/'+n;
    if(profile[j-1][1]>0)faces.push('f '+[a,b,c].map(token).join(' '));
    if(profile[j][1]>0)faces.push('f '+[a,c,d].map(token).join(' '));
  }
  files.write(path.join(directory,name),[...vertices,...uv,...(shade?normals:[]),'usemtl body',...faces].join('\n')+'\n');
  return name;
}
const vessel=lathe('glazed-vessel.obj',[[0,0],[0,.36],[.045,.43],[.11,.452],[.25,.487],
  [.39,.539],[.56,.586],[.74,.6],[.93,.565],[1.10,.469],[1.22,.343],[1.29,.235],
  [1.34,.206],[1.393,.206],[1.405,.257],[1.44,.269],[1.468,.238],[1.475,0]],96);
const glass=lathe('pressed-glass.obj',[[0,0],[0,.237],[.036,.34],[.085,.371],[.17,.382],
  [.93,.382],[1.13,.335],[1.27,.21],[1.39,.157],[1.52,.154],[1.555,.183],[1.591,.183],[1.61,.151],[1.61,0]],14,false);
const plinth=lathe('blue-stone-plinth.obj',[[0,0],[0,.72],[.018,.765],[.075,.788],[.172,.788],
  [.192,.765],[.203,.68],[.203,0]],56,false);
const goldCuff=lathe('brass-cuff.obj',[[0,0],[0,.178],[.027,.19],[.135,.19],[.158,.167],[.158,0]],48);
const insulator=lathe('insulator.obj',[[0,0],[0,.37],[.055,.411],[.09,.401],[.14,.347],[.165,.31],[.187,.314],
  [.22,.366],[.25,.37],[.268,.32],[.289,.285],[.31,.287],[.33,.33],[.36,.34],[.39,.31],[.405,0]],72);

const w=384,h=256, pixels=new Uint8Array(w*h*3), relief=new Float32Array(w*h);
const metallic=new Uint8Array(w*h), rough=new Uint8Array(w*h);
const near=(n,v,d)=>Math.abs(n-v)<d;
for(let y=0,p=0;y<h;y++)for(let x=0;x<w;x++,p++) {
  const u=(x+.5)/w,v=(y+.5)/h;
  const grain=.55*Math.sin(x*1.8+y*1.52)*Math.sin(y*1.81-x)+.45*Math.sin(u*62-v*110);
  const f=.5+.23*Math.sin(u*tau*9+Math.sin(v*18))+.17*Math.sin(v*67+u*tau*13);
  let color=mix([18,50,100],[48,109,174],f);
  const stripe=[.07,.105,.144,.67,.699,.746,.864,.896].some(q=>near(v,q,.0044));
  const belt=v>.69&&v<.754;
  const leaf=Math.sin(u*tau*9+Math.sin((v-.27)*18)*1.32);
  const fern=v>.20&&v<.64&&
    (near(Math.abs(leaf),.2,.045)||near(Math.abs(leaf),.70,.045)&&Math.sin(v*138+u*tau*9)>.42);
  const glazeSpot=Math.abs(Math.sin(u*tau*23)*Math.cos(v*124))>.865&&v>.28&&v<.66;
  const inlay=stripe||(belt&&Math.abs(Math.cos(u*tau*22))>.73);
  if(belt)color=mix([24,33,69],[53,65,100],f);
  if(fern)color=mix([48,86,144],[136,177,180],.36+f*.38);
  if(glazeSpot)color=mix(color,[140,175,205],.27);
  if(inlay)color=mix([140,72,32],[237,170,90],.32+f*.6);
  pixels.set(color.map(n=>Math.min(255,Math.max(0,Math.round(n+grain*(inlay?7:4))))),p*3);
  relief[p]=grain*.004+(inlay?.062:fern?.023:0);
  rough[p]=Math.round(255*(inlay?.25:.27+.14*f+grain*.06));
  metallic[p]=inlay?220:0;
}
const heightMap=P.graphImages.declare({width:w,height:h,channels:1,data:relief},{intent:'height',units:'mm'});
const assets={}, nodes={}, ref=node=>({node,port:'value'});
for(const [id,bytes,interpretation,encoding] of [
  ['pigment',PNG.encode(w,h,pixels),{intent:'color'},'png'],
  ['height',Ink.encodeTexture(heightMap,{encoding:'exr'}),{intent:'height',units:'mm'},'exr'],
  ['roughness',PNG.encodeGray(w,h,rough),{intent:'mask'},'png'],
  ['metalness',PNG.encodeGray(w,h,metallic),{intent:'mask'},'png']
]) {
  assets[id]={format:'bitmap',interpretation,source:{encoding,base64:bytes.toString('base64')}};
  nodes[id]={op:'bitmapAsset',inputs:{name:id}};
}
nodes.normal={op:'image.heightToNormal',inputs:{source:ref('height'),options:{spacing:[.23,.25],strength:.77,method:'sobel'}}};
nodes.maps={op:'data.record',inputs:{baseColor:ref('pigment'),normal:ref('normal'),roughness:ref('roughness'),metalness:ref('metalness')}};
nodes.glaze={op:'material.pack',inputs:{maps:ref('maps')}};
const graph={format:'ink-studio/graph-project',version:1,assets,nodes,outputs:{glaze:ref('glaze')}};
const editable=Ink.openMaterialGraph(graph,{id:'etched-cobalt'});
editable.label='Etched cobalt';
Ink.writeMaterialGraph(at('etched-cobalt.material.json'),editable);

const mesh=(id,file,material,position,scale=[1,1,1],rotation=[0,0,0])=>({id,kind:'mesh',file,material,position,scale,rotation});
const floor={id:'floor',kind:'plane',material:'floor',position:[0,0,0],rotation:[-90,0,0],scale:[9,12,1]};
const wall={id:'wall',kind:'plane',material:'wall',position:[0,3,-2.12],scale:[9,6.0,1]};
const plan={format:'ink-studio/physical-reference',version:1,label:'Kiln & Prism',
  view:{width,height:Math.round(width*.64)},settings:{quality:'final',samples,batch:Math.min(samples,8),denoise:'strong',bounces:7,seed:39212,exposure:.05},
  camera:{target:[.04,.87,0],yaw:13,pitch:10,distance:8.2,focalLength:58},
  environment:{color:[.10,.14,.22],strength:.37,background:false},
  materials:{
    floor:{baseColor:[.056,.084,.13],roughness:.24,metalness:.2},
    wall:{baseColor:[.032,.071,.096],roughness:.66},
    plinth:{baseColor:[.028,.049,.078],roughness:.38,metalness:.25},
    cobalt:{graph:{file:'etched-cobalt.material.json',output:'glaze'}},
    glass:{glass:{ior:1.49,absorption:[.54,.13,.095]}},
    brass:{baseColor:[.83,.47,.186],roughness:.24,metalness:1},
    copper:{baseColor:[.77,.37,.19],roughness:.20,metalness:1},
    amber:{baseColor:[.23,.10,.034],emission:[2.5,.78,.20],twoSidedEmission:true},
    key:{baseColor:[0,0,0],emission:[13,10.0,7.8]},
    fill:{baseColor:[0,0,0],emission:[6.1,9.9,17.5]},
    rim:{baseColor:[0,0,0],emission:[8,6.8,5.0]}
  },
  meshes:[
    floor,wall,
    mesh('vessel-plinth',plinth,'plinth',[-1.015,0,.20],[1.12,1.03,1.12]),
    mesh('bottle-plinth',plinth,'plinth',[.47,0,.035],[.72,.76,.72]),
    mesh('copper-plinth',plinth,'plinth',[1.37,0,.58],[.58,.62,.58]),
    mesh('cobalt-vessel',vessel,'cobalt',[-1.015,.207,.20],[1.05,1.12,1.05],[0,23,0]),
    mesh('bottle',glass,'glass',[.47,.151,.035],[1.05,1.09,1.05],[0,-11,0]),
    mesh('bottle-cap',goldCuff,'brass',[.47,1.883,.035],[1.04,.96,1.04]),
    mesh('insulator',insulator,'brass',[1.37,.125,.58],[.78,.83,.78]),
    {id:'copper-sphere',kind:'sphere',material:'copper',position:[1.37,.746,.58],scale:[.346,.346,.346]},
    {id:'backline',kind:'cube',material:'amber',position:[.32,1.16,-1.97],scale:[1.14,.012,.027]},
    {id:'key',kind:'plane',material:'key',position:[-3.25,4.1,3.4],rotation:[145,-35,0],scale:[1.48,1.65,1]},
    {id:'fill',kind:'plane',material:'fill',position:[3.25,2.30,1.32],rotation:[22,-115,0],scale:[.49,1.70,1]},
    {id:'rim',kind:'plane',material:'rim',position:[1.23,3.52,-1.08],rotation:[79,0,-10],scale:[.75,.77,1]}
  ]
};
files.json(at('kiln-and-prism.plan.json'),plan);
Ink.writePhysicalReference(at('kiln-and-prism.plan.json'),{directory}).then(report=>
  console.log(JSON.stringify({file:report.file,samples:report.totalSamples,stats:report.stats})))
  .catch(error=>{console.error(error);process.exitCode=1;});
