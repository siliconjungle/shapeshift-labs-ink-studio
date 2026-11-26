'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const PNG = require('../../cli/png.js');

function scene() {
  const box = (id, at, half, mat)=>({id,kind:'box',at,half,mat});
  const canopy = x=>[
    box('roof',[x,1.06,0],[.63,.09,.65],'ember'),
    ...[-.54,.54].flatMap((dx,i)=>[-.52,.52].map((z,j)=>
      box('leg-'+i+'-'+j,[x+dx,.54,z],[.065,.54,.065],'dark')))
  ];
  return {
    id:'courtyard-shadows',style:'slate',seed:7,
    camera:{target:[0,.24,0],yaw:-.23,pitch:.78,dist:6.8,sway:0,projection:'orthographic'},
    finish:{dither:0,liveSun:{direction:[.72,1,-.3],ambient:.26,intensity:.98,filter:0}},
    solids:[
      box('west-floor',[-1.3,-.11,0],[1.25,.12,1.65],'stone'),
      box('east-floor',[1.3,-.11,0],[1.25,.12,1.65],'stone'),
      ...canopy(-1.32).map(solid=>({...solid,id:'west-'+solid.id})),
      ...canopy(1.32).map(solid=>({...solid,id:'east-'+solid.id})),
      ...[-1,1].flatMap(side=>[0,1,2,3].map(i=>
        box((side===1?'east':'west')+'-paver-'+i,[1.3*side,-.003,1.13+i*.18],[1.17,.02,.075],i%2?'pale':'stone')))
    ]
  };
}

const bounds = {min:[-2.8,-2.1],max:[2.8,2.1]};
const request = {
  object:'west-roof',flags:{cast:false},light:{type:'sun'},map:{bounds,bias:.035,mapSize:192}
};
const view = {w:196,h:138,raw:true};

function run(directory) {
  fs.mkdirSync(directory,{recursive:true});
  const write = (name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2)+'\n');
  write('courtyard.json',scene());
  write('west-roof-request.json',request);
  write('east-floor-request.json',{object:'east-floor',flags:{receive:false}});
  write('view.json',view);
  const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
  function edit(source, input, output, preview) {
    const args = ['mesh-topology','shadow-controls',source,input,'--preview',preview,'--view','view.json','--out',output];
    const receipt = execFileSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
    write(preview+'-receipt.json',JSON.parse(receipt));
  }
  edit('courtyard.json','west-roof-request.json','west-roof.json','Cast');
  edit('west-roof.json','east-floor-request.json','east-floor.json','Receive');

  const {w,h} = view, columns = ['Cast/before.png','Cast/after.png','Receive/after.png'];
  const gap = 4, width = w*columns.length+gap*(columns.length-1), rgb = new Uint8Array(width*h*3).fill(21);
  columns.forEach((file,column)=>{
    const {rgb:panel} = PNG.read(path.join(directory,file));
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const from=(y*w+x)*3,to=(y*width+column*(w+gap)+x)*3;
      rgb.set(panel.subarray(from,from+3),to);
    }
  });
  fs.writeFileSync(path.join(directory,'Courtyard-shadows.png'),PNG.encode(width,h,rgb));
}

if (require.main===module) run(path.resolve(process.argv[2] ?? 'object-shadows-preview'));
module.exports = {scene,request,view};
