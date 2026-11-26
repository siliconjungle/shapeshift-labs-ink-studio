/* A moving survey sled and its wake inside a larger spectral sea. */
function study(){
  const origin=[-2.7,0,-1.88], cell=.27, shape=[20,10,14], ticks=42;
  const max=origin.map((n,i)=>n+cell*shape[i]);
  const config={grid:{shape,cell,origin},
    settings:{substeps:3,pressureIterations:26,flip:.82,maxSpeed:8,maxWork:8500000,maxParticles:9500},
    fill:[{min:origin,max,followOcean:true}],
    colliders:{
      sled:{kind:'box',position:[-1.92,1.12,-.67],half:[.57,.26,.35],turn:-.20,friction:.08},
      shoal:{kind:'sphere',position:[.80,.38,-.91],radius:.30,friction:.045}
    },
    surface:{radius:1.44,iso:.47,resolution:.152,maxCells:75000},
    secondary:{maxCount:520,perTick:27,impact:.42,rise:.72,sprayLife:.69,foamLife:1.19},
    ocean:{bounds:{min:[-7.2,-5.8],max:[8.6,6.2]},level:.76,depth:7,focus:[-.10,.01],
      near:1.1,far:2.75,edge:.65,sponge:.56,samples:[75,57],
      bands:[
        {wavelength:[6.7,10.4],amplitude:.084,direction:.64,spread:.28,modes:3},
        {wavelength:[3.0,4.9],amplitude:.037,direction:-.50,spread:.40,modes:3},
        {wavelength:[1.55,2.4],amplitude:.023,direction:1.45,spread:.42,modes:2}
      ]}
  };
  const commands=[], smooth=r=>r*r*(3-2*r);
  for(let tick=1;tick<=ticks;tick++){
    const q=tick/ticks, progress=.84*smooth(q)+.16*q;
    commands.push({tick,action:'move',args:{collider:'sled',position:[
      -1.92+3.74*progress,1.12-.37*Math.sin(Math.PI*.93*q)**.84,-.67+1.30*progress
    ],turn:-.20+.45*smooth(q)}});
  }
  const captures=[];
  for(let tick=0;tick<=ticks;tick+=2){
    const outputs=['ocean','secondary'];
    if([0,14,28,42].includes(tick))outputs.push('surface');
    if(tick===28)outputs.push('density');
    captures.push({tick,outputs});
  }
  return {format:'ink-studio/liquid-3d-plan',version:1,id:'lantern-sound',seed:71,config,
    run:{ticks,dt:1/38,every:1,checkpoints:[10,24,28,42],commands,captures,maxWork:380000000}};
}
module.exports={study};
