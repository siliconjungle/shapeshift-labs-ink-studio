/* An enamel signal panel with one retained cable and four socket attachments. */
const assert = require('node:assert/strict');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');

function fixture(K) {
  const api=K.curve.retained;
  return api.create({ format:api.format,version:1,id:'signal-panel',splines:[{
    id:'signal', up:[.03,1,.24],points:[
      {id:'inlet',position:[-3.03,-.32,.22],outHandle:[.85,-.07,.09],radius:.13,tilt:.43},
      {id:'shoulder',position:[-1.62,.66,.36],inHandle:[-.6,0,-.07],outHandle:[.68,0,.06],radius:.16,tilt:.5},
      {id:'elbow',position:[.11,-.59,.37],inHandle:[-.75,.05,0],outHandle:[.72,-.05,.03],radius:.15,tilt:.55},
      {id:'ridge',position:[1.78,.59,.42],inHandle:[-.65,.03,-.02],outHandle:[.59,-.04,-.08],radius:.19,tilt:.27},
      {id:'outlet',position:[3.03,-.27,.22],inHandle:[-.55,.08,.07],radius:.13,tilt:.35}
    ],
    segments:[
      {id:'sweep',from:'inlet',to:'shoulder'},{id:'drop',from:'shoulder',to:'elbow'},
      {id:'rise',from:'elbow',to:'ridge'},{id:'outfeed',from:'ridge',to:'outlet'}
    ]
  }],attachments:[
    {id:'red-sensor',spline:'signal',segment:'sweep',t:.59},
    {id:'amber-sensor',spline:'signal',segment:'drop',t:.31},
    {id:'teal-sensor',spline:'signal',segment:'drop',t:.83},
    {id:'blue-sensor',spline:'signal',segment:'outfeed',t:.62}
  ]});
}

const stages=[
  ['Original cable','FOUR SOCKETS ON ONE RETAINED ROUTE','#8fe0c6'],
  ['Split the drop','TWO ROUTES SHARE THE SAME CUT POSITION','#ffd28b'],
  ['Rejoin the runs','FOUR SOCKETS KEEP THEIR WORLD POSITIONS','#8fe0c6'],
  ['Reshape the elbow','HANDLES, RADIUS AND TILT EDITED IN PLACE','#ffd28b']
];
const w=216,h=108;
const camera={target:[0,.03,0],dist:6.65,yaw:.05,pitch:.11,ortho:true};
const palette=[0x0d1823,0x152636,0x203849,0x2e4b5b,0x486776,0x709091,
  0x6c4b39,0x9b6347,0xd0915c,0xfac484,0xf8e4ad,0xeb7661,0xf7c370,0x65dbc3,0x8db8ee];
const tokens=['#eb7661','#f7c370','#65dbc3','#8db8ee'];

function native(kit, document, outputs, label, seam) {
  const {KIT:K,makeBuilder,makeSculpt}=kit, api=K.curve.retained;
  const builder=makeBuilder(30,palette), S=K.sculpt(makeSculpt(builder));
  Object.assign(S,{sun:K.V.norm([-.43,.8,1]),amb:.47,sky:.12,sunK:.47,wob:0});
  const box=(p,size,r,res,rd)=>S.box(p,size,{r},{res,rd});
  box([0,0,-.17],[3.51,1.21,.11],[1,2,3,4],.075,.095);
  box([0,0,-.065],[3.40,1.11,.05],[1,2,3,4],.065,.085);
  for (const y of [-.97,.97]) {
    box([0,y,.035],[3.25,.013,.013],[1,2,4],.051,.009);
    for (const x of [-3.19,3.19]) {
      box([x,y,.056],[.075,.068,.029],[2,3,4,5],.035,.02);
      box([x,y,.083],[.047,.008,.008],[1,2,3],.024,.006);
    }
  }
  for (const x of [-3.2,3.2]) {
    box([x,-.28,.083],[.17,.23,.18],[2,4,5],.048,.045);
    box([x,-.28,.255],[.08,.13,.025],[6,7,8,9],.032,.021);
    for(const y of [-.78,.76]) box([x,y,.045],[.072,.028,.021],[3,4,5],.043,.012);
  }
  for (const [i,{p:[x,y,z]}] of api.inspect(document).attachments.entries()) {
    const pin=[x,y,z+.12];
    box(pin,[.091,.162,.045],[2,4,5],.032,.025);
    for(const d of [-.122,.122]) box([x,y+d,z+.156],[.067,.021,.023],[7,8,9,10],.025,.012);
    S.ball([x,y,z+.179],[.048,.052,.026],{r:[11+i],em:true},{res:.020});
  }
  if (seam) {
    const [x,y,z]=document.splines[0].points.find(row=>row.id==='junction').position;
    S.ball([x,y,z+.10],[.047,.047,.022],{r:[10],em:true},{res:.019});
  }
  S.bake();
  const lighting={diffuse:.6,sheen:.55,specular:.34,roughness:.61,anisotropy:.45};
  K.curveSplats.draw(builder,[[-3.16,-.82,.038],[3.16,-.82,.038]],{edge:'hard',radius:.019,color:'#8c7856'});
  for (const spline of document.splines) {
    const color=spline.id==='signal' ? '#54b5a8' : '#e8a360';
    K.curveSplats.draw(builder,api.compile(document,spline.id),{
      color,section:'flattened',aspect:.36,edge:'hard',caps:'blunt',lighting,object:spline.id
    });
  }
  const world=builder.finish({cam:camera,radius:5,dither:0,look:{pixelSize:1},
    liveSun:{direction:[-.55,.8,1],intensity:.82,shadows:false}});
  const frame=ink.render(world,{w,h,px:1,t:0,raw:true,camera,edges:false});
  files.write(path.join(outputs,label+'.png'),PNG.encode(w,h,frame.rgb));
  return frame;
}

