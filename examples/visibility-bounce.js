// Copper Court. The cloth awning is a mesh reflector and the stone hood is a retained SDF.
module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => {
  const pal=[0x151e2b,0x222b3b,0x364353,0x4c5967,0x616b71,0x7a7d76,0x939184,0xb1aa93,
    0x54312b,0x73402f,0x995033,0xc0653b,0xe88b54,0xf7b579,0x497074,0x689394,0x9ab0a0];
  const receiver='plaster', hood='hood', reflector='copper-awning';
  const probes=[-1.3,1.3].map((x,i)=>({id:i?'open':'under-hood',at:[x,.48,.07],radius:1.8,
    bounds:{min:[x-1.29,-.45,-1.60],max:[x+1.29,1.05,1.16],feather:.26}}));
  const definitions={
    open:{meshes:[{id:reflector}]},
    occluded:{meshes:[{id:reflector}],sdfs:[{object:hood,mode:'occlude'}]},
    cool:{meshes:[{id:reflector}],sdfs:[{object:hood,color:'#306f83'}]}
  };
  function transport(mode='occluded'){
    const geometry=definitions[mode];
    const cast=[{object:reflector},...(geometry.sdfs?[{object:hood}]:[])];
    return {geometry,samples:256,reach:4,bounceStrength:3.4,skyStrength:0,probes,
      cast:{include:cast},receive:{include:[{material:receiver}]}};
  }
  function build(seed=27) {
    const B=makeBuilder(seed,pal), S=K.sculpt(makeSculpt(B));
    S.keepRenderSdf=true;
    S.amb=.48;
    S.box([-1.30,1.11,-.12],[.97,.067,.74],{r:[2,3,4]},{res:.067,objectId:hood});
    S.bake();

    const meshes=[];
    function quad(id,slot,origin,u,v,texture,color){
      const p=(a,b)=>origin.map((n,i)=>n+a*u[i]+b*v[i]);
      meshes.push(K.sceneMeshes.create({id,positions:[...p(0,0),...p(1,0),...p(0,1),...p(1,1)],
        uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3],materials:[{id:slot,texture,color}]}));
    }
    function stone(size,type){
      const pixels=new Uint8Array(size*size*4);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const grain=((x*1223^y*3533^x*y*79)&15)-7, seam=(x+(y/16|0)%2*8)%16, strip=y%16;
        let c=type==='roof' ? (x%23<2?[123,64,44]:[245,119,63])
          : type==='floor' ? (x%12===0 || y%12===0?[76,74,68]:[139,134,119])
          : (seam===0 || strip===0?[44,54,61]:[64,75,82]);
        const fade=type==='roof'?-(y/size)*34:0;
        pixels.set([...c.map(n=>Math.min(255,n+grain+Math.round(fade))),255],(y*size+x)*4);
      }
      return {width:size,height:size,pixels};
    }
    quad('footing','base',[-2.73,-.13,1.45],[5.46,0,0],[0,.13,0],undefined,0x344451);
    quad('footing-side','base',[2.73,-.13,1.45],[0,0,-3.08],[0,.13,0],undefined,0x293744);
    quad('court-floor',receiver,[-2.73,0,-1.63],[5.46,0,0],[0,0,3.08],stone(84,'floor'));
    quad('court-wall',receiver,[-2.73,0,-1.58],[5.46,0,0],[0,2.16,0],stone(112,'wall'));
    quad('right-wing','iron',[2.73,0,-1.57],[0,0,2.13],[0,1.94,0],stone(64,'wall'));
    quad(reflector,'copper',[-2.74,1.81,.18],[5.48,0,0],[0,.38,-1.83],stone(112,'roof'));
    quad('front-beam','iron',[-2.77,1.78,.19],[5.54,0,0],[0,.088,0],undefined,0x69452f);
    quad('central-pillar','iron',[-.038,0,-1.51],[.076,0,0],[0,1.89,0],undefined,0x303740);
    for(const [i,x] of [-1.30,1.30].entries()){
      const suffix=String(i);
      quad('sill-'+suffix,'stone',[x-.96,.39,-1.52],[1.92,0,0],[0,0,.25],undefined,0x818177);
      quad('sill-face-'+suffix,'stone',[x-.96,.31,-1.27],[1.92,0,0],[0,.08,0],undefined,0x374c5b);
      quad('plaque-'+suffix,'brass',[x-.13,1.43,-1.568],[.26,0,0],[0,.17,0],undefined,0xb47b4b);
    }
    const first=B.count();
    const V=K.V;
    for(const x of [-1.3,1.3]){
      for(const z of [-.62,.15,.65]) {
        const size=z<0?.23:.16, at=[x+(z<0?.24:-.23),size+.005,z];
        for(let k=0;k<96;k++){
          const ny=1-2*(k+.5)/96, span=Math.sqrt(1-ny*ny), angle=k*Math.PI*(3-Math.sqrt(5));
          const n=[span*Math.cos(angle),ny,span*Math.sin(angle)], p=V.mad(at,n,size);
          B.disc(...p,n,.059*(size/.23),.009,B.P[ny>.25?7:ny>-.28?6:5],1.45);
        }
      }
    }
    B.describeSplats(first,B.count(),{object:'ceramics',material:receiver});
    B.describeAlbedo(first,B.count(),'#ab9b83');
    return B.finish({meshes,bounceProbes:transport(),radius:5.4,dither:0,
      cam:{target:[0,.85,-.2],dist:10,yaw:.26,pitch:.37,ortho:true}});
  }
  return {id:'copper-court-bounce',name:'Copper Court',seed:27,build,transport};
};
