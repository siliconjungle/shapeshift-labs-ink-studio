/* Generate two original Ink sequences with different ignition timings. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ink = require('..');
const PNG = require('../cli/png.js');

const output = path.resolve(process.argv[2] ?? 'rose-engine-review');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-rose-engine-'));
try {
  const atlas = require('./pixel-effects-atlas')(ink.load());
  const rocket = atlas.find(study=>study.id==='thrust');
  const reference = { directory:'reference',label:'Rose Engine · fast pass',fps:18,startFrame:10 };
  const candidate = { directory:'candidate',label:'Rose Engine · held ignition',fps:24,startFrame:100 };
  const referenceTimes = [[0,0],[5,.20],[9,.36],[16,.68],[25,1]];
  const candidateTimes = [[0,0],[9,.20],[19,.36],[34,.68],[52,1]];
  function shoot(track,times,cool) {
    const directory = path.join(root,track.directory);
    fs.mkdirSync(directory);
    for(let i=0;i<times.at(-1)[0];i++) {
      const j=times.findIndex(([frame])=>frame>i);
      const [a,from]=times[j-1], [b,to]=times[j];
      const {width,height,data}=rocket.render(from+(to-from)*(i-a)/(b-a));
      if(cool)for(let p=0;p<data.length;p+=4) {
        const red=data[p], green=data[p+1], blue=data[p+2];
        if(red>112 && green<204){
          // Pale violet pressure echoes make the heat treatment easy to compare.
          data[p]=Math.round(red*.89);
          data[p+1]=Math.min(255,Math.round(green*.90+7));
          data[p+2]=Math.min(255,Math.round(blue*.87+red*.30));
        }
      }
      fs.writeFileSync(path.join(directory,'frame-'+i+'.png'),PNG.encode(width,height,data,4));
    }
  }
  shoot(reference,referenceTimes,false);
  shoot(candidate,candidateTimes,true);
  const plan={
    format:'ink-studio/reference-clip-review',version:1,title:'Rose Engine · ignition study',
    reference,candidate,
    beats:[
      {id:'first-ring',label:'First pressure ring',reference:15,candidate:109},
      {id:'ignition',label:'Ignition',reference:19,candidate:119},
      {id:'falloff',label:'Falloff',reference:26,candidate:134}
    ],
    notes:[{id:'pressure-to-ignition',time:9/18,text:'Compare the white core and the cooler pressure echoes while the blast is fully visible.'}]
  };
  const file=path.join(root,'plan.json');
  fs.writeFileSync(file,JSON.stringify(plan));
  const review=ink.createReferenceClipReview(file);
  const result=review.write(output,{time:review.alignment.range('ignition')[0],includeSheet:true});
  console.log(path.join(result.directory,'index.html'));
} finally { fs.rmSync(root,{recursive:true,force:true}); }
