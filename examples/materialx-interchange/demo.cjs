const fs=require('node:fs');
const path=require('node:path');
const Ink=require('../..');
const PNG=require('../../cli/png.js');
const Assets=require('../../cli/asset-files.js');

const root=path.resolve(process.argv[2]??'studio/out/materialx-interchange');
const samples=Number(process.argv[3]??28), width=Number(process.argv[4]??392);
const action=process.argv[5]??'all';
const at=name=>path.join(root,name);
const kit=Ink.load(), P=kit.KIT.procedural;
const ref=(node,port='value')=>({node,port});
const w=192,h=160;

function panelMaps(){
  const palette={night:[9,31,42],blue:[20,71,89],wash:[26,94,107],brass:[183,129,65],
    cream:[221,181,113],light:[241,228,165],mint:[119,175,162],line:[55,118,124]};
  const font={P:['111','101','111','100','100'],I:['111','010','010','010','111'],
    E:['111','100','110','100','111'],R:['110','101','110','101','101'],'0':['111','101','101','101','111'],
    '7':['111','001','010','010','010'],T:['111','010','010','010','010'],
    D:['110','101','101','101','110']};
  const letters=new Set();
  function type(text,x,y,s){
    for(const [k,char] of [...text].entries()) if(font[char])
      for(const [j,line] of font[char].entries()) for(let i=0;i<3;i++) if(line[i]==='1')
        for(let dy=0;dy<s;dy++) for(let dx=0;dx<s;dx++) letters.add((y+j*s+dy)*w+x+k*4*s+i*s+dx);
  }
  type('PIER',22,25,3); type('07',136,118,3); type('TIDE',23,120,2);
  const surface=new Uint8Array(w*h*3), metal=new Uint8Array(w*h), rough=new Uint8Array(w*h);
  const light=new Float32Array(w*h), relief=new Float32Array(w*h), film=new Float32Array(w*h);
  for(let y=0,p=0;y<h;y++)for(let x=0;x<w;x++,p++){
    const dx=(x-115)*.96, dy=y-78, radius=Math.hypot(dx,dy);
    const boundary=Math.min(x,y,w-1-x,h-1-y);
    const rivet=[[12,12],[179,12],[12,147],[179,147]].some(([rx,ry])=>Math.hypot(x-rx,y-ry)<3.6);
    const frame=(boundary>=6&&boundary<=8)||(boundary>=13&&boundary<=14);
    const wave=dy>0&&dy<21&&x>22&&x<165&&Math.abs(dy-12-5*Math.sin(x*.15))<1.5;
    const fine=dy>0&&dy<25&&x>28&&x<151&&Math.abs(dy-18-4*Math.sin(x*.15))<.8;
    const meter=radius>31&&radius<34&&dy<-2;
    const meterTail=radius>35&&radius<38&&dy<-2&&dx>5;
    const tick=radius>25&&radius<29&&dy<-3&&Math.abs(Math.sin(Math.atan2(dy,dx)*22))<.28;
    const lightUp=meterTail||x>150&&x<168&&y>29&&y<37;
    const text=letters.has(p);
    const grain=.65*Math.sin(x*.84+y*1.1)*Math.sin(x*.37-y*.47)+.35*Math.sin(x*.14+y*.17);
    const bright=Math.min(1,Math.max(0,1-y/h+.1*Math.sin(x*.04)));
    let pigment=palette.blue.map((n,i)=>n+(palette.wash[i]-n)*bright*.78);
    if(boundary<13) pigment=palette.night;
    if(frame||rivet||tick||text) pigment=text||rivet?palette.cream:palette.brass;
    if(wave||meter||fine) pigment=wave?palette.mint:palette.line;
    if(lightUp) pigment=palette.light;
    surface.set(pigment.map(n=>Math.min(255,Math.max(0,Math.round(n+grain*(frame?3:2))))),p*3);
    metal[p]=frame||rivet||text||tick?223:16;
    rough[p]=frame||rivet||text?95:Math.round(128+17*grain);
    light[p]=lightUp?217:0;
    relief[p]=(text||rivet?.022:frame||wave||meter?.013:0)+grain*.003;
    film[p]=.33+.25*y/h+.046*Math.sin(x*.08);
  }
  const assets={},nodes={};
  function asset(id,bytes,extension,interpretation){
    const file=id+'.'+extension;
    Assets.write(at(file),bytes);
    assets[id]={format:'bitmap',source:{file},interpretation:{sampling:'linear',...interpretation}};
    nodes[id]={op:'bitmapAsset',inputs:{name:id}};
  }
  asset('enamel',PNG.encode(w,h,surface),'png',{intent:'color',colorSpace:'srgb'});
  for(const [name,data] of [['metal',metal],['rough',rough]]) asset(name,PNG.encodeGray(w,h,data),'png',{intent:'mask'});
  for(const [name,data,intent,units] of [['relief',relief,'height','mm'],['lamp',light,'data','nits'],['film',film,'data','um']]) {
    const image=P.graphImages.declare({width:w,height:h,channels:1,data},{intent,units});
    asset(name,Ink.encodeTexture(image,{encoding:'exr',bitDepth:32}),'exr',{intent,units});
  }
  nodes.reliefNormal={op:'image.heightToNormal',inputs:{source:ref('relief'),options:{method:'sobel',spacing:[.14,.14],strength:2.1}}};
  nodes.maps={op:'data.record',inputs:{base_color:ref('enamel'),base_metalness:ref('metal'),specular_roughness:ref('rough'),
    geometry_normal:ref('reliefNormal'),emission_luminance:ref('lamp'),thin_film_thickness:ref('film')}};
  nodes.surface={op:'material.openPbr',inputs:{parameters:{base_diffuse_roughness:.23,coat_weight:.84,coat_roughness:.21,
    coat_roughness_anisotropy:.27,coat_color:[.95,.94,.87],coat_ior:1.44,specular_weight:.83,
    specular_roughness_anisotropy:.43,thin_film_weight:.18,thin_film_ior:1.7,
    emission_color:[.74,1.01,.52],geometry_coat_tangent:[0,1,0]},maps:ref('maps')}};
  const editable=Ink.openMaterialGraph({format:'ink-studio/graph-project',version:1,assets,nodes,
    outputs:{surface:ref('surface'),report:ref('surface','report')}},{id:'pier-relay'});
  editable.label='Pier Relay enamel';
  Ink.writeMaterialGraph(at('pier-relay.material.json'),editable);
}