function board(K, frames, maxDelta) {
  const width=928,height=691,scale=2,commands=[];
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const text=(label,x,y,scale,color='#e7efe8')=>commands.push({type:'text',text:label,at:[x,y],scale,color});
  rect(0,0,width,height,'#0d1823');
  rect(22,21,18,3,'#81dbc2');
  text('INK STUDIO / RETAINED SPLINES',52,16,2,'#8fe0c6');
  text('Signal panel cable',21,43,4);
  text('MATCHED 216 X 108 NATIVE RENDERS',22,82,1,'#a4bdcb');
  for (const [i,[label,note,color]] of stages.entries()) {
    const x=22+i%2*452,y=108+Math.floor(i/2)*271;
    text(label,x,y,2,color);
    text(note,x,y+19,1,'#9eb7c4');
    rect(x-1,y+32,w*scale+2,h*scale+2,'#3a5969');
  }
  rect(22,641,884,1,'#294455');
  tokens.forEach((color,i)=>rect(22+i*13,656,7,7,color));
  text('RETAINED SOCKET IDS',85,656,1,'#bfd0d7');
  text('MAX SPLIT / REJOIN DRIFT '+maxDelta.toExponential(1).toUpperCase()+' WORLD UNITS',494,656,1,'#bfd0d7');
  const image=K.procedural.drawing2d.render({width,height,commands,edges:'hard'});
  for (const [i,frame] of frames.entries()) {
    const x=22+i%2*452,y=141+Math.floor(i/2)*271;
    for (let r=0;r<h*scale;r++) for (let c=0;c<w*scale;c++) {
      const from=(Math.floor(r/scale)*w+Math.floor(c/scale))*3, to=((y+r)*width+x+c)*4;
      image.data.set(frame.rgb.subarray(from,from+3),to);
    }
  }
  return PNG.encodeFrame(PNG.packRGBA(image));
}

function run(directory) {
  const kit=ink.load(), {KIT:K}=kit, api=K.curve.retained, source=fixture(K);
  const stages=[source], receipts=[];
  const edits=[
    ['split', [{op:'split',segment:'drop',t:.60,point:'junction',rightSegment:'drop-tail',
      newSpline:'return',newStart:'return-start'}]],
    ['join', [{op:'join',first:'signal',second:'return',firstEnd:1,secondEnd:0}]],
    ['reshape', [
      {op:'set-point',point:'elbow',position:[.27,-.80,.45],inHandle:[-.50,.72,.12],outHandle:[.86,-.18,.10],radius:.27,tilt:1.32},
      {op:'set-point',point:'ridge',inHandle:[-.62,-.39,-.1],radius:.22,tilt:1.01}
    ]]
  ];
  files.json(path.join(directory,'original.json'),source);
  for(const [name,operations] of edits) {
    const before=stages.at(-1), request={revision:api.revision(before),operations}, result=api.plan(before,request);
    stages.push(result.document);
    receipts.push(result.report);
    files.json(path.join(directory,name+'-edit.json'),request);
    files.json(path.join(directory,name+'-receipt.json'),result.report);
    files.json(path.join(directory,name+'.json'),result.document);
  }
  const maxDelta=Math.max(...receipts.slice(0,2).flatMap(row=>row.attachments.map(a=>a.positionDelta)));
  assert(maxDelta<1e-10);
  const frames=stages.map((doc,i)=>native(kit,doc,directory,['original','split','join','reshape'][i],i===1));
  files.write(path.join(directory,'comparison.png'),board(K,frames,maxDelta));
  console.log(directory);
}

module.exports={fixture};
if (require.main===module) run(path.resolve(process.argv[2] ?? 'studio/out/retained-splines'));
