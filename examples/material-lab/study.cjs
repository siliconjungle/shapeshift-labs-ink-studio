/* Two matched compression rigs and a drop over two different surfaces. */
function study(){
  const config={settings:{substeps:5,passes:6,contactPasses:3,maxWork:240000,maxContactSamples:64,
    damping:.24,speedLimit:24,bounceSpeed:.45},
    blocks:{},grains:{},surfaces:{backing:{material:'stone',at:[0,-.14,0],shape:{kind:'plane',normal:[0,1,0]}}}};
  const commands=[];
  for(const [label,x,body,surface] of [['A',-1.6,'silicone','felt'],['B',1.6,'foam','polished']]){
    config.blocks[label]={at:[x-.60,.09,-.25],size:[1.20,.88,.50],divisions:[2,2,1],
      material:body,radius:.048,pinBase:true};
    config.surfaces['press-'+label]={material:'polished',at:[x,1.30,-.18],shape:{kind:'plane',normal:[0,-1,0],offset:.07,half:[1.10,.65],u:[1,0,0]}};
    config.surfaces['lane-'+label]={material:surface,at:[x,-.065,1.16],shape:{kind:'box',half:[1.30,.062,.60]}};
    for(let i=0;i<16;i++){
      const col=i%4,row=Math.floor(i/4), j=(i*17)%31/31;
      config.grains[label+'-bead-'+String(i).padStart(2,'0')]={
        material:i%3===0?'grit':'glass',at:[x-.45+col*.195,.39+row*.145+j*.085,.85+row*.166],
        velocity:[1.12+.35*j,-.32,-.13+j*.36],radius:i%3===0?.069:.061
      };
    }
    const smooth=t=>t*t*(3-2*t);
    for(let tick=5;tick<=32;tick++)
      commands.push({tick,action:'move-surface',args:{surface:'press-'+label,at:[x,1.30-.544*smooth((tick-5)/27),-.18]}});
    for(let tick=47;tick<=70;tick++)
      commands.push({tick,action:'move-surface',args:{surface:'press-'+label,at:[x,.756+.544*smooth((tick-47)/23),-.18]}});
  }
  return {format:'ink-studio/material-lab-plan',version:1,id:'bellows-and-beads',config,
    run:{dt:1/60,ticks:79,every:1,checkpoints:[20,36,61,79],commands}};
}
module.exports={study};
