const fs = require('node:fs');
const path = require('node:path');
const ink = require('../index.js');
const png = require('./png.js');
const runWebGL = require('./look-webgl.js');
const {difference} = require('./finite-curve-review.js');
const fixture = require('../examples/surface-grown-strands.js');

const views = [
  {id:'rest',bend:0,edit:'rest'}, {id:'deformed',bend:1,edit:'shallow'},
  {id:'cut',bend:1,edit:'deep'}, {id:'restored',bend:.28,edit:'rest'}
];

function browserReview(kit,make,backend,{views,motion}) {
  const {world,setFrame,width,height}=make(kit);
  const painter=backend(width,height,{width,height,raw:true,dither:0,edges:false,damp:false});
  function draw(view) {
    setFrame(view);
    let spans;
    painter.draw(world,{curveFrame:stats=>{spans=stats.segments;}});
    return {rgb:painter.image(),spans};
  }
  try {
    return {views:views.map(draw),motion:motion.map(view=>draw(view).rgb),driver:painter.driver};
  } finally { painter.close(); }
}

function run(directory,options={}) {
  const motion=options.motion ? Array.from({length:28},(_,i)=>({
    bend: i<12 ? .5-.5*Math.cos(Math.PI*i/11) : i<20 ? 1 : .28+.72*(27-i)/7,
    edit: i<7 || i>=20 ? 'rest' : i<13 ? 'shallow' : 'deep'
  })) : [];
  const gl=runWebGL(options,fixture,browserReview,{views,motion});
  const {world,setFrame,width,height}=fixture(ink.load());
  const report={width,height,driver:gl.driver,browser:gl.browser,views:[]};
  fs.mkdirSync(directory,{recursive:true});
  for (const [i,view] of views.entries()) {
    const rootState=setFrame(view);
    const image=ink.render(world,{w:width,h:height,px:1,raw:true,edges:false,renderStats:true});
    const webgl=Buffer.from(gl.views[i].rgb,'base64'), {pixels,...error}=difference(image.rgb,webgl);
    for (const [label,rgb] of Object.entries({webgl,headless:image.rgb,difference:pixels}))
      png.write(path.join(directory,view.id+'-'+label+'.png'),width,height,rgb);
    const groups=Object.fromEntries(Object.entries(rootState).map(([name,state])=>[
      name,{attached:state.strands.filter(row=>row.attached).length,total:state.strands.length,...state.updates}
    ]));
    const roots=view.id+'-roots.json';
    fs.writeFileSync(path.join(directory,roots),JSON.stringify(rootState,null,2)+'\n');
    report.views.push({...view,groups,roots,error,webgl:gl.views[i].spans,headless:image.renderStats.curveSegments});
  }
  if (motion.length) {
    const folder=path.join(directory,'frames');
    fs.mkdirSync(folder,{recursive:true});
    report.motion=motion.map((view,i)=>{
      const file='view-'+String(i).padStart(3,'0')+'.png';
      png.write(path.join(folder,file),width,height,Buffer.from(gl.motion[i],'base64'));
      return {...view,file};
    });
  }
  fs.writeFileSync(path.join(directory,'review.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

module.exports={run};
