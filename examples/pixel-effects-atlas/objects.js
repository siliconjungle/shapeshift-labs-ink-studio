/* Rotating volume, spherical maps and an accretion study. */
module.exports = function objects(D) {
  const {KIT,generator:G,size,width,height,tau,clamp,mix,smooth,wrap,rgb,alpha,band,hash,noise,texture,
    pixel,draw,layer,circle,rect,poly,line,ribbon,curve,halo,stars,sky,plate}=D;
  const workshop=plate({colors:[0x100e1c,0x18172a,0x22233d,0x2d3752,0x394761],pattern:'tiles',size:23,seed:73});
  const space=pixel((x,y)=>{
    const n=texture(x*.047,y*.038,17),gas=Math.sin(x*.029-y*.059+n*2.5)**2;
    return stars(x,y,31)??band([0x080b1a,0x0e172d,0x16253c,0x21374b,0x304557],.05+.53*n+.24*gas);
  });

  function blackHole(u) {
    const phase=u*tau,theta=-.54+.095*Math.sin(phase),cs=Math.cos(theta),sn=Math.sin(theta),cx=97,cy=74;
    const pigment=[0x40233d,0x6c3659,0x9c5070,0xce776f,0xe5a376,0xffca8e,0xffedb9,0xfff5d0];
    const tendrils=pixel((x,y)=>{
      const dx=x-cx,dy=y-cy,r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
      if(r<26.5)return 0x050713;
      const bx=dx*cs+dy*sn,by=dy*cs-dx*sn,e=Math.hypot(bx,by*3.32);
      const theta=Math.atan2(by*3.32,bx),orbit=texture(e*.091+Math.cos(phase)*.46,theta*7+Math.sin(phase)*.81,51);
      const photon=Math.hypot(bx*.95,(by+7)*1.05);
      const fluted=Math.sin(e*.53+Math.sin(theta*5-phase*2)*2.4+orbit*3.8)**2;
      const knots=texture(e*.093,Math.cos(theta-phase)*6.4+Math.sin(theta*2)*2.8,26);
      const farLens=by<0?smooth(36,26.8,photon)*smooth(25.8,28,photon)*.87:0;
      const lens=by>0?smooth(29,26.8,r)*smooth(25.8,27.1,r)*.61:farLens;
      const disc=smooth(25.7,31,e)*smooth(85,63,e)*(by<0?.71:1);
      const intensity=clamp(Math.max(disc*(.11+.45*fluted+.35*orbit+.28*knots),lens));
      if(intensity<.12)return;
      return [...rgb(band(pigment,intensity)),Math.round(smooth(.08,.38,intensity)*255)];
    });
    const rim=draw([
      circle(cx,cy,26.5,0x050713),
      line(curve(39,t=>{const a=mix(3.33,5.34,t);return [cx+Math.cos(a)*27.5,cy+Math.sin(a)*27.5];}),
        0xc98674,1)
    ]);
    const sparks=draw(Array.from({length:106},(_,i)=>{
      const r=mix(40,91,hash(i,0,5)),a=hash(i,3,4)*tau+phase*(1+i%2);
      const x=Math.cos(a)*r,y=Math.sin(a)*r*.28,k=.22+.48*hash(i,8,1);
      if(Math.hypot(x,y)<28)return null;
      return circle(cx+x*cs-y*sn,cy+x*sn+y*cs,i%5?.55:1.05,alpha(band(pigment,.3+hash(i,7)*.7),k));
    }).filter(Boolean));
    return layer(space,halo(tendrils,0xb96d7e,8,.84),rim,tendrils,sparks);
  }

  function latheRadius(y) {
    return .61+.27*Math.cos(y*1.3)**2 + .046*Math.cos(y*3.1);
  }
  const hoops=[-.82,-.40,.40,.85];
  const barrelField=(x,y,z)=>{
    const a=Math.atan2(x,z),rad=Math.hypot(x,z),joint=smooth(.083,.01,Math.abs(wrap(a*12/tau+.5,1)-.5));
    const shell=rad-latheRadius(y)+.014*joint;
    const iron=Math.min(...hoops.map(h=>Math.max(Math.abs(y-h)-.052,rad-latheRadius(h)-.052)));
    const cap=Math.min(1.075,1.00+.05*smooth(.63,.70,rad));
    const body=Math.max(shell,Math.abs(y)-cap);
    return Math.min(body,iron);
  };
  barrelField.bounds={min:[-.98,-1.11,-.98],max:[.98,1.11,.98]};
  const oak=[0x332336,0x542e3a,0x723b3d,0x965046,0xb6694e,0xd48458,0xe6a471];
  const iron=[0x24253d,0x37405a,0x53637c,0x72829d,0x9da9c1,0xc5cad0];
  function barrel(u) {
    const phi=u*tau;
    const value=G.fieldSprite(barrelField,{...size,center:[95,71],scale:44,orbit:[phi,-.53+.17*Math.cos(phi)],roll:-.35+.14*Math.sin(phi),
      safety:.73,light:[Math.sin(phi-.63),.73,Math.cos(phi-.63)],ambient:.19,bands:8,
      paint([x,y,z],n,light){
        const angle=wrap(Math.atan2(x,z)/tau,1),seam=Math.abs(wrap(angle*12+.5,1)-.5);
        const ydist=Math.min(...hoops.map(h=>Math.abs(y-h))), rad=Math.hypot(x,z);
        const plank=Math.floor(angle*12);
        const cap=Math.abs(y)>1 && rad<.71;
        const stripe=cap?texture(x*8.7,z*1.68,12):texture(angle*114,2.7*y+plank,3);
        const knot=cap?Math.sin(rad*39+stripe*4.3):Math.sin(angle*227+y*.7+stripe*5);
        const furrow=cap?Math.abs(wrap(x*7.1,.98)-.49):seam;
        if(ydist<.061 || !cap&&rad>.66&&Math.abs(y)>1.043){
          const nail=seam>.36&&seam<.43&&ydist<.021;
          return rgb(nail ? 0xd7cccc : band(iron,.07+.82*light+.18*smooth(.057,.032,ydist)+.12*stripe));
        }
        const ridge=smooth(.05,.095,furrow),wood=.14+.59*light+.22*stripe+.080*knot-.33*(1-ridge)+.1*hash(plank,2,1);
        return rgb(band(oak,wood));
      }
    }).value;
    const stand=draw([circle(96,123,55,alpha(0x0c1022,.5),9),circle(96,124,35,0x0a0e1d,5)]);
    return layer(workshop,stand,value);
  }

  let continents,clouds;
  function maps(){
    const dims={width:288,height:144};
    const field=KIT.procedural.fields.simplex({seed:931});
    const mist=KIT.procedural.fields.simplex({seed:125});
    function coords(x,y){
      const a=x/dims.width*tau,lat=y/dims.height*Math.PI;
      return [Math.sin(a)*Math.sin(lat),Math.cos(lat),Math.cos(a)*Math.sin(lat)];
    }
    function sample(fn,p,s){
      return fn.value(...p.map(n=>n*s));
    }
    continents=pixel((x,y)=>{
      const p=coords(x,y),v=.68*sample(field,p,1.43)+.215*sample(field,p,3.4)+.087*sample(field,p,7.42)+.037*sample(field,p,14);
      const dry=sample(mist,p,4.3), cap=Math.abs(p[1])>.86+dry*.075;
      if(cap)return band([0x5fbdc3,0x92dae0,0xc7ede8,0xe7f6e6],.32+.47*clamp(v+.5));
      if(v<.059)return band([0x282f73,0x3c4a93,0x425faf,0x4e8bc3,0x69bfd2],clamp(.60+.93*v));
      if(v<.115)return band([0x4aae97,0x73c493,0xa4cf93,0xc7ce9d],clamp(v*7+.16*dry));
      return band([0x466761,0x569155,0x7bae69,0xa1c878,0xced28f,0xe6d9ae],clamp(.36+v*.7+dry*.30));
    },dims);
    clouds=pixel((x,y)=>{
      const p=coords(x,y),a=.59*sample(mist,[p[0]*.64,p[1]*1.45,p[2]*.64],4.9)+.33*sample(mist,p,8.7)+.1*sample(mist,p,15.3);
      const swirl=.13*Math.cos(x/dims.width*tau*3+Math.cos(y*.06)*2.3);
      if(a+swirl<.20)return;
      return [...rgb(band([0x80a9df,0xadd8e8,0xd0eeeb,0xfff8e1],clamp(a*1.95+.26))),Math.round(smooth(.18,.43,a+swirl)*255)];
    },dims);
  }
  function planet(u){
    if(!continents)maps();
    const theta=u*tau,view={...size,center:[97,73],radius:57,roll:.24,pitch:.19,
      light:[-.61,.49,.84],ambient:.44,steps:6,rim:.18};
    const surface=G.projectSphere(continents,{...view,yaw:theta}).value;
    const skyLayer=G.projectSphere(clouds,{...view,radius:58,yaw:theta*2,ambient:.57}).value;
    const rim=pixel((x,y)=>{
      const dx=x-97,dy=y-73,d=Math.hypot(dx,dy);
      if(d<55||d>63)return;
      const light=smooth(-48,37,-dx-dy*.57),v=Math.exp(-Math.abs(d-57.25)*.56)*(.3+.7*light);
      return [...rgb(band([0x274571,0x3d7ca9,0x78c9d0,0xbcebd9],light)),Math.round(170*v)];
    });
    return layer(space,halo(rim,0x3c8dc9,9,1.35),surface,skyLayer,rim);
  }
  return {blackHole,barrel,planet};
};
