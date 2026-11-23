const palette = [0x18232d,0x233646,0x475f65,0x778989,0xa7aea1,0xd1cdbc,
  0x6e6651,0xa78c67,0xdad0b0,0xe5be89,0xd89467,0xf5d5a5,0x9ccbb5,0x477f76,
  0xde9f80,0xa799ce,0x309eae];
const colors = [['#b57250','#e2a66d','#f0c58c','#fbe2b3'],['#467c78','#77ad9e','#acd7ba','#c8e4c6']];
const finish = (B,cam,liveSun) => B.finish({id:'strand-shadow-laboratory',cam,radius:8,
  dither:0,fog:{c:0,start:1,max:0},liveSun});

function stage({KIT:K,makeBuilder,makeSculpt}) {
  const B=makeBuilder(21,palette), S=K.sculpt(makeSculpt(B));
  S.captureAlbedo = true;
  S.box([0,-.15,0],[3.52,.13,2.17],{r:[1,2,3,4],albedo:'#72928f',materialId:'plinth'},{res:.14,rd:.022});
  S.box([0,.022,0],[3.32,.045,1.96],{r:[6,7,8,5],albedo:'#e2cda1',materialId:'ceramic'},{res:.095,rd:.014});
  for (const x of [-3.33,3.33]) for (const z of [-.67,.66])
    S.box([x,.48,z],[.13,.48,.13],{r:[1,2,3,4],albedo:'#668785',materialId:'metal'},{res:.075,rd:.018});
  S.bake();
  for (const f of [0,1]) for (let band=0;band<7;band++) {
    const group=(band-3)*.053;
    const threads=Array.from({length:5},(_,strand)=>({
      id:'filament-'+strand,
      path:{points:Array.from({length:43},(_,j)=>{
        const u=j/42,x=-3.33+6.66*u;
        const twist=2*Math.PI*(u*6+band*.14);
        const sag=Math.sin(Math.PI*u), centre=(f ? .62 : -.67) + (f ? -.82 : 1.10)*sag*Math.sin(u*4.5+.24);
        const local=(strand-2)*.011;
        const y=.95+(.23+f*.18)*sag+.12*Math.cos(twist)*group+.12*f*sag;
        return [x,y+group*Math.sin(twist)*.68+local*Math.sin(twist),
          centre+group*Math.cos(twist)*.74+local*Math.cos(twist)];
      })}
    }));
    K.curveSplats.draw(B,{kind:'textile',plan:{threads}},{
      object:f?'sea-glass':'golden-hemp',material:'rope',target:{part:'wound-fibres'},profileSamples:12,
      width:f ? .026 : .032,edge:f ? 'beta' : 'hard',opacity:f ? .83 : 1,
      color:({index})=>colors[f][(band+index)%4],
      shadow:{cast:true,transmittance:f ? .72 : .61,group:{samples:22,maxError:f ? 7 : 6}}
    });
  }
  return finish(B,{target:[0,.18,0],dist:9.3,yaw:-.25,pitch:.91,fov:.60},
    {direction:[-.57,.87,-.49],ambient:.28,intensity:.87,mapSize:160,bias:.016,filter:1});
}

function layers({KIT:K,makeBuilder,makeSculpt}) {
  const B=makeBuilder(9,palette), S=K.sculpt(makeSculpt(B));
  S.captureAlbedo=true;
  S.box([0,.22,-.11],[2.97,1.23,.09],{r:[1,2,3,4],albedo:'#9eb0aa',materialId:'frame'},{res:.11,rd:.021});
  S.box([0,.22,.005],[2.76,1.05,.038],{r:[6,7,8,5],albedo:'#ede0c4',materialId:'receiver'},{res:.074,rd:.015});
  S.bake();
  const runs=[[-2.45,.58,.36,'#cd8257'],[-1.58,1.31,.73,'#667d9c'],[-.75,2.37,1.15,'#247c7c']];
  for (const [i,[from,to,z,color]] of runs.entries()) {
    const draw=(points,width,shadow)=>K.curveSplats.draw(B,points,{
      object:'screen-'+i,material:'fibre',edge:'hard',width,color,shadow
    });
    const y=-.44+.85*z;
    draw([[from+.54*z,y,z],[to+.54*z,y,z]],.145,{cast:true,transmittance:.62});
    for (const x of [from+.54*z,to+.54*z]) draw([[x,y-.055,z],[x,.93,z]],.026);
  }
  return finish(B,{target:[0,.23,.15],dist:7.3,yaw:0,pitch:0,fov:.58,ortho:true},
    {direction:[.54,.85,1],ambient:.19,intensity:.89,mapSize:288,bias:.009,filter:0});
}

module.exports = {stage,layers};