function panelMesh() {
  const outline=[[-1.11,-.75],[1.11,-.75],[1.17,-.68],[1.17,.68],[1.10,.75],[-1.10,.75],[-1.17,.68],[-1.17,-.68]];
  const vertices=[],coords=[],n=outline.length;
  for(const [z,scale] of [[-.21,.91],[-.17,1],[.10,1],[.17,.95]]) {
    for(const [x,y] of outline){
      vertices.push('v '+[x*scale,y*scale,z].join(' '));
      coords.push('vt '+[.5+x/2.34,.5+y/1.5].join(' '));
    }
  }
  const token=i=>[i+1,i+1].join('/'), face=(indices,slot)=>['usemtl '+slot,'f '+indices.map(token).join(' ')];
  const faces=[...face([...outline.keys()].reverse(),'housing'),...face(outline.map((_,i)=>3*n+i),'enamel')];
  for(let j=0;j<3;j++) for(let i=0;i<n;i++){
    const a=j*n+i,b=j*n+(i+1)%n;
    faces.push(...face([a,b,b+n,a+n],'housing'));
  }
  Assets.write(at('relay.obj'),[...vertices,...coords,...faces].join('\n')+'\n');
}

function renderPlan(id,graph){
  const common={
    format:'ink-studio/physical-reference',version:1,label:'Pier Relay · '+id,
    view:{width,height:Math.round(width*.65)},
    settings:{quality:'studio',samples,batch:samples,bounces:4,seed:102482,denoise:'strong',exposure:.23},
    camera:{target:[0,.93,0],yaw:14,pitch:9,distance:6.5,focalLength:55},
    environment:{color:[.19,.31,.43],strength:.35,background:false},
    materials:{
      enamel:{graph:{file:graph,output:'surface'}},housing:{openPbr:{base_color:[.37,.184,.062],
        base_metalness:.93,specular_roughness:.32,specular_roughness_anisotropy:.71}},
      floor:{baseColor:[.036,.073,.098],roughness:.38},wall:{baseColor:[.021,.057,.077],roughness:.81},
      mount:{baseColor:[.053,.068,.072],roughness:.29,metalness:.45},
      key:{baseColor:[0,0,0],emission:[7.8,6.3,4.8]},rim:{baseColor:[0,0,0],emission:[4.8,8,11.4]}
    },
    meshes:[
      {id:'floor',kind:'plane',material:'floor',position:[0,0,0],rotation:[-90,0,0],scale:[8,8,1]},
      {id:'wall',kind:'plane',material:'wall',position:[0,2.8,-2.65],scale:[9,7,1]},
      {id:'box',kind:'mesh',file:'relay.obj',slots:{enamel:'enamel',housing:'housing'},position:[0,1.01,0],
        rotation:[-5,-3,4]},
      {id:'stand',kind:'cube',material:'mount',position:[0,.175,-.02],scale:[1.14,.17,.53]},
      {id:'step',kind:'cube',material:'housing',position:[0,.358,-.01],scale:[1.03,.018,.39]},
      {id:'key',kind:'plane',material:'key',position:[-2.7,3.63,2.24],scale:[1.2,1.27,1],rotation:[141,-27,7]},
      {id:'rim',kind:'plane',material:'rim',position:[2.62,2.59,1.39],scale:[.59,1.36,1],rotation:[26,-102,0]}
    ]
  };
  Assets.json(at(id+'.plan.json'),common);
}

