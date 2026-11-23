/* Water and vegetation on native art grids. */
module.exports = function habitats(D) {
  const {sampling, size, tau, clamp, mix, smooth, wrap, hash, noise, texture, band,
    pixel, draw, layer, circle, rect, poly, line, ribbon, curve} = D;
  const scale = size.width / 96;

  const pool = [0x130f24,0x1b1931,0x24233e,0x262b47,0x344057,0x48526b];
  const leafRamp = [0x10332f,0x12464a,0x1d5a58,0x28706a,0x44857a,0x6ba68d];
  const petalRamp = [0x3d1c42,0x63234f,0x913360,0xbb497e,0xd75e95,0xec81ae,0xffa7c6,0xffcfdb];
  const pollen = [0x864653,0xba5d51,0xe99058,0xffbf68,0xffde81,0xfff0a4];
  const beds=[
    [-2,11,1.04],[13,3,1.07],[27,14,.72],[43,3,1.11],[57,14,1.15],[78,10,1.21],[92,1,.84],
    [7,30,1.16],[20,28,1.15],[37,26,.75],[46,21,.52],[68,29,.85],[87,28,1.07],
    [-2,47,.79],[13,55,1.08],[36,49,1.19],[58,44,1.07],[76,45,.77],[94,52,1.24],
    [6,77,1.14],[23,74,.65],[38,65,.73],[56,66,1.25],[76,70,1.48],[92,78,.89],
    [10,99,1.29],[30,89,1.35],[46,91,.93],[64,91,1.1],[83,95,1.1],[100,98,1.19]
  ];
  function lotuses(u){
    const t=u*tau, shore=[], shadows=[], leaves=[], blossoms=[];
    const back=pixel((px,py)=>{
      const x=px/scale,y=py/scale,c=texture(x*.092+.29*Math.cos(t),y*.307+.3*Math.sin(t),81);
      const broad=noise(x*.073-.23*Math.cos(t),y*.11,62);
      const rip=smooth(.68,.8,c)*.39;
      return band(pool,.18+.25*broad+.21*c+rip+(y>71?.05:0));
    });
    const point=(x,y)=>[x*scale,y*scale];
    for(let i=0;i<20;i++){
      const q=wrap(u+hash(i,4),1), x=hash(i,91)*96,y=hash(i,61)*96;
      if(Math.sin(Math.PI*q)<.31)continue;
      shore.push(line([point(x-4*q,y),point(x,y-.33),point(x+6*q,y)],band(pool,.64+.15*q)));
    }
    for(const [i,[x0,y0,z]] of beds.entries()){
      const x=x0+1.10*Math.sin(t+i*.57), y=y0+.90*Math.cos(t+i*.67);
      const tilt=hash(i,21)*tau;
      const spread=.37+.63*smooth(-.6,.45,Math.sin(t-(x0+y0)*.055+hash(i,5)*2.2));
      for(let k=0;k<2;k++){
        const a=tilt+k*2.9,r=3+4.2*hash(i,k+10),cx=x+Math.cos(a)*r*1.88,cy=y+Math.sin(a)*r*1.36;
        const contour=curve(15,q=>{
          const angle=a+.24+q*(tau-.60);
          const reach=r*(.93+.09*Math.sin(angle*4+k));
          return point(cx+Math.cos(angle)*reach,cy+Math.sin(angle)*reach*.69);
        });
        const root=point(cx,cy);
        leaves.push(poly([root,...contour],band(leafRamp,.31+.28*hash(i,k,1))));
        leaves.push(poly([root,...contour.slice(5,10)],band(leafRamp,.60+.17*hash(i,k,2))));
        if(r>5)leaves.push(line([root,contour[6],contour[7]],0x44817a,.9*scale));
      }
      const shadow=point(x+.9,y+2);
      shadows.push(circle(...shadow,(3.2+2.1*spread)*z*scale,0x130e23,3.3*z*scale));
      for(let ring=0;ring<2;ring++){
        const count=ring ? 7 : 10;
        const order=Array.from({length:count},(_,j)=>tilt+j*tau/count+ring*sampling.phyllotaxis.goldenAngle*.22)
          .sort((a,b)=>Math.sin(a)-Math.sin(b));
        for(const [j,a] of order.entries()){
          const c=Math.cos(a),s=Math.sin(a),f=hash(i,j+(ring?99:0));
          const length=z*(ring?mix(3.6,6.4,spread):mix(5.5,10.2,spread))*(.82+.40*f);
          const w=z*(ring?1.4:2.2)*(.71+.36*spread);
          const pitch=z*(.79-spread*.51)*(ring?6.2:3.6);
          const stem=[x,y+.7], tip=[x+c*length,y+s*length*.72-pitch], shoulder=[x+c*length*.56,y+s*length*.41-pitch*.53];
          const [ox,oy]=[-s*w,c*w*.92];
          const to=([a,b])=>point(a,b);
          const l=[shoulder[0]+ox,shoulder[1]+oy],r=[shoulder[0]-ox,shoulder[1]-oy];
          const curl=[mix(shoulder[0],tip[0],.64)-ox*.36,mix(shoulder[1],tip[1],.64)-oy*.48-1.0*z];
          const fold=[mix(stem[0],tip[0],.56)+ox*.25,mix(stem[1],tip[1],.56)+oy*.29-.61*z];
          const shadow=.32+.19*f+.11*(-s)+.12*ring;
          blossoms.push(poly([stem,l,tip,curl,r].map(to),band(petalRamp,shadow)));
          blossoms.push(poly([stem,fold,tip,curl,r].map(to),band(petalRamp,shadow*.67)));
          blossoms.push(poly([l,fold,tip].map(to),band(petalRamp,.60+.26*f+.08*(-s))));
          if(z>.98 && f>.47)blossoms.push(line([to(l),to(tip)],band(petalRamp,.68+.27*f)));
        }
      }
      const center=point(x+.25,y-.9);
      blossoms.push(circle(...center,2.07*z*scale,pollen[1],1.51*z*scale));
      for(let j=0;j<13;j++){
        const a=j*sampling.phyllotaxis.goldenAngle+tilt, r=z*Math.sqrt(j/14)*2.35;
        const [cx,cy]=point(x+Math.cos(a)*r,y-1+Math.sin(a)*r*.75);
        blossoms.push(rect(cx,cy,Math.max(1,.65*z*scale),Math.max(1,.57*z*scale),band(pollen,.50+.46*hash(i,j,69))));
      }
    }
    return layer(back,draw(shore),draw(shadows),draw(leaves),draw(blossoms));
  }

  const masonry=[0x141324,0x222339,0x2b2d46,0x363953,0x494a64,0x65667b,0x848297];
  const moss=[0x1a2e27,0x293d30,0x354f34,0x4b6739,0x688745,0x8ca755,0xb2be6a];
  const metal=[0x211b25,0x322936,0x493848,0x644b58,0x826d6d,0xa98b77,0xd3b69b,0xe5d2ab];

  function sewer(u){
    const t=u*tau,cx=49,cy=37;
    const drips=Array.from({length:14},(_,i)=>{
      const x=30+36*hash(i,8,9),seed=hash(i,9),a=wrap(u*(1+i%2)+seed,1);
      const y=i%3===0?60:cy-Math.sqrt(Math.max(0,21**2-(x-cx)**2))*1.08;
      return {x,y,drop:y+(78-y)*a*a,a};
    });
    const base=pixel((x,y)=>{
      const dx=x-cx,dy=(y-cy)*1.04,r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
      const rounded=Math.max(Math.abs(x-48),Math.abs(y-47))+.23*Math.min(Math.abs(x-48),Math.abs(y-47));
      const m=texture(x*.140,y*.124,80),salt=hash(Math.floor(x),Math.floor(y),12);
      if(rounded>55)return 0x0b111c;
      if(y>76){
        const warp=y+2*Math.sin(x*.093-t)+.32*Math.sin(x*.6+t*3);
        const shimmer=noise(x*.073+t*.115,warp*.58,12), aperture=smooth(35,10,Math.abs(dx+4)) * smooth(94,77,y);
        const inv=band([0x101122,0x1a1c2e,0x29293a,0x393a46,0x505960,0x717a73],.17+.30*aperture+.32*shimmer);
        if((shimmer>.61 && aperture>.32)||y<79&&salt>.43&&m>.47)
          return band(moss,.30+.65*shimmer*aperture+.14*m);
        return inv;
      }
      if(r<20.9){
        const spacing=7.25, ribWidth=1.53+(dy+21)*.016;
        const face=wrap(x+.55*dy*.025,spacing)-spacing/2;
        if(Math.abs(face)>ribWidth){
          const shadow=.05+.14*smooth(14,21,r)+.16*hash(Math.floor(x/spacing),9);
          return band([0x0c0b17,0x121321,0x17192d,0x251c2b],shadow+.06*m);
        }
        return band(metal,.18+.39*smooth(1.4,-1.3,face)*smooth(21,1,r)+m*.17+(r>17?.13:0));
      }
      if(r<25.6){
        const lip=smooth(21,23,r)*smooth(26,23,r), gloss=smooth(-.2,.85,Math.cos(a+2.07));
        if(r<22.3 && (dy>1||dx<3))return band(metal,.35+.38*gloss+.12*m);
        if(dy>7 && m>.39 || m>.58)return band(moss,.39+.38*lip+.11*m);
        return band(masonry,.39+.31*lip+.25*gloss+.12*m);
      }
      const row=Math.floor(y/7.3),vx=wrap(x+row%2*8.3+hash(4,row,4)*2,16.6),vy=wrap(y,7.3);
      const brick=Math.floor((x+row%2*8.3)/16.6),mortar=Math.min(vx,16.6-vx,vy,7.3-vy);
      const direction=dy>0 ? Math.abs(dx*.98+dy*.16) : r;
      const fern=smooth(48,14,direction)*smooth(78,60,y);
      const patches=m*.78+fern*.32+hash(brick,row,40)*.17;
      const streak=moss[Math.floor(2+4*clamp(patches))];
      if(y>55&&y<74&&Math.abs(dx)<25&&(patches>.59 || Math.abs(wrap(x-3,8)-4)<.7))return streak;
      if(mortar<.54 && patches<.69)return 0x10131e;
      if(patches>.61 && (vy<2.8 || m>.63))return band(moss,.22+.61*patches+.11*smooth(1.5,0,vy));
      const facet=smooth(2.2,.6,vy)*.18+smooth(13.5,15.7,vx)*.19;
      return band(masonry,.16+facet+.29*m+.17*hash(brick,row,93)-.17*smooth(41,54,rounded));
    });
    const water=[],drops=[];
    for(const [i,{x,y,drop,a}] of drips.entries()){
      const d=i%4===0?2:1;
      if(a>.12 && a<.98) drops.push(line([[x,drop-1-a*6],[x,drop]],a>.51?moss[6]:moss[4],d));
      if(a<.32)drops.push(line([[x,y],[x,y+4*(1-a)]],moss[5],d));
      if(a>.83){
        const r=(a-.83)*24;
        water.push(line([[x-1-r,79.5],[x+1.5+r,79.5]],a>.94?0x879979:0xc0d38b));
      }
    }
    return layer(base,draw(water),draw(drops));
  }

  const lagoon=[0x101329,0x181c38,0x20294c,0x233662,0x214c81,0x225c9f,0x1a7bb8,0x139fce,0x29d3e6,0xb6f5ed];

  function underwater(u) {
    const t=u*tau,cx=48,cy=48,radius=41.5;
    const sphere=pixel((x,y)=>{
      const dx=x-cx,dy=y-cy,r=Math.hypot(dx,dy), angle=Math.atan2(dy,dx);
      const s=texture(x*.134,y*.111,78);
      if(r>radius+2.5){
        const rip=wrap(r-5*(.5+.5*Math.sin(angle*4))+(s-.5)*7,6.8);
        return band(lagoon,.08+.19*smooth(50,43,r)+(rip<2.1&&r<47?.07:0));
      }
      const shine=smooth(.18,.91,Math.cos(angle+2.13));
      if(r>radius-1.12){
        const lit=r>radius+.45?.39+.29*shine:.68+.31*shine;
        return band(lagoon,lit);
      }
      const depth=Math.sqrt(Math.max(0,1-(r/radius)**2));
      const a=x*.061+Math.sin(y*.118+t)*.57+Math.cos(t)*.45;
      const b=y*.059+Math.sin(x*.088-t*2)*.35+Math.sin(t)*.49;
      const n=texture(a,b,14), m=texture(a*1.53-3,b*.94+.7*Math.sin(t),23);
      const beam=(n+.69*m)*(.46+.48*shine+.27*depth);
      const relief=texture(x*.048,y*.06,14);
      const shelf=dy>8+(relief-.6)*28;
      const border=Math.abs(beam-.85);
      const veil=smooth(1.1,.73,r/radius)*.14;
      return band(lagoon,.24+.23*smooth(.28,.84,beam)+.18*smooth(.83,.99,beam)+
        .17*smooth(.066,0,border)-.11*(shelf?1:0)+veil+.08*s);
    });
    const silhouettes=[];
    for(let j=0;j<8;j++){
      const a=wrap(u+hash(j,4,71),1), y=40+12*hash(j,5,41)+1.5*Math.sin(t+j);
      const x=48+Math.sin(a*tau)*31+3.7*j/8,sg=Math.cos(a*tau)>0?1:-1;
      if(Math.hypot(x-48,y-48)>38)continue;
      silhouettes.push(poly([[x-2.7*sg,y],[x-.9*sg,y-.9],[x+2.2*sg,y],[x,y+.9]],lagoon[j%3===0?6:4]));
      silhouettes.push(poly([[x-2.1*sg,y],[x-4.4*sg,y-1.1],[x-4.2*sg,y+1.15]],lagoon[3]));
    }
    return layer(sphere,draw(silhouettes));
  }

  const bambooRamp=[0x152936,0x1e443b,0x295541,0x39724a,0x4c8d51,0x6aaa62,0x87c968,0xaadd80];
  function bamboo(u){
    const t=u*tau;
    const grove=[
      [28,91,69,2.7,.34],[70,94,76,3.8,.44],[35,94,61,3.0,.60],
      [58,96,77,5.0,.75],[43,97,86,8.3,.94],[53,99,76,6.3,1]
    ];
    const background=pixel((x,y)=>{
      const sand=texture(x*.105,y*.082,98),a=wrap(x/23,1);
      const wave=wrap(y+13*Math.abs(a-.5),16);
      const dark=smooth(49,21,Math.hypot(x-48,(y-45)*.77));
      const stripe=smooth(5.8,4.3,Math.abs(wave-8)+(sand-.49)*6);
      return band([0x131527,0x1b2034,0x242e43,0x293950,0x344a57],.16+stripe*.27+dark*.16+(.05*sand));
    });
    const geometry=[];
    for(const [i,[x0,y0,h,w,z]] of grove.entries()){
      const bend=(Math.sin(t-i*.36)*6+2.7*Math.sin(t*2-i*.64)+13*(hash(i,2)-.5))*z;
      const stem=q=>[x0+bend*q*q+1.5*Math.sin(q*2.6+i)*q,y0-h*q];
      const arc=curve(24,stem);
      const taper=q=>w*(1-.69*q);
      const ink=shade=>band(bambooRamp,shade*.68+z*.30);
      for(let j=0;j<8;j++){
        const first=j/8,last=(j+1)/8,branchAnchor=stem(last);
        const part=curve(6,k=>stem(mix(first,last,k)));
        const wid=part.map((_,k)=>taper(mix(first,last,k/6)));
        const rind=part.map(([x,y],k)=>[x-wid[k]*.20,y]);
        geometry.push(ribbon(part,wid,ink(.26+.28*hash(i,j,61))),ribbon(rind,wid.map(w=>w*.5),ink(.67+.23*hash(i,j,12))));
        geometry.push(line([[branchAnchor[0]-taper(last)*.45,branchAnchor[1]],[branchAnchor[0]+taper(last)*.46,branchAnchor[1]+.45]],ink(.29),1.25));
        if(j<2||j===7)continue;
        const sign=hash(i,j,8)>.46?1:-1,reach=(9+hash(i,j,77)*16)*(.68+.50*z);
        const curl=Math.sin(t*2+i*.8+j*.5);
        const limb=k=>[branchAnchor[0]+sign*reach*k*(1.13-.24*k),
          branchAnchor[1]-reach*k*(.61+(.39+.12*curl)*k)+4*Math.sin(t+i*.49)*k*k];
        const path=curve(8,limb);
        geometry.push(ribbon(path,path.map((_,k)=>Math.max(.8,1.6*z-k*.12)),ink(.44+.1*curl)));
        for(let k=2;k<=7;k++){
          const [x,y]=path[k], across=k%2?1:-1;
          const length=(5.2+7.5*hash(i,j*9+k,4))*z*(1.16-k*.047);
          const a1=(sign===1?-.6:-2.54)+across*(.82-.063*k)+.28*Math.sin(t*2+i+j*.61+k*.86);
          const cs=Math.cos(a1),sn=Math.sin(a1),bulge=z*(.88+.81*hash(i,k,92));
          const tip=[x+cs*length,y+sn*length],mid=[x+cs*length*.47,y+sn*length*.36];
          geometry.push(poly([[x,y],[mid[0]+sn*bulge,mid[1]-cs*bulge],tip,[mid[0]-sn*bulge,mid[1]+cs*bulge]],
            ink(.44+.41*hash(i,j*9+k,34))));
        }
      }
      const tip=arc.at(-1);
      geometry.push(line([arc[22],tip],ink(.75)));
    }
    return layer(background,draw(geometry));
  }

  return {lotuses,sewer,underwater,bamboo};
};
