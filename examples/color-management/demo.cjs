const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const Ink=require('../..');
const ColorSpace=require('../../src/color-space.js');
const ColorFiles=require('../../cli/color-management-files.js');
const PNG=require('../../cli/texture-png.js');
const assets=require('../../cli/asset-files.js');

const directory=path.resolve(process.argv[2]??'studio/out/color-management');
const at=file=>path.join(directory,file);
fs.mkdirSync(directory,{recursive:true});
const configProgram=path.join(__dirname,'make-config.py');
execFileSync(process.env.INK_OCIO_PYTHON||'python3',[configProgram,directory],{stdio:'inherit'});
const width=252,height=166;
const rgb=new Float32Array(width*height*3);
const fromDisplay=ColorSpace.prepare('srgb','srgb-linear');
const linear=hex=>fromDisplay([1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255));
const color=value=>typeof value==='string'?linear(value):value;
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const hash=(x,y)=>((Math.imul(x+193,73856093)^Math.imul(y+552,19349663))>>>0)/4294967295;
function paint(x,y,value,opacity=1,add=false){
  if(x<0||y<0||x>=width||y>=height)return;
  const i=(y*width+x)*3;
  for(let c=0;c<3;c++)rgb[i+c]=add?rgb[i+c]+value[c]*opacity:rgb[i+c]+(value[c]-rgb[i+c])*opacity;
}
function polygon(points,pigment) {
  const ink=color(pigment);
  for(let y=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1]))));y<Math.ceil(Math.max(...points.map(p=>p[1])));y++)
    for(let x=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0]))));x<Math.ceil(Math.max(...points.map(p=>p[0])));x++){
      let inside=false;
      for(let i=0,j=points.length-1;i<points.length;j=i++) {
        const [a,b]=points[i],[c,d]=points[j];
        if((b>y+.5)!==(d>y+.5) && x+.5<(c-a)*(y+.5-b)/(d-b)+a)inside=!inside;
      }
      if(inside)paint(x,y,ink);
    }
}
const rect=(x,y,w,h,ink)=>polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],ink);
function line(ax,ay,bx,by,pigment){
  const n=Math.max(Math.abs(bx-ax),Math.abs(by-ay),1), ink=color(pigment);
  for(let i=0;i<=n;i++)paint(Math.round(ax+(bx-ax)*i/n),Math.round(ay+(by-ay)*i/n),ink);
}

const deep=linear('#141d31'), sky=linear('#36435e'), paper=linear('#223b54');
for(let y=0;y<height;y++) for(let x=0;x<width;x++){
  const wash=Math.max(0,1-Math.hypot((x-123)/146,(y-95)/140));
  paint(x,y,mix(deep,sky,wash*.71));
}
for(let y=100;y<height;y++)for(let x=0;x<width;x++) {
  const v=(y-100)/80, drift=(1+Math.sin(x*.09+y*.33))* .5;
  paint(x,y,mix(paper,linear('#18283e'),.38+v*.48+drift*.12));
}
for(let i=0;i<73;i++){
  const y=102+(i*29)%62,x=(i*73)%249;
  if(y>126 || x<84 || x>176)line(x,y,x+3+(i%5)*3,y,i%8===0?'#4b7183':'#344d65');
}
polygon([[31,111],[82,85],[151,78],[207,101],[196,118],[147,146],[79,139]],'#435d70');
polygon([[31,111],[79,139],[147,146],[196,118],[188,131],[147,154],[81,148],[38,123]],'#29374e');
polygon([[59,108],[91,91],[147,89],[176,102],[161,120],[123,133],[90,125]],'#667c80');
polygon([[30,111],[81,139],[147,146],[194,120],[173,122],[145,139],[78,132],[56,119]],'#354a61');
for(const [x,y,w,h] of [[52,113,8,3],[62,117,11,3],[115,131,17,4],[132,144,10,2],[151,140,9,2],
  [159,128,7,2],[82,135,6,3],[178,110,9,3],[171,115,6,4],[58,124,8,2],[84,145,12,2],[187,101,6,3]])
  rect(x,y,w,h,'#758175');
polygon([[88,108],[112,97],[162,99],[174,109],[146,125],[93,119]],'#374957');
polygon([[90,106],[113,96],[160,97],[172,107],[146,119],[93,115]],'#87918a');
polygon([[97,104],[113,97],[150,98],[157,105],[140,113],[98,111]],'#a39c83');

