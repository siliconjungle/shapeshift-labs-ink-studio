// A mesh doorway, a shadowed inspection beam, and a moving service cart.
module.exports = ({KIT:K,makeBuilder}) => ({
  id:'aperture-works',
  name:'Aperture Works',
  seed:29,
  build(seed) {
    const B=makeBuilder(seed,[0x131d29,0x263b4b,0x526879,0x89a6a6,0xefd68e]);
    const meshes=[];
    function texture(width,height,ink,type) {
      const pixels=new Uint8Array(width*height*4);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const grain=((x*1973^y*7717^x*y*113)&15)-7;
        const joint=type==='brick' && (y%16===0 || (x+(y>>4&1)*11)%23===0);
        const land=type==='steel' && (x<2||y<2||x>=width-2||y>=height-2);
        const conduit=type==='deck' && (x%18<=1||y%17===0);
        const factor=joint ? .59 : conduit ? .62 : land ? 1.28 : 1;
        pixels.set([...ink.map(v=>Math.max(0,Math.min(255,Math.round(factor*v)+grain))),255],(y*width+x)*4);
      }
      return {width,height,pixels};
    }
    const slate=texture(92,64,[58,74,82],'brick'), steel=texture(35,48,[57,77,86],'steel');
    const deck=texture(92,68,[65,76,79],'deck'), bronze=texture(52,76,[118,78,59],'steel');
    function shell(id,objectId,materials) {
      const positions=[],uvs=[],indices=[],faceMaterials=[];
      function quad(origin,u,v,slot){
        const at=positions.length/3;
        for(const [s,t] of [[0,0],[1,0],[0,1],[1,1]])
          positions.push(...origin.map((value,k)=>value+s*u[k]+t*v[k]));
        uvs.push(0,0,1,0,0,1,1,1);
        indices.push(at,at+1,at+2,at+2,at+1,at+3);
        faceMaterials.push(slot,slot);
      }
      function box([x,y,z],[w,h,d],slot) {
        quad([x,y+h,z+d],[w,0,0],[0,-h,0],slot);
        quad([x,y+h,z],[0,0,d],[0,-h,0],slot);
        quad([x+w,y+h,z+d],[0,0,-d],[0,-h,0],slot);
        quad([x,y+h,z],[w,0,0],[0,0,d],slot);
        quad([x+w,y+h,z],[-w,0,0],[0,-h,0],slot);
      }
      function finish(){
        const mesh=K.sceneMeshes.create({id,objectId,materials,positions,uvs,indices,faceMaterials});
        meshes.push(mesh);
        return mesh;
      }
      return {quad,box,finish,positions};
    }
    const metal=(id,color)=>({id,color});
    const chamber=shell('chamber','chamber',[{id:'floor',texture:deck},{id:'wall',texture:slate},
      metal('blue-brace',0x335464),metal('rail',0x7b8273),metal('light',0x9ad9c9),metal('warm',0xecb66a)]);
    chamber.box([-3.48,-.25,-3.25],[6.96,.22,4.48],0);
    chamber.box([-3.47,-.03,-3.07],[6.94,3.67,.18],1);
    chamber.box([3.32,-.03,-3.0],[.16,3.58,3.33],1);
    for(const x of [-2.75,-.78,.73,2.68]){
      chamber.box([x,0,-2.82],[.055,3.05,.12],2);
      chamber.box([x-.04,.09,-2.85],[.13,.15,.16],3);
    }
    chamber.box([-.91,2.83,-2.82],[1.82,.055,.14],4);
    chamber.box([-.10,.47,-2.86],[.98,.58,.12],2);
    chamber.box([.31,.74,-2.722],[.22,.12,.019],5);
    for(const x of [-1.02,.98])chamber.box([x,-.016,-2.67],[.035,.024,3.86],3);
    chamber.finish();

    const gate=shell('doorway','doorway',[{id:'ashlar',texture:slate},{id:'sill',texture:steel},
      {id:'bronze',texture:bronze},metal('line',0xd6945c),metal('cool-lamp',0xa6efe2),metal('iron',0x2b3d48)]);
    const blockers=[];
    function wall(at,size,slot) {
      gate.box(at,size,slot);
      blockers.push({at:at.map((n,k)=>n+size[k]/2),half:size.map(n=>n/2)});
    }
    wall([-3.47,0,-.02],[2.19,3.15,.51],0);
    wall([1.28,0,-.02],[2.19,3.15,.51],0);
    wall([-1.28,2.72,-.02],[2.56,.43,.51],1);
    for(const x of [-1.49,1.28]){
      gate.box([x,0,.44],[.21,2.78,.062],2);
      gate.box([x,.16,.504],[.20,.045,.016],3);
      gate.box([x,2.58,.504],[.20,.045,.016],3);
    }
    gate.box([-3.49,3.11,-.03],[6.98,.12,.56],1);
    gate.box([-1.51,2.76,.519],[3.02,.043,.023],3);
    gate.box([2.14,1.16,.493],[.66,.58,.038],5);
    for(let i=0;i<3;i++)gate.box([2.23,1.30+i*.12,.541],[.43-.078*i,.033,.014],i===2?3:4);
    gate.box([-3.18,.12,.490],[1.32,.051,.041],3);
    gate.finish();

    const cart=shell('cart','cart',[metal('body',0x995a41),metal('copper',0xc87451),
      metal('runner',0x2f3943),metal('visor',0x294955),metal('signal',0xf4cf7e),metal('trim',0x759c9a)]);
    const z=.68;
    cart.box([-.34,.11,z-.026],[.68,.58,.154],0);
    cart.box([-.29,.36,z+.13],[.57,.21,.027],3);
    cart.box([-.204,.45,z+.16],[.33,.037,.014],4);
    cart.box([-.33,.69,z-.028],[.67,.095,.16],1);
    for(const x of [-.29,.17]){
      cart.box([x,0,z-.06],[.13,.162,.24],2);
      cart.box([x,.18,z+.138],[.13,.05,.022],5);
    }
    cart.box([.27,.785,z+.018],[.025,.20,.032],5);
    cart.box([.245,.967,z+.022],[.078,.062,.052],4);
    const actor=cart.finish();
    const distance=(x,y,z)=>{
      let d=Infinity;
      for(const {at,half} of blockers) {
        const a=Math.abs(x-at[0])-half[0], b=Math.abs(y-at[1])-half[1], c=Math.abs(z-at[2])-half[2];
        d=Math.min(d,Math.hypot(Math.max(a,0),Math.max(b,0),Math.max(c,0))+Math.min(0,Math.max(a,b,c)));
      }
      return d;
    };
    const chamberMist=K.procedural.density.bounded({
      bounds:{min:[-3.3,0,-2.91],max:[3.3,3.06,-.04]},
      sample:(x,y,z,t)=>.28+.11*Math.sin(3.9*y+2.25*z-t)*(.45+.55*Math.cos(x*1.09)**2)
    });
    const lip=K.procedural.density.bounded({
      bounds:{min:[-3.51,.02,.505],max:[3.51,1.48,.656]},
      sample:(x,y,z,t)=>(.48+.12*Math.sin(3*y-1.22*x+1.08*t))*Math.max(.16,1-.46*y)
    });
    const world=B.finish({
      meshes,cam:{target:[0,1.5,-.60],dist:8.2,yaw:.12,pitch:.083,ortho:true,sway:0},
      radius:10,dither:0,
      atmosphere:[
        K.atmosphere.field({field:chamberMist,density:1.8,step:.052,color:'#6ea4af',anisotropy:.09}),
        K.atmosphere.field({field:lip,density:7.4,step:.024,color:'#8cabb0',lit:false})
      ],
      volumeLighting:{ambient:.22,spots:[{at:[-1.04,2.58,-1.32],direction:[1,-.62,.27],innerAngle:9,outerAngle:15,
        radius:5.8,color:'#c5f8ff',intensity:6}],points:[{at:[.5,.75,-2.48],color:'#e8aa66',radius:2.25,intensity:1.6}],
        shadow:K.atmosphere.occluder(distance,{steps:48})},
      volumeQuality:{scale:4,reconstruction:'lighting',depthTolerance:.30,steps:62}
    });
    const stage=K.stage(world);
    stage.stateful=false;
    stage.t0=0;
    stage.add({pre(_dt,t){
      const x=-1.98+1.74*t;
      K.sceneMeshes.pose(actor,cart.positions.map((n,i)=>n+(i%3===0?x:i%3===1?.023*Math.sin(t*9):0)));
    }});
    return world;
  }
});
