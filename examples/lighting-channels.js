// Relay Room. A practical lamp sits between two ceramic insulators.
module.exports = ({KIT:K,makeBuilder}) => {
  const palette=[0x111928,0x182337,0x263449,0x3a4b60,0x506275,0x6f8996,0x93a9ad,0xc5c6b0,
    0x443a47,0x754a43,0xa16b4c,0xcb8a52,0xe7ad68,0xffd48b,0x4a747e,0x62a0a5,0xd8dac4];
  function build(seed=28){
    const B=makeBuilder(seed,palette), meshes=[];
    function panel(id,object,material,origin,u,v,color,texture) {
      const p=(a,b)=>origin.map((n,i)=>n+a*u[i]+b*v[i]);
      const mesh=K.sceneMeshes.create({id,objectId:object,positions:[...p(0,0),...p(1,0),...p(0,1),...p(1,1)],
        uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3],materials:[{id:material,color,texture}]});
      return mesh;
    }
    function tile(w,h,base,interval){
      const pixels=new Uint8Array(w*h*4);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
        const noise=((x*1319^y*757^x*y*73)&15)-7, seam=x%interval===0||y%interval===0;
        pixels.set([...base.map(v=>v+noise-(seam?18:0)),255],(y*w+x)*4);
      }
      return {width:w,height:h,pixels};
    }
    const floor=tile(80,48,[70,82,92],12), brick=tile(120,74,[44,61,76],13);
    for(const [idx,x] of [-2.65,0].entries()){
      const id=idx?'east':'west';
      meshes.push(panel(id+'-floor',id+'-floor','deck',[x,-.055,1.25],[2.65,0,0],[0,0,-2.76],undefined,floor),
        panel(id+'-lip',id+'-base','frame',[x,-.25,1.25],[2.65,0,0],[0,.195,0],0x28394f));
    }
    meshes.push(panel('wall','wall','wall',[-2.65,-.055,-1.48],[5.3,0,0],[0,2.57,0],undefined,brick),
      panel('right-wing','right-wing','wall',[2.65,-.055,-1.47],[0,0,1.61],[0,2.56,0],0x2c3d55),
      panel('rail','rail','iron',[-2.62,1.93,-1.45],[5.24,0,0],[0,.15,0],0x9c704f),
      panel('top','top','iron',[-2.66,2.47,-1.22],[5.32,0,0],[0,0,-.30],0x6e7c86));
    for(const x of [-2.36,-.14,2.24]){
      const id='rib-'+x;
      meshes.push(panel(id,id,'iron',[x,-.05,-1.42],[.14,0,0],[0,2.37,0],0x2e4357));
    }
    for(const x of [-1.28,1.25]){
      const id='station-'+x;
      meshes.push(panel(id+'-plinth',id,'frame',[x-.53,-.04,.60],[1.06,0,0],[0,.22,0],0x526576),
        panel(id+'-top',id,'frame',[x-.53,.18,.60],[1.06,0,0],[0,0,-1.19],0x74868d),
        panel(id+'-trim',id,'accent',[x-.31,.086,.601],[.62,0,0],[0,.033,0],0xab895c));
    }
    const reflector=panel('overhead-bounce','overhead-bounce','copper',[-1.15,2.06,.07],[3.2,0,0],[0,.38,-1.39],undefined,tile(100,36,[155,93,69],18));
    meshes.push(reflector);
    function ceramic(id,at,radius) {
      const first=B.count();
      for(let i=0;i<1600;i++) {
        const y=1-2*(i+.5)/1600, ring=Math.sqrt(1-y*y), angle=i*Math.PI*(3-Math.sqrt(5));
        const n=[ring*Math.cos(angle),y,ring*Math.sin(angle)];
        const flange=1.0+.035*Math.cos(y*26);
        const p=at.map((v,k)=>v+n[k]*radius*(k===1?1.43:flange));
        const band=Math.abs(Math.cos(y*13))>.82, m=band ? 5 : 7;
        const start=B.count();
        B.disc(...p,n,.036,.010,B.P[m],1.5);
        B.describeAlbedo(start,B.count(),band ? '#92b5b5' : '#bdd6cc');
      }
      B.describeSplats(first,B.count(),{object:id,material:'ceramic'});
    }
    ceramic('west-insulator',[-1.28,.78,-.12],.49);
    ceramic('east-insulator',[1.25,.78,-.12],.49);
    meshes.push(panel('lamp-foot','lamp-stand','iron',[-.17,-.04,.58],[.34,0,0],[0,.17,0],0x785745),
      panel('lamp-stem','lamp-stand','iron',[-.036,.12,.574],[.072,0,0],[0,.42,0],0x926f4a));
    const from=B.count();
    B.ball(0,.65,.59,.18,.22,.1,76,[12,13],{an:{em:true},hollow:true});
    B.disc(0,.65,.65,[0,0,1],.11,.018,B.P[13],1.65,{em:true});
    B.describeSplats(from,B.count(),{object:'work-lamp'});
    const emissiveFinishes=[{id:'work-lamp',select:{object:'work-lamp'},core:{color:'#ffd77f'},
      spill:{at:[0,.80,.78],normal:[0,-1,0],size:[.12,.12],color:'#ffab5c',intensity:6.6,radius:2.35,
        sampleGrid:2,shadows:false},glow:{radius:3,strength:.36,small:false}}];
    const liveSun={direction:[-.63,.74,.46],ambient:.42,intensity:.77,filter:2,
      skyBounce:{color:'#7daaff',intensity:.62},groundBounce:{color:'#aa7755',intensity:.25}};
    const bounceProbes={samples:160,reach:4,bounceStrength:1.55,skyStrength:1,
      geometry:{meshes:[{id:'overhead-bounce'}]},
      cast:{include:[{object:'overhead-bounce'}]},
      receive:{include:[{material:'ceramic'},{material:'deck'}]},
      probes:[-1.29,1.29].map((x,i)=>({id:i?'east':'west',at:[x,.75,.05],radius:1.65}))};
    return B.finish({meshes,liveSun,bounceProbes,emissiveFinishes,dither:0,radius:5.8,
      cam:{target:[0,1.02,-.14],dist:8.8,yaw:.16,pitch:.26,ortho:true}});
  }
  const shot=require('./lighting-channels-shot.json');
  return {id:'relay-room-lighting',name:'Relay Room',seed:28,build,shot};
};