polygon([[113,51],[122,43],[148,46],[158,52],[157,96],[148,105],[118,101],[110,92]],'#28394d');
polygon([[115,61],[124,58],[147,60],[154,65],[154,94],[146,101],[119,96],[114,91]],'#4a5963');
polygon([[122,67],[145,70],[145,96],[122,93]],'#697277');
polygon([[124,80],[134,82],[134,99],[123,97]],'#191f32');
line(141,78,141,94,'#a48667');line(143,78,143,94,'#a48667');
for(let i=0;i<4;i++)line(119,67+7*i,118,70+7*i,'#a19b82');
polygon([[108,52],[120,38],[149,40],[161,51],[152,61],[119,56]],'#263448');
polygon([[110,48],[119,39],[146,41],[157,49],[150,55],[119,53]],'#708286');
polygon([[113,36],[120,35],[149,37],[157,40],[157,48],[147,54],[119,51],[113,45]],'#374354');
polygon([[117,38],[147,40],[153,42],[153,47],[147,50],[119,48],[117,45]],[2.6,1.17,.31]);
polygon([[133,40],[147,40],[153,42],[153,46],[146,49],[134,47]],[6.8,3.6,1.04]);
rect(138,42,6,4,[9.4,6.4,2.86]);
line(121,38,121,48,'#48505b');line(131,39,131,49,'#5e675e');line(146,40,146,49,'#85836e');
polygon([[110,35],[119,27],[143,26],[155,34],[162,40],[149,42],[119,40]],'#233448');
polygon([[119,28],[142,27],[154,34],[151,37],[119,35]],'#607482');
rect(131,20,3,9,'#90a094');rect(132,18,1,3,[.70,1.2,1.6]);
line(96,71,96,103,'#596f79');line(96,70,112,66,'#475c6b');
line(94,74,112,69,'#788a88');line(97,86,112,81,'#758175');
line(151,91,167,99,'#92a390');line(167,88,167,105,'#60757f');
for(let y=0;y<height;y++) for(let x=0;x<width;x++){
  const dist=Math.hypot((x-138)*1.15,(y-44)*1.13), glow=Math.max(0,1-dist/42);
  if(glow)paint(x,y,[.95,.46,.12],glow**4*.26,true);
  const tide=Math.max(0,1-Math.abs(x-133)/(14+(y-117)*.3))*Math.max(0,1-Math.abs(y-141)/26);
  if(y>130&&tide>0&&hash(x,Math.floor(y/2))>.57)paint(x,y,[.64,.24,.06],tide*.20,true);
}
for(let x=155;x<238;x++){
  const opacity=(1-(x-155)/83)*.30,y=43+Math.floor((x-155)/12);
  paint(x,y,[.95,.50,.18],opacity,true);
  if(x%5!==0)paint(x,y-1,[.80,.43,.18],opacity*.43,true);
}
for(const [x,y] of [[52,37],[86,21],[175,23],[208,34],[56,62],[195,72],[225,14],[171,59]])
  paint(x,y,linear('#6b8396'),.8);

assets.write(at('beacon-linear.exr'),ColorFiles.exr({width,height,channels:3,data:rgb,alpha:'none'},ColorFiles.inkLinearTags(100)));

const config={
  config:'aces.ocio',working:'ACEScg',inkLinear:'Linear Rec.709 (sRGB)',display:'sRGB - Display',
  view:'ACES 2.0 - SDR 100 nits (Rec.709)',displayEncoding:'srgb',
  paletteView:{display:'sRGB - Display',view:'ACES 2.0 - SDR 100 nits (Rec.709)',encoding:'srgb'},
  workingChromaticities:[.713,.293,.165,.83,.128,.044,.32168,.33767],whiteNits:100,
  sources:{srgb:'sRGB Encoded Rec.709 (sRGB)','srgb-linear':'Linear Rec.709 (sRGB)',
    'display-p3':'sRGB Encoded P3-D65','display-p3-linear':'Linear P3-D65',
    'rec2020-linear':'Linear Rec.2020','rec2100-pq':'Rec.2100-PQ - Display',acescg:'ACEScg',aces2065:'ACES2065-1'}
};
const palette=['#171c2d','#252d43','#34475e','#496179','#617f91','#829e9d','#a0b7ae','#57433f',
  '#815b44','#a87748','#d49552','#edac55','#f4c570','#f9de92','#fff2c5','#fffae8'];
