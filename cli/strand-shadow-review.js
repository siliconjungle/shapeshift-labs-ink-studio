const fs = require('node:fs');
const path = require('node:path');
const ink = require('../index.js');
const png = require('./png.js');
const {difference} = require('./finite-curve-review.js');
const fixture = require('../examples/strand-shadow-review.js');

function run(directory,{motion=false}={}) {
  const kit=ink.load(), stage=fixture.stage(kit), layers=fixture.layers(kit);
  const width=296,height=168, full={strandShadows:false},
    budget={strandShadows:{maxSpans:320,maxLayers:12}};
  const render=(world,liveSun)=>ink.render(world,{w:width,h:height,px:1,raw:true,edges:false,liveSun,
    renderStats:true,curveSubdivision:false,curveLod:false});
  const authored=render(stage,full), grouped=render(stage,budget), unshadowed=render(stage,{shadows:false});
  const stacked=render(layers,full), unstacked=render(layers,{shadows:false});
  const {pixels,...error}=difference(authored.rgb,grouped.rgb);
  fs.mkdirSync(directory,{recursive:true});
  for (const [name,rgb] of Object.entries({detail:authored.rgb,budget:grouped.rgb,
    'no-shadow':unshadowed.rgb,error:pixels,layers:stacked.rgb,'layers-clear':unstacked.rgb}))
    png.write(path.join(directory,name+'.png'),width,height,rgb);
  const report={width,height,error,views:{detail:authored.renderStats.strandShadows,budget:grouped.renderStats.strandShadows,
    layers:stacked.renderStats.strandShadows},visibleSpans:grouped.renderStats.curveSegments};
  if (motion) {
    const folder=path.join(directory,'frames'), frames=24;
    fs.mkdirSync(folder,{recursive:true});
    report.motion=Array.from({length:frames},(_,i)=>{
      const angle=2*Math.PI*i/frames, direction=[-.57+.36*Math.sin(angle),.87,-.49+.21*Math.cos(angle)];
      const frame=render(stage,{...budget,direction});
      const file='light-'+String(i).padStart(3,'0')+'.png';
      png.write(path.join(folder,file),width,height,frame.rgb);
      return {file,direction,shadows:frame.renderStats.strandShadows};
    });
  }
  fs.writeFileSync(path.join(directory,'review.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

module.exports={run};