async function prepare(){
  panelMaps();panelMesh();
  const exported=await Ink.exportMaterialX(at('pier-relay.material.json'),{output:'surface',out:at('pier-relay.mtlx'),strict:true});
  if(exported.status!=='written') throw new Error('MaterialX export could not independently reproduce the evaluated maps');
  const imported=Ink.importMaterialX(at('pier-relay.mtlx'),{directory:at('imported'),strict:true});
  if(imported.status!=='written') throw new Error('The exported surface did not reimport');
  renderPlan('source','pier-relay.material.json');
  renderPlan('reopened','imported/'+imported.files[0].file);

  const doc=fs.readFileSync(at('pier-relay.mtlx'),'utf8');
  const unsupported=doc.replace(/<input name="coat_roughness"[^>]*\/>/,'<input name="coat_roughness" type="float" nodename="live_weather" />')
    .replace('</materialx>','  <noise3d name="live_weather" type="float" />\n</materialx>');
  Assets.write(at('live-weather.mtlx'),unsupported);
  const loss=Ink.importMaterialX(at('live-weather.mtlx'),{directory:at('partial')});
  const strict=Ink.importMaterialX(at('live-weather.mtlx'),{directory:at('strict'),strict:true});
  if(!loss.entries.some(row=>row.input==='coat_roughness'&&row.status==='dropped')||strict.status!=='blocked')
    throw new Error('The unsupported live shader did not produce a loss report');
}

function review(){
  const read=filename=>JSON.parse(fs.readFileSync(at(filename),'utf8'));
  const source=PNG.read(at('source/denoised.png')), reopened=PNG.read(at('reopened/denoised.png'));
  const delta=new Uint8Array(source.rgb.length);
  let maxDifference=0, changed=0,total=0;
  for(let i=0;i<source.rgb.length;i+=3){
    let pixel=0;
    for(let c=0;c<3;c++) {
      const gap=Math.abs(source.rgb[i+c]-reopened.rgb[i+c]);
      delta[i+c]=Math.min(255,gap*16);
      maxDifference=Math.max(maxDifference,gap);
      total+=gap; pixel|=gap;
    }
    if(pixel) changed++;
  }
  Assets.write(at('difference.png'),PNG.encode(source.w,source.h,delta));
  const exported=read('pier-relay.mtlx.report.json'), imported=read('imported/materialx-report.json');
  const report={exported,imported,partial:read('partial/materialx-report.json'),strict:read('strict/materialx-report.json'),
    render:{width:source.w,height:source.h,maxDifference,changed,meanDifference:total/source.rgb.length}};
  Assets.json(at('comparison.json'),report);
  const html=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
  Assets.write(at('index.html'),html.replace('/*PIER_REPORT*/',()=>JSON.stringify(report).replaceAll('<','\\u003c')));
  console.log(JSON.stringify(report.render));
}

async function main(){
  if(action==='review') return review();
  if(action==='prepare'||action==='all') await prepare();
  if(action==='prepare') return;
  const list=action==='all'?['source','reopened']:[action];
  for(const id of list) {
    if(!['source','reopened'].includes(id)) throw new TypeError('Choose prepare, source, reopened, review or all');
    const report=await Ink.writePhysicalReference(at(id+'.plan.json'),{directory:at(id),toolkit:kit});
    console.log(id+' · '+report.totalSamples+' spp');
  }
  if(action==='all') review();
}
main().catch(error=>{ console.error(error);process.exitCode=1; });