const plan={format:'ink-studio/color-review',version:1,label:'After the tide',colorManagement:config,
  input:{file:'beacon-linear.exr',interpretation:{intent:'color',ocio:{mode:'auto'}}},
  palette:{policy:{palette},options:{method:'solid'}},
  views:[
    {id:'aces',label:'ACES SDR',display:'sRGB - Display',view:config.view,encoding:'srgb'},
    {id:'direct',label:'Direct SDR',display:'sRGB - Display',view:'Un-tone-mapped',encoding:'srgb'},
    {id:'p3',label:'Display P3',display:'Display P3 - Display',view:'ACES 2.0 - SDR 100 nits (P3 D65)',encoding:'display-p3'},
    {id:'pq',label:'HDR PQ',display:'Rec.2100-PQ - Display',view:'ACES 2.0 - HDR 1000 nits (Rec.2020)',encoding:'rec2100-pq',
      hdr:{mastering:{chromaticities:[.708,.292,.170,.797,.131,.046,.3127,.329],minNits:.005,maxNits:1000}}}
  ],
  probes:[{label:'Beacon core',x:139,y:43},{label:'Amber glass',x:135,y:45},{label:'Shore edge',x:115,y:134},{label:'Blue shadow',x:84,y:123}]
};
assets.json(at('color-review.json'),plan);
Ink.writeColorReview(at('color-review.json'),{directory});

const paintWidth=96,paintHeight=18, pixels=new Uint16Array(paintWidth*paintHeight*3);
const swatches=[[.93,.24,.08],[.14,.64,.44],[.79,.44,.19],[.37,.52,.89]];
for(let y=0;y<paintHeight;y++) for(let x=0;x<paintWidth;x++){
  const swatch=swatches[Math.floor(x/24)], gain=y<6?.78:y<12?.9:1;
  pixels.set(swatch.map(v=>Math.round(65535*v*gain)),(y*paintWidth+x)*3);
}
const icc=fs.readFileSync(at('paint-profile.icc')).toString('base64');
assets.write(at('tagged-enamel.png'),PNG.write({width:paintWidth,height:paintHeight,channels:3,data:pixels,alpha:'none'},
  {icc,name:'P3 primaries gamma 2.2'}));
const ref=(node,port='value')=>({node,port});
const graph={format:'ink-studio/graph-project',version:1,colorManagement:config,
  assets:{
    enamel:{format:'bitmap',source:{file:'tagged-enamel.png'},interpretation:{intent:'color',ocio:{mode:'auto'}}},
    assigned:{format:'bitmap',source:{file:'tagged-enamel.png'},interpretation:{intent:'color',
      ocio:{mode:'space',space:'sRGB Encoded Rec.709 (sRGB)'}}}
  },
  nodes:{
    enamel:{op:'bitmapAsset',inputs:{name:'enamel'}},assigned:{op:'bitmapAsset',inputs:{name:'assigned'}},
    proof:{op:'color.paletteInput',inputs:{source:ref('enamel')}},
    alternate:{op:'color.paletteInput',inputs:{source:ref('assigned')}},
    palette:{op:'palette.resolve',inputs:{source:ref('proof'),policy:{palette},options:{method:'solid'}}}
  },
  outputs:{proof:ref('proof'),alternate:ref('alternate'),palette:ref('palette'),source:ref('enamel','info'),selectedView:ref('proof','report')}
};
const editable=Ink.openMaterialGraph(graph,{id:'enamel-color',baseDir:directory});
editable.label='Tagged enamel interpretation';
const file=at('enamel.material.json');
Ink.writeMaterialGraph(file,editable);
const result=Ink.readGraphProject(file).run();
const {outputs}=result;
for(const [key,name] of [['proof','icc-proof.png'],['alternate','assigned-proof.png'],['palette','icc-palette.png']])
  assets.write(at(name),ColorFiles.proof({...outputs[key],alpha:outputs[key].channels===4?'straight':'none'}));
assets.json(at('enamel-report.json'),{source:outputs.source.color,view:outputs.selectedView,outputs:result.report.outputs});
assets.write(at('enamel.html'),fs.readFileSync(path.join(__dirname,'enamel.html')));
const review=fs.readFileSync(at('index.html'),'utf8');
assets.write(at('index.html'),review.replace('</footer>','<a href="enamel.html">ICC comparison</a></footer>'));
console.log('Managed color review and editable enamel graph written to '+directory);
