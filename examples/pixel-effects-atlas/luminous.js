/* Pixel lighting studies with separate silhouettes, emission and reflections. */
module.exports = function luminous(D) {
  const {generator, size, tau, mix, smooth, wrap, hash, noise, texture, band,
    pixel, draw, layer, circle, rect, poly, line, ribbon, curve} = D;

  function tileFloor(x,y) {
    const d = Math.max(Math.abs(x - 48), Math.abs(y - 48)) + Math.min(Math.abs(x - 48), Math.abs(y - 48)) * .21;
    const p = wrap((x + y) / 18, 1), q = wrap((x - y) / 18, 1);
    if (d > 52 || Math.floor((x+y)/18) % 2 === Math.floor((x-y)/18) % 2) return 0x171526;
    return Math.min(p, q, 1-p, 1-q) < .06 ? 0x282b43 : 0x22283f;
  }
  const sparkColors = [0x342944,0x593450,0x8b4261,0xc25070,0xf87083,0xffaf97,0xffdfb2,0xffffea];
  const splitColors = [0x4f89a6,0x48cfdb,0xf26477,0xfda949,0xcbe272,0xfcecc2];

  function spark(u) {
    const contact = .65;
    const impact = u < contact ? 0 : smooth(.95,contact,u);
    const drawOn = smooth(.09,.58,u);
    const end = Math.min(1,drawOn * 1.05);
    const visible = smooth(.08,.23,u) * smooth(1,.78,u);
    const flight = t => [49 + (32 - 6 * t) * Math.sin(5.1 * t + 2.92) + 4 * t, 13 + 65 * t + 6 * Math.sin(t * tau)];
    const [fx,fy] = flight(end);
    const [bx,by] = flight(1);
    const back = pixel((x,y)=>{
      const dx = x-bx, dy = y-by, d = Math.hypot(dx,dy);
      const angle = Math.atan2(dy,dx);
      const curl = impact * (12 * Math.sin(d * .17 - impact * 8) + 5 * Math.sin(angle * 9 + d*.28)) * smooth(88,3,d);
      const sx = x + 1.4 * curl * Math.cos(angle-.83), sy = y + curl * Math.sin(angle-.83);
      const under = tileFloor(sx,sy);
      if (impact < .02 || d > 89) return under;
      const n = noise(x*.20,y*.21,811), ray = Math.abs(Math.sin(angle*11.5+noise(angle*7,impact*6,18)*2.3));
      const striation = (Math.cos(d*.32+angle*5-impact*12) + 1) * .07;
      const radial = impact**2 * smooth(80,0,d) * (.47 + .7 * ray + striation + .13 * n);
      if(radial > .78) return band(sparkColors,.52 + radial*.48);
      if(radial > .14) return band([under,0x293044,0x343b56,0x4d5575,0x777d92,0xafa1a5,0xffc39d],radial*.98);
      return under;
    });
    const first = Math.max(0,end-.57);
    const trail=curve(40,t=>flight(mix(first,end,t)));
    const marks=[];
    if(visible>.12 && end>.004){
      const breadth = (3+10*end) * visible;
      marks.push(ribbon(trail,trail.map((_,i)=>breadth*(i/40)**1.3+.5),0x34304d));
      for(let j=0;j<4;j++){
        const trace=trail.slice(5+j*6);
        const pixels=trace.map((_,i)=>(1+j*.3)+i/(trace.length-1)*Math.max(0,breadth-j*1.4)*.74);
        marks.push(ribbon(trace.map(([x,y],i)=>[x+(3-j)*.52,y-(3-j)*1.07]),pixels,sparkColors[j+1]));
      }
      marks.push(line(trail.slice(30),sparkColors[6],2));
      marks.push(circle(fx,fy,Math.max(1.15,(1.6+impact*3.7)*visible),sparkColors[7]));
    }
    const chips=[];
    for(let i=0;i<78;i++){
      if(impact < .10+hash(i,17,3)*.28) continue;
      const age=1-impact, a=hash(i,5)*tau, r=(.22+age*.94)*(10+77*hash(i,6));
      const x=bx+Math.cos(a)*r,y=by+Math.sin(a)*r;
      const bit=1+hash(i,8)*2*impact;
      const c=splitColors[i%splitColors.length];
      chips.push(rect(x,y,bit,bit,c));
      if(i%5===0)chips.push(line([[x-Math.cos(a)*(3+11*impact),y-Math.sin(a)*(3+11*impact)],[x,y]],c));
    }
    let arcs=[];
    if(impact>.11){
      for(let j=0;j<5;j++){
        const a=(j-2)*.72+3.85+impact*.81;
        const r=(.78+1.27*(1-impact))*(21+13*hash(j,4));
        const end=[bx+r*Math.cos(a),by+r*Math.sin(a)];
        arcs.push(generator.discharge({...size,points:[[bx,by],end],time:u,period:1,seed:113+j,detail:4,
          branches:j%2,branchReach:8,amplitude:3.2+4*(1-impact),
          coreWidth:.9+impact*.85,edgeWidth:2.2,haloRadius:3,intensity:.5,
          core:'#fff4d3',edge:j%2?'#32dfed':'#f96985',halo:'#654973'}).value);
      }
    }
    const flash=[];
    if(impact>.74){
      for(let i=0;i<10;i++){
        const a=2.95+i*.32;
        const r=(12+26*hash(i,4))*(.21+.8*impact);
        flash.push(poly([[bx,by],[bx+Math.cos(a-.10)*r*.57,by+Math.sin(a-.10)*r*.57],
          [bx+Math.cos(a)*r,by+Math.sin(a)*r],[bx+Math.cos(a+.18)*r*.45,by+Math.sin(a+.18)*r*.45]],
        i%4?sparkColors[7]:sparkColors[6]));
      }
    }
    return layer(back,draw(marks),...arcs,draw(chips),draw(flash));
  }

  const glassRamp = [0x180b22,0x220a27,0x310b2f,0x490d36,0x601138,0x791b43,0xa33150,0xd43f5e,0xfa6685];
  const neon = [0x9c1d54,0xf33365,0xfe5f89,0xffa9ac];

  function plasma(u){
    const t=u*tau,cx=48,cy=46,radius=35;
    const rays=[];
    const contacts=[];
    for(let j=0;j<5;j++){
      const angle=t*(j%2===0?1:-1)+j*1.44+.55*Math.sin(t*2+j);
      const reach=(radius-1.2)*(.72+.27*Math.sin(t*2+j*.91)**2);
      const x=cx+Math.cos(angle)*reach,y=cy+Math.sin(angle)*reach;
      const charge=.22+.78*(.5+.5*Math.sin(t*3+j*2.3))**1.3;
      const points=[[cx,cy],[cx+Math.cos(angle+.68)*(reach*.37),cy+Math.sin(angle+.68)*(reach*.37)],[x,y]];
      const ray=generator.discharge({...size,points,time:u,period:1,seed:40+j,
        amplitude:3.1,detail:5,branches:j%3?2:1,branchReach:9,coreWidth:1.18,edgeWidth:2.65,haloRadius:4,
        core:'#c6ffff',edge:'#19c9ff',halo:'#267de4',intensity:1.9});
      rays.push({source:ray.value,opacity:charge});
      contacts.push([x,y,charge]);
    }
    const glass=pixel((x,y)=>{
      const dx=x-cx,dy=y-cy,r=Math.hypot(dx,dy), a=Math.atan2(dy,dx);
      const tile=Math.min(wrap(x+5*Math.cos(y*.04),22),wrap(y+4*Math.cos(x*.052),23));
      const rounded=Math.max(Math.abs(dx),Math.abs(y-48))+.23*Math.min(Math.abs(dx),Math.abs(y-48));
      const cast=.21*smooth(65,12,Math.hypot(dx,dy*.66));
      if(r>radius+2){
        if(rounded>56)return 0x13091d;
        const pedestal=y>78 && y<94 && Math.abs(dx)<(y-78)*.94+13;
        if(pedestal){
          const rim=Math.abs(Math.abs(dx)-((y-78)*.94+13))<1.5||y>91;
          return band(glassRamp,.46+(rim?.19:0)+.13*smooth(15,2,Math.abs(dx+8)));
        }
        return band(glassRamp,.13+cast+(tile>2.2?.14:0));
      }
      let bounce=0;
      for(const [sx,sy,power] of contacts){
        bounce=Math.max(bounce,power*Math.exp(-((x-sx)**2+(y-sy)**2)*.018));
      }
      if(r>=radius-1.3){
        const flare=.45+.41*Math.cos(a+1.75)+.12*Math.sin(a*2+t*2);
        if(bounce>.50 && r<radius+.4)return band([0x4de4f5,0x89f7f6,0xd3ffff],bounce);
        if(r<radius+.4)return band(neon,.21+.66*flare+.18*bounce);
        return band(glassRamp,.34+.25*flare);
      }
      const broad= Math.hypot((dx+3)*.96,(dy+7)*1.25);
      const reflect=smooth(22,28,broad)*smooth(37,30,broad)*smooth(.34,.92,-Math.sin(a+.22));
      const lower=smooth(25,33,r)*smooth(1,14,dy)*smooth(33,10,dx);
      const ball=Math.hypot(dx,dy);
      const shine=smooth(9.7,7.0,ball)*smooth(4.0,7,ball);
      const pin=dy>3 && dy<radius-8 && Math.abs(dx)<1.24;
      const red = .13+cast*.57+.38*reflect+.18*lower+.44*shine+(pin?.12:0);
      if(bounce>.37)return band([0x311035,0x223059,0x195984,0x2f87bd,0x6fcbe2],bounce*.87);
      return band(glassRamp,red+.044*texture(x*.14,y*.14,14));
    });
    const composite=layer(glass,...rays);
    return pixel((x,y)=>{
      const d=Math.hypot(x-cx,y-cy);
      const source=d>radius+1 ? glass : composite;
      const i=(Math.floor(y)*size.width+Math.floor(x))*4;
      return [source.data[i],source.data[i+1],source.data[i+2]];
    });
  }

  const greens=[0x112135,0x16343d,0x204a42,0x2b664b,0x3a8752,0x56aa54,0x7ad659,0xa1f36e,0xc9f9a2,0xf3ffe0];

  function healing(u) {
    const phase=u*tau;
    const open=smooth(.06,.33,u)*smooth(1,.79,u);
    const peak=smooth(.49,.61,u)*smooth(.91,.67,u);
    const scar=smooth(.11,.39,u)*smooth(1,.89,u);
    const turn=.20+.8*(-.5+.5*Math.cos(phase));
    const cx=48,cy=68;
    const floor=pixel((x,y)=>{
      const vignette=Math.max(Math.abs(x-48),Math.abs(y-49))+.30*Math.min(Math.abs(x-48),Math.abs(y-49));
      const dx=x-cx,dy=(y-cy)*2.38,r=Math.hypot(dx,dy);
      if(vignette>58)return 0x101224;
      const core=smooth(36+4*open,4,r);
      const irradiance=smooth(52,33,r)*(.13+.09*peak)+core*(.14+peak*.13);
      return band(greens,.14+irradiance+.03*noise(x*.105,y*.16,46));
    });
    const far=[],near=[], glyph=[];
    const px=48,py=cy-34*open-11*peak;
    const a=(.48+.52*open)*(.23+.77*Math.abs(Math.cos(turn*3)));
    const outline=[[-4,-13],[4,-13],[4,-5],[12,-5],[12,5],[4,5],[4,13],[-4,13],[-4,5],[-12,5],[-12,-5],[-4,-5]];
    if(open>.07){
      for(let j=5;j>=0;j--){
        const edge=outline.map(([x,y])=>[px+x*a+j*.67,py+y*open+j*.27]);
        glyph.push(poly(edge,band(greens,.37+.23*(1-j/5)+.19*peak)));
        if(j===0){glyph.push(line([...edge,edge[0]],band(greens,.67+.19*peak)));
          const recess=outline.map(([x,y])=>[px+x*a*.60,py+y*open*.65+1.6]);
          glyph.push(poly(recess,band(greens,.55+.16*peak)));
        }
      }
    }
    for(let i=0;i<96;i++){
      const a=i*tau/96+.45*Math.sin(phase);
      const rx=(9+23*open),ry=(3+9*open), x=cx+Math.cos(a)*rx,y=cy+Math.sin(a)*ry;
      const k=i%4===0?1.5:.7;
      const swell=Math.sin(a*3-phase*4)*.5+.5;
      const v=scar*(.53+.20*swell)+peak*.2;
      const ink=band(greens,.47+v*.54);
      const plume=hash(i,77)*hash(i,8)*.5+(.5+.5*Math.sin(phase*3+i*.67))**3*.50;
      const ledge=Math.cos(a)*.13+.28;
      const m=(Math.sin(a)<0)?far:near;
      if(scar>.04){
        m.push(rect(x,y,k+1.2,1.2+peak,ink));
        if(plume>.24)
          m.push(line([[x,y],[x+Math.cos(a)*.6,y-(plume+ledge)*(9+37*peak)*scar]],band(greens,.31+v*.30+plume*.23),k));
      }
    }
    for(let i=0;i<21;i++){
      const p=wrap(u*1.5+hash(i,7),1),a=(i*2.39)%tau;
      if(peak*Math.sin(Math.PI*p)+open*.30<hash(i,0)*.47)continue;
      const x=cx+(27+6*hash(i,8))*Math.cos(a),y=cy+11*Math.sin(a)-p*(17+36*hash(i,4));
      const color=greens[i%3===0?9:7];
      near.push(rect(x,y,1,1,color));
      if(i%3===0)near.push(line([[x-1.6,y],[x+1.6,y]],color),line([[x,y-1.6],[x,y+1.6]],color));
    }
    return layer(floor,draw(far),draw(glyph),draw(near));
  }

  const flames=[0x662945,0xa32e46,0xd63b45,0xf25a3b,0xff8837,0xffb33f,0xffd563,0xffef94,0xfff8c3];

  function tornado(u){
    const t=u*tau;
    const soot=pixel((x,y)=>{
      const n=noise(x*.13,y*.10,27);
      const tile=wrap(Math.floor(y/14)%2*11+x+8,23)-11.5;
      const oval=Math.hypot(tile*.57,wrap(y,14)-7);
      const d=Math.hypot((x-48)*.86,y-48);
      return band([0x161526,0x202238,0x293049,0x323950],.11+.33*smooth(5.6,4.4,oval)+.11*n-.19*smooth(36,66,d));
    });
    const strips=[];
    function vertex(h,angle){
      const r=2+29*h**.92, z=Math.sin(angle);
      const axis=48+(6+8*h)*Math.sin(t-(1-h)*2.9)*h + (h-.31)*5;
      return [axis+r*Math.cos(angle),78-56*h+r*.35*z,z];
    }
    const flameBody=pixel((x,y)=>{
      const h=(78-y)/56;
      if(h<0||h>.85)return;
      const [axis]=vertex(h,Math.PI*.5);
      const rim=(2+29*h**.92)*.80;
      const rx=(x-axis)/rim;
      const spun=Math.sin(t*3-h*19+rx*2.7)*.5+.5;
      const turbulence=texture(rx*1.7+Math.cos(t),h*9-Math.sin(t),91);
      const density=(1-Math.abs(rx)*.88)*smooth(0,.20,h)*smooth(.85,.67,h)+
        .29*(spun-.5)+.32*(turbulence-.49);
      if(density>.25)return band(flames,.30+.55*density+.12*spun);
    });
    for(let j=0;j<3;j++){
      const profile=curve(126,(f)=>{
        const h=.045+.90*f;
        const angle=t*(j===2?1:2)+h*14.1+j*2.08;
        const wobble=noise(j*4+h*11+Math.cos(t),Math.sin(t)+h*3,72);
        const tip=smooth(.035,.24,f)*smooth(1,.87,f);
        const w=(.034+.083*Math.sin(h*Math.PI)+.043*wobble)*tip*(j===0?1:j===1?.76:.48);
        return {h,angle,w, depth:Math.sin(angle+.44)};
      });
      let start=0;
      for(let i=1;i<profile.length;i++){
        const d=profile[i].depth, previous=profile[i-1].depth;
        if(d*previous>0 && i<profile.length-1)continue;
        const row=profile.slice(start,i+1);
        start=i;
        if(row.length<2)continue;
        const depth=row.reduce((a,r)=>a+r.depth,0)/row.length;
        const face=band(flames,.37+.26*smooth(-.72,.87,depth)+.11*Math.sin(row[0].angle*.6)+.13*(j===0));
        const hot=band(flames,.48+.37*smooth(-.73,.89,depth)+.09*(j===0));
        const contour=(inner,outer)=>{
          const left=row.map(({h,angle,w})=>vertex(h+inner*w,angle-.86*(1-inner)).slice(0,2));
          const right=row.map(({h,angle,w})=>vertex(h+outer*w,angle+.86*outer).slice(0,2)).reverse();
          return [...left,...right];
        };
        const detail=[];
        for(let k=7;k<row.length-5;k+=6){
          const {h,angle,w}=row[k], next=row[Math.min(row.length-1,k+4+Math.floor(3*hash(j,k)))];
          if(w<.023||hash(j,k,7)>.67)continue;
          const inner=.21+.35*hash(j,k,12), outer=inner+.19+.09*hash(j,k,18);
          const a=vertex(h+w*inner,angle-.4),b=vertex(h+w*outer,angle+.1);
          const c=vertex(next.h+next.w*outer,next.angle+.2),d=vertex(next.h+next.w*inner,next.angle-.1);
          detail.push(poly([a,b,c,d].map(x=>x.slice(0,2)),band(flames,.43+.17*depth+.21*hash(j,k,13))));
        }
        const commands=[poly(contour(0,1),face),poly(contour(.32,.72),hot),...detail];
        strips.push({commands,depth});
      }
    }
    strips.sort((a,b)=>a.depth-b.depth);
    const flecks=[];
    for(let i=0;i<35;i++){
      const h=wrap(u*(1+i%2)+hash(i,3),1);
      const a=t*2+h*16.7+hash(i,5)*tau;
      const [x,y,z]=vertex(h,a);
      const v=Math.sin(h*Math.PI)**1.2;
      if(z<-.12 || v<.25+hash(i,8)*.61)continue;
      const dx=Math.cos(a)*(2+6*hash(i,9)),dy=-h*9;
      flecks.push(line([[x+dx*.7,y+dy+.9],[x+dx,y+dy]],band(flames,.54+v*.27)));
    }
    return layer(soot,flameBody,draw(strips.flatMap(strip=>strip.commands)),draw(flecks));
  }

  return {spark,plasma,healing,tornado};
};
