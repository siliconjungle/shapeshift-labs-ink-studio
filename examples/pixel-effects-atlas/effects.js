/* Layered light, warped flow and articulated emission. */
module.exports = function effects(D) {
  const {generator:G,size,width,height,tau,clamp,mix,smooth,wrap,rgb,alpha,band,hash,noise,texture,pixel,draw,layer,
    circle,rect,poly,line,ribbon,curve,halo,stars,sky,plate}=D;
  const coal=plate({colors:[0x121021,0x20182f,0x2f2342,0x413254,0x504063],size:51,seed:63});
  const soot=plate({colors:[0x150d1a,0x1c1023,0x24132d,0x351935],pattern:'slate',seed:5});
  const storm=plate({colors:[0x101423,0x171c30,0x222942,0x33445b,0x455267],pattern:'tiles',size:37,fade:.46,seed:23});
  const embers=[0x7b3047,0xab474f,0xe27656,0xffba68,0xffe5ad,0xfff7dd];

  function quill(u) {
    const phase=u*tau,shaft=curve(30,t=>[44+101*t+Math.sin(t*3+phase)*2.2*t,126-106*t+Math.sin(t*3.1)*8]);
    const outline=[],far=[],near=[],sparks=[],contours=[[],[]];
    for(let j=3;j<30;j+=2){
      const [x,y]=shaft[j],a=j/30;
      for(const sign of [-1,1]){
        const shaped=Math.sin(Math.PI*a)**.83,w=(4+25*shaped+4*hash(j,sign,8))*(.93+.075*Math.cos(phase+a*3));
        const advance=(9+6*hash(j,sign,34))*(1-a);
        const dx=.70*advance+sign*.71*w*(sign===1?.82:1.11),dy=-.70*advance+sign*.71*w;
        const barb=curve(7,t=>[x+t*dx+4*Math.sin(t*3+phase-a*4)*t*t,y+t*dy-Math.sin(t*Math.PI)*w*.24]);
        contours[sign===1?1:0].push(barb.at(-1));
        const widths=barb.map((_,i)=>(2+4.8*shaped)*(1-i/8));
        outline.push(ribbon(barb,widths.map(w=>w+4.8),0x582a44));
        far.push(ribbon(barb,widths.map(w=>w+.7),band([0xa44750,0xc55652,0xdb6e54,0xf99367],.2+.68*hash(j,sign))));
        near.push(ribbon(barb,widths.map(w=>w*.85),band([0x392b43,0x532f46,0x7e4051,0xab5551,0xc66a54],.18+hash(j,sign,71)*.65)));
        if(j%3!==0){
          near.push(line(barb.slice(1).map(([x,y])=>[x-1.15,y-1.35]),band([0xe88d65,0xffb872,0xffd99a,0xffeabb],.25+hash(j,sign,31)*.70),1.65));
        }
      }
    }
    const vane=draw(contours.flatMap((contour,i)=>{
      const edges=[shaft[0],...contour,shaft.at(-1),...shaft.slice(3,-1).reverse()];
      const mid=contour.map(([x,y],k)=>[mix(x,shaft[k*2+3][0],.37),mix(y,shaft[k*2+3][1],.37)]);
      return [poly(edges,i?0xd26650:0xa04a50),
        poly([shaft[2],...mid,shaft.at(-1),...shaft.slice(3,-1).reverse()],i?0x994753:0x6d3450),
        line(contour,i?0xf4a46e:0xca724f,2.4)];
    }));
    const stemWidth=shaft.map((_,i)=>4.3-i*.101);
    near.push(ribbon(shaft,stemWidth.map(w=>w+2.6),0xba5e56),ribbon(shaft,stemWidth,0x4c2b45),
      line(shaft.map(([x,y])=>[x-1.5,y-1.3]),0xffdca1,1.8));
    for(let i=0;i<79;i++){
      const a=wrap(u*(1+i%3)+hash(i,13,8),1),j=7+Math.floor(hash(i,5)*22),q=shaft[j];
      const x=q[0]+(hash(i,7)-.5)*(12+38*a)+8*a;
      const y=q[1]-a*(12+35*hash(i,8)), opacity=Math.sin(a*Math.PI)**.8;
      sparks.push(line([[x-1-a*3,y+1+4*a],[x,y]],alpha(embers[i%embers.length],opacity),i%7?1:2));
    }
    const plume=G.flowPlume({...size,start:[96,76],end:[113,-9],widths:[11,26,41,43,0],time:u,period:1,
      turbulence:.29,taper:.51,bands:3,bandDepth:.10,palette:['#6b2b43','#923540','#c94b46','#ed6d51','#ffad67','#ffe294']}).value;
    const flare=G.flowPlume({...size,start:[116,54],end:[125,-17],widths:[4,16,26,25,0],
      time:u,period:1,turbulence:.32,seed:28,palette:['#702d43','#a43a46','#d4554c','#fc8756','#ffca7e','#ffeca5']}).value;
    const heat=draw(far);
    return layer(coal,{source:halo(plume,0xc04d5a,8,.95),mode:'screen'},plume,{source:flare,opacity:.77},
      halo(heat,0xd45555,6,1.08),draw(outline),vane,{source:heat,opacity:.79},draw(near),draw(sparks));
  }

  let cells;
  function lava(u) {
    cells??=G.cellEdges({...size,spacing:25,jitter:.80,seed:8});
    const t=u*tau,wave=mix(-46,242,(.5-.5*Math.cos(t)));
    const cold=[0x48202d,0x652332,0x81283a,0x9f303e,0xb43c43,0xcf4d43];
    const hot=[0x9b293c,0xcb3a43,0xee5144,0xff7747,0xffa752,0xffd779,0xfff0ae];
    const rock=pixel((x,y)=>{
      const i=Math.floor(y)*width+Math.floor(x),d=cells.value.data[i];
      const thick=smooth(4,0,d),w=texture(x*.11,y*.12,25);
      const rim=smooth(13,0,Math.min(x,y,width-x,height-y));
      const pressure=Math.exp(-((x-wave+19*Math.sin(y*.069+t))**2)/720);
      const energy=.09+.87*pressure+.082*Math.sin(t*2+y*.078+x*.071);
      if(rim>.54)return band(hot,.22+rim*.37+.18*w);
      if(d<4.8&&energy>.62&&w>.58)return band(hot,.41+pressure*.32+.12*thick);
      if(d<.75+2.8*energy){
        return band(hot,.12+.59*energy+.19*thick+.1*w);
      }
      const a=cells.index.data[i],h=hash(a,7,3);
      const grit=hash(Math.floor(x/2),Math.floor(y/2),107);
      const raised=smooth(.65,.81,w)*.13*(.25+.75*grit);
      return band(cold,.15+.36*h+.17*w+.13*thick+.18*pressure+raised);
    });
    const glow=pixel((x,y)=>{
      const i=Math.floor(y)*width+Math.floor(x),dx=x-wave+13*Math.sin(y*.069+t);
      const heat=Math.exp(-dx*dx/930)*smooth(7,1,cells.value.data[i]);
      if(heat>.30)return [...rgb(0xff6d42),Math.round(heat**2*95)];
    });
    const flecks=draw(Array.from({length:29},(_,i)=>{
      const f=wrap(u*(1+i%3)+hash(i,21),1), y=30+83*hash(i,23)-21*f;
      const x=wave+40*(hash(i,31)-.5)+10*f;
      const a=Math.sin(Math.PI*f)*smooth(-10,25,x)*smooth(202,170,x);
      return line([[x,y],[x-1.5,y+2.8]],alpha(i%3?0xffbf6e:0xc87457,a*.8));
    }));
    return layer(rock,{source:halo(glow,0xf74460,8,1.4),mode:'add'},glow,flecks);
  }

  function thrust(u) {
    const t=u*tau,power=.64+.36*Math.sin(t)**2, y=72+2*Math.sin(t);
    const chamber=plate({colors:[0x09071a,0x18091c,0x2a0c25,0x3b112c,0x471533],size:58,pattern:'diagonal',fade:.81});
    const bezel=draw([poly([[107,0],[192,0],[192,144],[111,144],[133,111],[146,97],
      [141,88],[141,56],[146,41],[134,29]],0x2c0d26),
      poly([[121,0],[153,0],[160,30],[155,41],[158,57],[158,87],[153,100],[160,120],[149,144],[126,144],
        [139,114],[146,97],[141,85],[141,58],[147,42],[135,27]],0x591a37),
      line([[135,27],[147,42],[141,56],[142,86],[147,97],[139,119]],0x98314c,2.8),
      line([[149,37],[151,60],[151,83],[149,102]],0x6d2340,3.1),
      rect(164,0,3,144,0x421531),rect(184,0,5,144,0x1d0a20)]);
    const far=G.flowPlume({...size,start:[144,y],end:[-39,y+6],widths:[24,55,72,57,28,0],seed:61,
      time:u,period:1,turbulence:.26,taper:.24,palette:['#4b1334','#701b40','#9e264e','#c93556','#ea4f62']}).value;
    const plume=G.flowPlume({...size,start:[142,y],end:[-32,y-2*Math.cos(t)],widths:[23,33+power*12,41+power*13,39,12,0],
      seed:20,time:u,period:1,turbulence:.20,bands:4,bandDepth:.33,taper:.34,
      palette:['#771c41','#a52350','#d62960','#fb4e69','#ff786e','#ffd6a2','#fff4d3']}).value;
    const throat=G.flowPlume({...size,start:[142,y],end:[68,y+5],widths:[17,24,17,7,0],
      seed:266,time:u,period:1,turbulence:.23,bands:3,bandDepth:.38,taper:.36,
      palette:['#e04468','#f8767c','#ff9a87','#ffe2af','#fffbed']}).value;
    const cinders=draw(Array.from({length:83},(_,i)=>{
      const a=wrap(u*(1+i%2)+hash(i,8,11),1), x=140-a*151,y0=y+(hash(i,18,16)-.5)*(15+105*a)+5*Math.sin(a*8+i);
      return line([[x+1+8*a,y0],[x,y0+.24]],alpha(i%4?0xf9989d:0xffd9aa,Math.sin(Math.PI*a)*.77),i%8?1:2);
    }));
    const hardened=pixel((x,y)=>{
      const i=(Math.floor(y)*width+Math.floor(x))*4,a=throat.data[i+3];
      if(a<112)return;
      return [throat.data[i],throat.data[i+1],throat.data[i+2],255];
    });
    return layer(chamber,bezel,far,{source:halo(plume,0xe43462,7,.95),mode:'screen'},plume,hardened,cinders);
  }

  function tornado(u) {
    const t=u*tau,rising=[];
    const center=y=>88+24*Math.sin(t-(123-y)*.034)*smooth(123,38,y)**2;
    const vortex=G.vortex({...size,base:[87,125],tip:[99,28],radii:[6,14,27,49,68,53],layers:24,
      segments:15,tilt:.23,twist:.66,lean:24,turns:2,period:1,time:u,seed:512,thickness:4.5,breakup:.26,
      palette:['#552642','#962f47','#d65646','#f77c4c','#ffb853','#ffe59e']});
    for(let j=0;j<94;j++){
      const p=wrap(u*(1+j%3)+hash(j,1,8),1), rad=9+p*60*hash(j,5);
      const a=t*2+j*2.41+p*10, y=127-p*109, x=center(y)+rad*Math.cos(a);
      const intensity=Math.sin(p*Math.PI);
      rising.push(line([[x+Math.sin(a)*(2+p*3),y+3],[x,y]],
        alpha(band(embers,.3+hash(j,8)*.7),intensity*.8)));
    }
    const warm=vortex.value;
    return layer(soot,halo(warm,0xc23c52,9,1.45),warm,draw(rising));
  }

  function spark(u) {
    const t=u*tau;
    const x=33+127*u,y=83-25*Math.sin(u*Math.PI)+11*Math.sin(u*tau*1.5);
    const activity=smooth(0,.10,u)*smooth(1,.88,u);
    if(activity<.01)return storm;
    const trajectory=curve(32,s=>{
      const a=mix(Math.max(0,u-.37),u,s);
      return [33+127*a,83-25*Math.sin(a*Math.PI)+11*Math.sin(a*tau*1.5)];
    });
    const tails=draw([
      ribbon(trajectory,trajectory.map((_,i)=>1+i*.18),alpha(0x713b98,.76*activity)),
      line(trajectory.map(([px,py],j)=>[px,py+2*Math.sin(t*3+j*.54)]),alpha(0xc56aee,.81*activity)),
      line(trajectory.slice(14),alpha(0x58a1da,.58*activity),2)
    ]);
    const warped=pixel((px,py)=>{
      const dx=px-x,dy=py-y,d=Math.hypot(dx,dy),pull=activity*7*Math.exp(-((d-28)**2)/250);
      const sx=clamp(Math.floor(px+Math.cos(t*3+dy*.16)*pull+dx/(d||1)*pull),0,width-1);
      const sy=clamp(Math.floor(py+Math.sin(t*2+dx*.21)*pull+dy/(d||1)*pull),0,height-1);
      const i=(sy*width+sx)*4;
      return [storm.data[i],storm.data[i+1],storm.data[i+2],255];
    });
    const raster=(start,end,i)=>G.discharge({...size,points:[start,end],period:1,time:u,amplitude:3.1,
      detail:4,branches:1,branchReach:9,seed:31+i,core:i%2?'#ffffdd':'#e7fbff',edge:i%2?'#ffb381':'#54dfec',halo:i%2?'#a440ab':'#645be1',haloRadius:5}).value;
    const arcs=activity>.05?Array.from({length:4},(_,i)=>{
      const s=Math.PI*.5*i+.77*t, to=[x+Math.cos(s)*(12+i*3),y+Math.sin(s)*(11+i*2)];
      return {source:raster([x,y],to,i),opacity:activity*.86};
    }):[];
    const fracture=draw(Array.from({length:63},(_,i)=>{
      const b=wrap(u*2+hash(i,6),1),a=i*2.399, r=(8+hash(i,8)*34)*b;
      return circle(x+Math.cos(a)*r,y+Math.sin(a)*r,hash(i,11)*1.12+.32,
        alpha([0xffd5a4,0x81ecab,0x67d8ef,0xf486a9,0xdfece5][i%5],activity*Math.sin(b*Math.PI)));
    }));
    const emitter=draw([circle(x,y,Math.max(.1,8*activity),alpha(0xca7de4,activity*.64),Math.max(.1,5*activity)),
      circle(x,y,Math.max(.1,4.2*activity),alpha(0xffe4ce,activity),Math.max(.1,3.3*activity))]);
    return layer(warped,{source:halo(tails,0x7543be,8,1.8),mode:'screen'},tails,...arcs,halo(emitter,0xe046a4,9,2.28),emitter,fracture);
  }

  function plasma(u) {
    const t=u*tau, x0=96,y0=71,R=49;
    const glass=pixel((x,y)=>{
      const dx=x-x0,dy=y-y0,r=Math.hypot(dx,dy);
      if(r>=R+9)return band([0x10091e,0x210a26,0x32102e,0x421532],.16+.40*texture(x*.043,y*.049,19));
      if(r>R)return band([0x211027,0x31122d,0x4c1536],smooth(R+9,R,r)*.9);
      const a=Math.atan2(dy,dx),lit=.5+.5*Math.sin(t*2+a*8.5);
      if(r>R-2)return band([0x6f244f,0xa93c60,0xd14b6c,0xf46b8a,0xffa4ab],.32+lit*.47+.15*Math.sin(a));
      const n=texture(dx*.05+Math.sin(t)*.4,dy*.05+Math.cos(t)*.4,2);
      const mesh=Math.abs(Math.sin(dx*.22)+Math.sin(dy*.25-dx*.13)+Math.sin(dy*.25+dx*.13));
      return band([0x160c20,0x2d102b,0x401435,0x58194a,0x682449],.18+.51*n+.12*smooth(20,R,r)+.12*(mesh>.14));
    });
    const arcs=[];
    for(let j=0;j<4;j++){
      const a=t*(j%3===0?1:-1)+j*1.51+.71*Math.sin(t*2+j);
      const r=R-3;
      const middle=[x0+Math.cos(a+.53)*26,y0+Math.sin(a+.53)*26];
      const end=[x0+Math.cos(a)*r,y0+Math.sin(a)*r];
      const on=.35+.64*Math.sin(t*2+j*.97)**4;
      const ray=G.discharge({...size,points:[[x0,y0],middle,end],branches:1,branchReach:7,period:1,time:u,
        amplitude:4.3,detail:5,coreWidth:1.8,edgeWidth:4.8,core:j%3===0?'#ffe9e0':'#a2ffff',edge:j%3===0?'#a46ce5':'#2de6ff',
        halo:j%3===0?'#852475':'#166bee',haloRadius:7,intensity:1.8,seed:18+j});
      arcs.push({source:ray.value,opacity:on});
    }
    const cap=draw([circle(x0,y0,5.9,0xc783c9),circle(x0,y0,3.3,0xfad6d9),
      line([[89,126],[103,126]],0x8f6384,2),rect(77,129,38,5,0x2b223a)]);
    return layer(glass,...arcs,cap);
  }

  function healing(u) {
    const t=u*tau, p=.36+.64*Math.sin(t)**2, center=[95,99],rx=51,ry=16;
    const plate=pixel((x,y)=>{
      const g=Math.hypot((x-95)*.68,(y-95)*1.3);
      return band([0x0a1523,0x112331,0x1d3945,0x28564f,0x36675b],.22+.44*smooth(99,15,g)+.16*texture(x*.09,y*.12,7));
    });
    const marks=[];
    for(let j=0;j<3;j++){
      const r=1-j*.14; const path=curve(92,k=>{
        const a=k*tau+(j%2?1:-1)*t;
        return [center[0]+Math.cos(a)*rx*r,center[1]+Math.sin(a)*ry*r];
      });
      for(let i=0;i<92;i+=6)marks.push(line(path.slice(i,Math.min(path.length,i+5)),band([0x439479,0x6aba8b,0x9fe0a0,0xcdf3bf],p*.73+i%3*.1),j===0?2:1));
    }
    for(let i=0;i<16;i++){
      const a=i*tau/16+t, x=center[0]+Math.cos(a)*rx,y=center[1]+Math.sin(a)*ry;
      marks.push(circle(x,y,1.3,i%4===0?0xe0f3c4:0x83d597));
    }
    const lift=1.9*Math.sin(t*2), y=57+lift;
    const shield=[[86,y-21],[105,y-21],[112,y-13],[112,y+12],[103,y+20],[86,y+20],[79,y+12],[79,y-12]];
    const leaf=draw([poly(shield,0x25573f),line([...shield,shield[0]],0x69c788,2.2),
      poly([[92,y-13],[100,y-13],[100,y-4],[109,y-4],[109,y+3],[100,y+3],[100,y+12],
        [92,y+12],[92,y+3],[83,y+3],[83,y-4],[92,y-4]],0x7bd391),
      line([[93,y-12],[99,y-12],[99,y-3],[108,y-3]],0xcdedaf,1.4),
      line([[92,y+6],[92,y+12],[100,y+12]],0x3e8e64,1.7)]);
    const motes=draw(Array.from({length:55},(_,i)=>{
      const a=hash(i,9)*tau,p=wrap(u*(1+i%3)+hash(i,8),1);
      const x=95+Math.cos(a)*(12+44*hash(i,2))+p*5*Math.sin(a+3*t);
      const y=99+Math.sin(a)*13-p*(26+51*hash(i,0));
      const opacity=Math.sin(Math.PI*p)**1.3;
      return line([[x,y+1],[x,y-(3+8*hash(i,31))]],alpha(i%5===0?0xdfffad:0x9be0a4,opacity*.85));
    }));
        const rune=draw(marks);
    const pillars=draw(Array.from({length:23},(_,i)=>{
      const a=i*tau/23+t,p=wrap(u*2+hash(i,4,6),1);
      const x=95+Math.cos(a)*rx*.94, y=99+Math.sin(a)*ry*.90;
      return line([[x,y-2],[x,y-(5+20*p)*Math.sin(p*Math.PI)]],alpha(0x84dc85,.62*Math.sin(p*Math.PI)),i%5?1:2);
    }));
    return layer(plate,halo(rune,0x63db8b,8,1.55),rune,pillars,halo(leaf,0x47ab8e,7,1.43),leaf,motes);
  }

  return {quill,lava,thrust,tornado,spark,plasma,healing};
};
