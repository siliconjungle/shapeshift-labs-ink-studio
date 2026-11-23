/* Revolving pixel forms and layered projections. */
module.exports = function forms(D) {
  const {generator, fields, rasterSimulation, size, width, height, tau, clamp, smooth, wrap, rgb,
    hash, noise, texture, band, pixel, layer} = D;

  const cosmos=[0x0a0f21,0x0f1a2d,0x15283b,0x1e3449,0x2b4354,0x57445b,0xcfa68f];
  const coal=[0x352742,0x58405b,0x89616d,0xb48081,0xdba083,0xf6be92,0xffdbaf,0xffeccc,0xffffe5];
  const angle=-.52, c=Math.cos(angle), s=Math.sin(angle);
  function accretion(u){
    const phase=u*tau;
    return pixel((x,y)=>{
      const dx=x-47,dy=y-49;
      const X=dx*c+dy*s,Y=dy*c-dx*s,r=Math.hypot(dx,dy);
      const grain=texture(x*.065,y*.081,81);
      const haze=.24*grain+.22*noise((x-y*.92)*.10,y*.072,82)+.08*noise(x*.18,y*.21,83);
      const grid=hash(Math.floor(x),Math.floor(y),61);
      const sky=grid>.997&&haze>.23?band(cosmos,.80+.16*(grid>.999)):band(cosmos,.12+haze*.75);
      const rho=Math.hypot(X,Y*3.65);
      const theta=Math.atan2(Y*3.65,X);
      const vent=(Math.cos(theta-phase)+1)*.5, swell=(Math.cos(theta*2-phase*2)+1)*.5;
      const turb=noise(rho*.145+Math.sin(theta-phase)*1.6,Math.sin(theta-phase)*3.5+Math.cos(theta-phase),912);
      const trail=Math.sin(rho*.76+Math.sin(theta*6-phase*2)*1.4+(turb-.50)*2.4)**2;
      const lensRadius=Math.hypot(X*.93,(Y+3.5)*1.10);
      const seeThrough=r>12.9 || (Y>1.9 && rho>14 && r>10.5);
      const disk=smooth(13,18,rho)*smooth(43,38,rho)*(Y>0?1:.79);
      const rearLens=Y<.25 ? smooth(13.55,14.4,lensRadius) * smooth(21.9,17.4,lensRadius) : 0;
      const photon=smooth(1.25,0,Math.abs(r-13.25))*smooth(2,-5,Y);
      const bridge=Y>0&&rho<42?.16:0;
      const lensedThreads=.45+.25*Math.sin((lensRadius-13.3)*2.38+theta*.33)+.29*turb;
      const energy=Math.max(
        disk*(bridge+.26+.30*trail+.25*vent+.26*turb)*(.83+.21*swell),
        rearLens*lensedThreads*(.89+.19*vent),
        photon*(.64+.19*vent));
      if(seeThrough&&energy>.18){
        return band(coal,energy);
      }
      if(r<13.7)return 0x080e1d;
      if(seeThrough&&energy>.075)return band(cosmos,.45+energy);
      return sky;
    });
  }

  const hoops=[-.77,-.17,.44,.86];
  const nStaves=15;
  const oak=[0x282133,0x3b2435,0x58313b,0x793e3e,0xa05245,0xbd694d,0xdb8b5d,0xf3b476];
  const steel=[0x1b2239,0x2a334b,0x424d68,0x5c6b85,0x7b8ba4,0x9bacc1,0xc2cdd8,0xe2e6e3];
  function section(y){
    return .688+.264*Math.cos(clamp(y,-1.1,1.1)*1.52)**2;
  }
  function barrelShape(x,y,z){
    const r=Math.hypot(x,z),theta=Math.atan2(x,z);
    const furrow=smooth(.095,.015,Math.abs(wrap(theta*nStaves/tau+.5,1)-.5));
    const wood=Math.max(r-section(y)+.013*furrow,Math.abs(y)-(1+.036*smooth(.60,.74,r)));
    let hoop=Infinity;
    for(const h of hoops) {
      const dy=Math.abs(y-h);
      hoop=Math.min(hoop,Math.max(dy-.096,r-section(h)-.068+.024*smooth(.064,.093,dy)));
    }
    return Math.min(wood,hoop);
  }
  barrelShape.bounds={min:[-1.03,-1.06,-1.03],max:[1.03,1.06,1.03]};
  const cellar = pixel((x,y)=>{
    const row=Math.floor(y/12),xx=wrap(x+(row%2)*8.0,16),yy=wrap(y,12);
    const grain=noise(x*.13,y*.12,0);
    const b=hash(Math.floor((x+(row%2)*8)/16),row,17), dim=smooth(60,25,Math.hypot(x-48,y-43));
    if(xx<1||yy<1||b<.18)return 0x141526;
    return band([0x151627,0x1c2034,0x272f46,0x353f55,0x424a60],.13+.20*b+.13*dim+.18*grain+(xx<2||yy<2?.20:0));
  });
  function barrel(u){
    const t=u*tau, spin=t + .09*Math.sin(t);
    const barrel=generator.fieldSprite(barrelShape,{
      ...size,center:[48,46.5+Math.sin(t*2)*.65],scale:32,orbit:[spin,-.73+.065*Math.cos(t)],roll:.10+.11*Math.sin(t),
      safety:.73,light:[Math.sin(spin-.62),-.14,Math.cos(spin-.62)],ambient:.23,bands:10,
      paint([x,y,z],_normal,light){
        const radius=Math.hypot(x,z), fraction=wrap(Math.atan2(x,z)/tau,1), segment=fraction*nStaves;
        const plank=Math.floor(segment), seam=Math.abs(wrap(segment+.5,1)-.5);
        const grain=noise(fraction*87,y*2.31+plank,8);
        let gap=Infinity;
        for(const h of hoops)gap=Math.min(gap,Math.abs(y-h));
        const top=Math.abs(y)>.997;
        if(!top&&gap<.101){
          const bevel=smooth(.067,.095,gap);
          const glint=Math.sin(fraction*tau+spin+.83)*.5+.5;
          const hammer=texture(fraction*80,y*8,47);
          const rivet=Math.abs(wrap(segment*2+.5,1)-.5)<.10 && gap<.030;
          const sheen=.08+.64*light+.09*glint+.18*smooth(.09,.029,gap)-.23*bevel+.09*hammer;
          return rgb(band(steel,sheen+(rivet?.20:0)));
        }
        if(top){
          const t=wrap(x*5+8,1), seam=Math.abs(t-.5);
          const ring=noise(x*5.91+1,z*3.21,51);
          const figuring=.16*ring+.045*Math.sin(x*34+ring*4);
          const seat=radius<.555||radius>.652?.055:-.24;
          return rgb(band(oak,.08+.55*light+.22*smooth(.72,.23,radius)+figuring+seat-.18*smooth(.078,.022,seam)));
        }
        const stencil=hash(plank,15,90);
        const lip=smooth(.081,.14,seam)*smooth(.34,.22,seam);
        return rgb(band(oak,.10+.46*light+.23*stencil+.15*grain-.40*smooth(.101,.011,seam)+.10*lip));
      }
    }).value;
    return layer(cellar,barrel);
  }

  const water=[0x292e57,0x343671,0x3b428c,0x465bac,0x447cb8,0x56a9ca,0x82cdd3,0xa9e5db];
  const earth=[0x394849,0x476143,0x587946,0x739149,0x93a953,0xb1c861,0xd6d96f,0xebdf92];
  const snow=[0x4c699f,0x559dc4,0x78cadd,0x9bddea,0xbce7e6,0xe5f2e9,0xfaf5e4];
  const plates=[
    [-.84,.20,-.50,.79],[-.81,-.20,-.54,.79],[-.42,-.28,-.86,.82],
    [.26,.29,.92,.75],[.56,.13,.81,.83],[.66,-.12,.74,.85],[.87,.10,.47,.86],
    [.24,-.34,.91,.89],[-.27,-.16,.95,.948],[.51,.55,-.66,.71],[.10,.50,-.87,.82]
  ];
  const terrain=fields.simplex({seed:68}), air=fields.simplex({seed:39}), coast=fields.simplex({seed:642});
  function planet(u){
    const t=u*tau, view={...size,center:[48,48],radius:39,roll:.24,pitch:.13,
      light:[-.41,.72,.60],ambient:.50,steps:7,rim:.10};
    const surface=generator.sphereMap({...view,yaw:t});
    const sky=generator.sphereMap({...view,yaw:t*2-.31});
    function sample(uv,i){
      const a=uv.data[i*3]*tau,b=uv.data[i*3+1]*Math.PI,sa=Math.sin(b);
      return [Math.sin(a)*sa,Math.cos(b),Math.cos(a)*sa];
    }
    function field(f,v,s){
      return f.value(v[0]*s,v[1]*s,v[2]*s);
    }
    return pixel((x,y)=>{
      const i=Math.floor(y)*width+Math.floor(x),r=Math.hypot(x-48,y-48);
      if(!surface.value.data[i*3+2]){
        if(r<42.1)return r>40.4?0x222941:0x3e577c;
        return 0x0c1121;
      }
      const a=sample(surface.value,i), b=sample(sky.value,i);
      const light=surface.illumination.data[i],depth=surface.depth.data[i];
      const broad=field(terrain,a,2.1), curl=field(coast,a,3.1), accent=field(terrain,a,4.3);
      let elevation=-1;
      for(const [x,y,z,cut] of plates)elevation=Math.max(elevation,x*a[0]+y*a[1]+z*a[2]-cut);
      elevation+=.093*broad+.039*accent+.025*curl;
      const fleck=Math.abs(a[1])>.92+.043*curl;
      const land=elevation>.019;
      const shelf=smooth(-.12,.016,elevation);
      const lights=.41*light+.16*broad+.06*field(coast,a,6.6);
      const shallow=band(water,.08+lights+.38*shelf+.09*(1-depth));
      const mainland=band(earth,.06+lights*1.04+.31*smooth(.24,.022,elevation));
      const world=fleck ? band(snow,.34+.53*light) : land ? mainland : shallow;
      const lat=b[1]+.16*field(air,b,2.11)+.056*field(coast,b,5.1);
      const cloudfield=field(air,[b[0]*.53,lat*1.62,b[2]*.53],2.7);
      const front=.21*Math.cos(lat*14+Math.atan2(b[0],b[2])*2 + cloudfield*.87);
      const tail=.12*Math.sin(lat*30+b[0]*7.2);
      const mass=.43*cloudfield+.10*field(coast,b,5.8)+front+tail;
      const outlined=mass>.238 || (mass>.125 && Math.abs(lat)>.80);
      const rim=.34*smooth(2.7,.19,39-r);
      if(r>38.35)return band(snow,.18+.49*light+.30*(y<49));
      if(outlined)return band(snow,.18+.49*light+.43*smooth(.21,.43,mass));
      if(mass>.181)return band(land?earth:water,.46+.25*light+rim);
      return world;
    });
  }

  const marks=[
    ['1111','0110','0110','0110','0110'],
    ['111','010','010','010','111'],
    ['1110','1001','1001','1001','1110'],
    ['111','100','111','100','111']
  ];
  const bodyPigment = [
    [0x71364b,0xb26251,0xe8a06d,0xffd38a,0xffefa5],
    [0x185157,0x298071,0x55b872,0x98d67b,0xc5eb8e],
    [0x172e61,0x235492,0x228bbd,0x39bee0,0x90f4ea],
    [0x72344e,0xb64b50,0xe77253,0xffad6d,0xffcc8b]
  ];
  const materialRecipe=bodyPigment.map((ramp,i)=>({
    type:i%2?'fluid':'elastic',stiffness:[4200,3100,5350,3500][i],shear:i%2?0:1050,
    color:D.hex(ramp[2])
  }));
  let matter, fountain;
  const bottom=x=>89-Math.max(0,Math.abs(x-48)-24)**1.17*.56;
  const bowl=pixel((x,y)=>y>bottom(x)?0x000000:undefined);
  const settings={...size,cell:1.75,maxSpeed:96,substeps:9,gravity:[0,103],damping:.19,bounce:.54,mask:bowl};
  function material(u){
    const jetShot=u>.57;
    if(!matter){
      const bodies=marks.map((glyph,index)=>{
        const points=[],s=4.7,left=[8,30,47,69][index],top=29;
        for(const [y,row] of glyph.entries())for(const [x,on] of [...row].entries()){
          if(on==='0')continue;
          for(let j=0;j<5;j++)for(let i=0;i<5;i++)points.push([left+(x+(i+.5)/5)*s,top+(y+(j+.5)/5)*s]);
        }
        const release=[.62,.47,.55,.60][index];
        const velocity=[[31,-45],[-8,-33],[-23,-51],[-38,-46]][index];
        return {points,material:index,spacing:.94,release,velocity};
      });
      const recipe=rasterSimulation.define('mpm',{...settings,materials:materialRecipe,bodies},{seed:48,dt:1/48});
      matter=rasterSimulation.session(recipe,{every:12,cache:20});
    }
    if(jetShot&&!fountain){
      const bodies=[
        {rect:[25,29,8,31],spacing:.65,velocity:[28,21],material:0},
        {rect:[41,18,8,31],spacing:.68,velocity:[9,48],material:1},
        {rect:[55,15,8,29],spacing:.66,velocity:[-11,57],material:2},
        {rect:[68,33,9,23],spacing:.51,velocity:[-37,26],material:3}
      ];
      const wash=materialRecipe.map((ink,i)=>({...ink,type:'fluid',stiffness:7200+500*i,shear:0}));
      const recipe=rasterSimulation.define('mpm',{...settings,materials:wash,bodies,bounce:.33},{seed:91,dt:1/48});
      fountain=rasterSimulation.session(recipe,{every:12,cache:20});
    }
    const state=jetShot?fountain.seek((u-.57)/.43*1.05):matter.seek(u/.57*1.90);
    const watertable=new Float32Array(width*height*4);
    const speed=new Float32Array(width*height);
    for(const {point:[x,y],body,velocity} of state.points){
      const v=Math.hypot(...velocity);
      for(let iy=Math.max(0,Math.floor(y-1.55));iy<Math.min(height,Math.ceil(y+1.55));iy++){
        for(let ix=Math.max(0,Math.floor(x-1.55));ix<Math.min(width,Math.ceil(x+1.55));ix++){
          const k=iy*width+ix;
          const w=Math.max(0,1.3-Math.hypot(x-ix-.5,y-iy-.5));
          watertable[k*4+body]+=w;
          speed[k]+=w*v;
        }
      }
    }
    return pixel((x,y)=>{
      const xx=Math.floor(x),yy=Math.floor(y),j=yy*width+xx;
      const depth=y-bottom(x);
      if(depth>0)return depth<1.2?0x484b63:depth<2.6?0x282a43:0x151423;
      const weights=watertable.subarray(j*4,j*4+4),amount=Math.max(...weights);
      if(amount<.36)return 0x151423;
      const who=weights.indexOf(amount), top=j-width, left=j-1;
      const above=top<0?0:watertable[top*4+who], beside=xx>0?watertable[left*4+who]:0;
      const slope=(amount-above)*.84+(amount-beside)*.21;
      const skin=smooth(.40,.87,amount);
      const streak=texture(x*.075,y*.19,who*9);
      const light=.40+.26*slope+.12*streak-.29*(1-skin)+.10*smooth(24,93,speed[j]/(amount+.04));
      return band(bodyPigment[who],light+(jetShot?.18:0));
    });
  }

  return {accretion,barrel,planet,material};
};
